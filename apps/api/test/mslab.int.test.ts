import { gzipSync } from "node:zlib";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { readZip } from "../src/tool-runner/zip.mts";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/** Integration: save a project as a .mslab file and open it again as a new project (ADR-0021). */
describe("mslab project files", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const browsers: Record<string, { cookie: string; csrf: string; id: string }> = {};

  async function login(sub: string): Promise<void> {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in`);
    const cookie = `msl_session=${token}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken, id: me.user.id };
  }

  const as = (sub: string) => {
    const b = browsers[sub]!;
    const server = app.getHttpServer();
    const write = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      download: (path: string) =>
        request(server)
          .get(path)
          .set("Cookie", b.cookie)
          .buffer(true)
          .parse((res, cb) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => cb(null, Buffer.concat(chunks)));
          }),
      post: (path: string, body: object = {}) => write(request(server).post(path)).send(body),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
      upload: (path: string, file: Buffer) =>
        write(request(server).post(path)).set("Content-Type", "application/octet-stream").send(file),
    };
  };

  beforeAll(async () => {
    db = await startDatabase();
    idp = await startIdp();
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: idp.issuer, clientId: "mobsimlab", allowInsecureHttp: true },
    });
    app = await createApp(config);
    await login("alice");
    await as("alice").post("/api/setup/finish");
    await as("alice").put("/api/admin/registration", {
      autoRegistration: true,
      defaultRole: "user",
      allowedEmailDomains: [],
      allowedGroups: [],
    });
    await login("bob");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  let source = "";
  let runId = "";
  const railway = {
    origin: [13.4, 52.5],
    mode: "tram",
    stations: [{ id: 1, name: "Lakeside" }],
    tracks: [
      {
        id: 1,
        points: [
          [0, 0],
          [400, 0],
        ],
      },
    ],
    switches: [],
  };
  const preferences = { values: { "street.mixed_traffic_delay_share": 0.25 } };

  it("saves a project with its drawings, plugins and, when asked, its runs", async () => {
    const created = await as("alice").post("/api/projects", {
      name: "Lakeside ÿ network",
      description: "Trams by the lake",
      areaName: "Lakeside",
      modes: ["tram", "bus"],
    });
    source = created.body.project.id;
    for (const [kind, doc] of Object.entries({ railway, preferences }))
      expect(
        (await as("alice").put(`/api/projects/${source}/drawings/${kind}`, { doc, baseVersion: null }))
          .status,
      ).toBe(200);
    const su = await db.superuser();
    try {
      const r = await su.query(
        `INSERT INTO simulation.run (project_id, kind, status, input, network, lines, result, created_by, finished_at)
         VALUES ($1, 'road', 'done', '{"period":"am"}', '{"tiles":[]}', '{"lines":[]}', '{"ok":1}', $2, now())
         RETURNING id`,
        [source, browsers.alice!.id],
      );
      runId = r.rows[0].id;
      await su.query("INSERT INTO simulation.run_replay (run_id, data) VALUES ($1, $2)", [
        runId,
        gzipSync(Buffer.from('{"frames":[]}')),
      ]);
      // A run still going is never saved in a file.
      await su.query(
        `INSERT INTO simulation.run (project_id, kind, status, input, network, lines) VALUES ($1, 'capacity', 'running', '{}', 'example:metro', '')`,
        [source],
      );
      await su.query(
        "INSERT INTO project.plugin (project_id, plugin_id, enabled, version) VALUES ($1, 'org.mobsimlab.gtfs', true, null), ($1, 'com.example.missing', true, '1.0.0')",
        [source],
      );
    } finally {
      await su.end();
    }

    const plain = await as("alice").download(`/api/projects/${source}/mslab`);
    expect(plain.status).toBe(200);
    expect(plain.headers["content-type"]).toBe("application/vnd.mobsimlab.project+zip");
    expect(plain.headers["content-disposition"]).toContain("filename*=UTF-8''Lakeside");
    const files = readZip(plain.body as Buffer, {
      zipBytes: 1e9,
      entries: 1000,
      fileBytes: 1e9,
      totalBytes: 1e9,
      maxRatio: 1e9,
    });
    expect([...files.keys()].sort()).toEqual([
      "ATTRIBUTION.md",
      "data/preferences.json",
      "data/railway.json",
      "manifest.json",
      "plugins.json",
      "project.json",
    ]);
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    expect(manifest).toMatchObject({ format: "mslab", formatVersion: "1.0.0", includes: { runs: false } });
    expect(JSON.parse(files.get("data/railway.json")!.toString()).doc).toEqual(railway);

    const withRuns = await as("alice").download(`/api/projects/${source}/mslab?runs=true`);
    const keys = [
      ...readZip(withRuns.body as Buffer, {
        zipBytes: 1e9,
        entries: 1000,
        fileBytes: 1e9,
        totalBytes: 1e9,
        maxRatio: 1e9,
      }).keys(),
    ];
    expect(keys.filter((k) => k.startsWith("runs/")).sort()).toEqual([
      `runs/${runId}/lines.txt`,
      `runs/${runId}/network.txt`,
      `runs/${runId}/replay.json.gz`,
      `runs/${runId}/run.json`,
    ]);
  });

  it("opens the file as a new project owned by the person who opens it", async () => {
    const file = (await as("alice").download(`/api/projects/${source}/mslab?runs=true`)).body as Buffer;
    const res = await as("bob").upload("/api/projects/import", file);
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      name: "Lakeside ÿ network",
      description: "Trams by the lake",
      areaName: "Lakeside",
      modes: ["tram", "bus"],
      myRole: "owner",
      owner: { id: browsers.bob!.id },
    });
    expect(res.body.project.id).not.toBe(source);
    expect(res.body.skipped).toEqual(["plugin com.example.missing 1.0.0: not installed on this MobSimLab"]);
    const id = res.body.project.id as string;

    const drawings = (await as("bob").get(`/api/projects/${id}/drawings`)).body.drawings;
    expect(drawings.railway.doc).toEqual(railway);
    expect(drawings.preferences.doc).toEqual(preferences);
    expect(drawings.depots).toBeUndefined();

    const runs = (await as("bob").get(`/api/projects/${id}/simulation-runs`)).body.runs as {
      id: string;
      kind: string;
      status: string;
    }[];
    expect(runs.map((r) => [r.kind, r.status])).toEqual([["road", "done"]]);
    expect(runs[0]!.id).not.toBe(runId);
    const replay = await as("bob").get(`/api/projects/${id}/simulation-runs/${runs[0]!.id}/replay`);
    expect(replay.status).toBe(200);

    // The original stays as it was, and Alice has no access to Bob's copy.
    expect((await as("alice").get(`/api/projects/${id}`)).status).toBe(404);

    // Saving the copy again gives the same drawings: the round trip loses nothing.
    const again = readZip((await as("bob").download(`/api/projects/${id}/mslab`)).body as Buffer, {
      zipBytes: 1e9,
      entries: 1000,
      fileBytes: 1e9,
      totalBytes: 1e9,
      maxRatio: 1e9,
    });
    expect(JSON.parse(again.get("data/railway.json")!.toString()).doc).toEqual(railway);
    expect(JSON.parse(again.get("plugins.json")!.toString()).plugins).toEqual([
      { id: "org.mobsimlab.gtfs", enabled: true, version: null },
    ]);

    const su = await db.superuser();
    try {
      const audit = await su.query("SELECT action FROM audit.record WHERE object_id = $1 ORDER BY seq", [id]);
      expect(audit.rows.map((r) => r.action)).toEqual([
        "project.created",
        "project.imported",
        "project.exported",
      ]);
      const exported = await su.query(
        "SELECT count(*)::int AS n FROM audit.record WHERE object_id = $1 AND action = 'project.exported'",
        [source],
      );
      expect(exported.rows[0].n).toBeGreaterThan(0);
    } finally {
      await su.end();
    }
  });

  it("refuses files it cannot open, with a plain reason", async () => {
    const bad = await as("bob").upload("/api/projects/import", Buffer.from("hello"));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/^This file cannot be opened: the file is not a ZIP file/);
    const empty = await as("bob").post("/api/projects/import", {});
    expect(empty.status).toBe(400);
  });

  it("lets only people who can open a project save it", async () => {
    expect((await as("bob").download(`/api/projects/${source}/mslab`)).status).toBe(404);
  });
});

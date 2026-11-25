import { deflateSync, gzipSync } from "node:zlib";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BenefitsService } from "../src/benefits/benefits.service";
import { EconomyService } from "../src/economy/economy.service";
import { PopulationService } from "../src/population/population.service";
import { StreetNetworkService } from "../src/street-network/street-network.service";
import type { AppConfig } from "../src/config/env";
import { readZip } from "../src/tool-runner/zip.mts";
import { readArchive } from "./support/pmtiles";
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
    stations: [{ id: 1, name: "Lakeside", x: 0, y: 0 }],
    tracks: [
      {
        id: 1,
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
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
      "history/values.json",
      "manifest.json",
      "plugins.json",
      "project.json",
    ]);
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    expect(manifest).toMatchObject({ format: "mslab", formatVersion: "1.5.0", includes: { runs: false } });
    // Saving the preferences recorded the change of the value, with who made it.
    expect(JSON.parse(files.get("history/values.json")!.toString()).entries).toEqual([
      expect.objectContaining({
        id: "street.mixed_traffic_delay_share",
        kind: "changed",
        before: { value: null, reason: null },
        after: { value: 0.25, reason: null },
      }),
    ]);
    // Without the history, the file is one that the first MobSimLab readers still open.
    const older = readZip(
      (await as("alice").download(`/api/projects/${source}/mslab?history=false`)).body as Buffer,
      { zipBytes: 1e9, entries: 1000, fileBytes: 1e9, totalBytes: 1e9, maxRatio: 1e9 },
    );
    expect(JSON.parse(older.get("manifest.json")!.toString())).toMatchObject({ formatVersion: "1.0.0" });
    expect(older.has("history/values.json")).toBe(false);
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

    // The source has no project area (as files saved before drawn polygons): the copy gets the box round its
    // drawing, widened by 2 km, so its map data can be imported straight away.
    const area = (await as("bob").get(`/api/projects/${id}/area`)).body as {
      polygons: { name: string; detail: string; ring: [number, number][] }[];
    };
    expect(area.polygons).toHaveLength(1);
    expect(area.polygons[0]).toMatchObject({ name: "Lakeside", detail: "full" });
    const [w, s] = area.polygons[0]!.ring[0]!;
    const [e, n] = area.polygons[0]!.ring[2]!;
    expect(w).toBeCloseTo(13.4 - 2000 / 111_320 / Math.cos((52.5 * Math.PI) / 180), 3);
    expect(s).toBeCloseTo(52.5 - 2000 / 111_320, 4);
    expect(e).toBeGreaterThan(13.4 + 400 / 67_800);
    expect(n).toBeCloseTo(52.5 + 2000 / 111_320, 4);

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

    // Opening the same file again: Bob already has a project with that name, so the new one gets a number.
    const second = await as("bob").upload("/api/projects/import", file);
    expect(second.status).toBe(201);
    expect(second.body.project.name).toBe("Lakeside ÿ network (2)");
  });

  it("carries the comments, the history of changed values and a demand run's OD matrices", async () => {
    const c = await as("alice").post(`/api/projects/${source}/comments`, {
      objectType: "station",
      objectId: "1",
      body: "Move the entrance to the lake side",
    });
    expect(c.status).toBe(201);
    const thread = c.body.comment.id as string;
    expect(
      (
        await as("alice").post(`/api/projects/${source}/comments`, {
          objectType: "station",
          objectId: "1",
          parentId: thread,
          body: "Done in the drawing",
        })
      ).status,
    ).toBe(201);
    expect(
      (await as("alice").put(`/api/projects/${source}/comments/${thread}/resolved`, { resolved: true }))
        .status,
    ).toBe(200);

    const su = await db.superuser();
    let demand: string;
    try {
      const r = await su.query(
        `INSERT INTO simulation.run (project_id, kind, status, input, network, lines, result, created_by, finished_at)
         VALUES ($1, 'demand', 'done', '{}', '', '', '{"files":["od.omx","big.omx"]}', $2, now()) RETURNING id`,
        [source, browsers.alice!.id],
      );
      demand = r.rows[0].id;
      await su.query(
        "INSERT INTO simulation.run_file (run_id, name, media_type, content) VALUES ($1, 'od.omx', 'application/x-hdf5', $2)",
        [demand, Buffer.from("OMX matrices")],
      );
    } finally {
      await su.end();
    }

    const file = (await as("alice").download(`/api/projects/${source}/mslab?runs=true`)).body as Buffer;
    const inFile = readZip(file, {
      zipBytes: 1e9,
      entries: 1000,
      fileBytes: 1e9,
      totalBytes: 1e9,
      maxRatio: 1e9,
    });
    expect(JSON.parse(inFile.get("manifest.json")!.toString()).formatVersion).toBe("1.5.0");
    expect(inFile.get(`runs/${demand}/files/od.omx`)!.toString()).toBe("OMX matrices");
    // The result lists only the files the .mslab holds.
    expect(JSON.parse(inFile.get(`runs/${demand}/run.json`)!.toString()).result.files).toEqual(["od.omx"]);
    const comments = JSON.parse(inFile.get("collab/comments.json")!.toString()).comments;
    expect(comments).toHaveLength(2);

    const opened = await as("bob").upload("/api/projects/import", file);
    expect(opened.status).toBe(201);
    const id = opened.body.project.id as string;

    // The comments come back with their thread, the names of who wrote and resolved them kept as text.
    const got = (await as("bob").get(`/api/projects/${id}/comments`)).body.comments as {
      id: string;
      parentId: string | null;
      body: string;
      author: unknown;
      fromFile: boolean;
      fileAuthor: string | null;
      resolvedAt: string | null;
      fileResolvedBy: string | null;
    }[];
    expect(got).toHaveLength(2);
    const first = got.find((x) => x.parentId === null)!;
    expect(first).toMatchObject({ body: "Move the entrance to the lake side", author: null, fromFile: true });
    expect(first.fileAuthor).toBeTruthy();
    expect(first.resolvedAt).not.toBeNull();
    expect(first.fileResolvedBy).toBe(first.fileAuthor);
    expect(got.find((x) => x.parentId !== null)!.parentId).toBe(first.id);

    // The history of changed values shows read-only, as it came from the file.
    const history = (await as("bob").get(`/api/projects/${id}/value-history/file`)).body.history;
    expect(history).toEqual([
      expect.objectContaining({
        n: 0,
        id: "street.mixed_traffic_delay_share",
        kind: "changed",
        fromFile: true,
      }),
    ]);
    expect((await as("bob").get(`/api/projects/${id}/value-history`)).body.history).toEqual([]);

    // The demand run comes back with its OD matrices.
    const runs = (await as("bob").get(`/api/projects/${id}/simulation-runs`)).body.runs as {
      id: string;
      kind: string;
    }[];
    const run = runs.find((r) => r.kind === "demand")!;
    const omx = await as("bob").download(`/api/projects/${id}/simulation-runs/${run.id}/files/od.omx`);
    expect(omx.status).toBe(200);
    expect((omx.body as Buffer).toString()).toBe("OMX matrices");

    // Saving the opened project again keeps the history it came with.
    const again = readZip((await as("bob").download(`/api/projects/${id}/mslab`)).body as Buffer, {
      zipBytes: 1e9,
      entries: 1000,
      fileBytes: 1e9,
      totalBytes: 1e9,
      maxRatio: 1e9,
    });
    expect(JSON.parse(again.get("history/values.json")!.toString()).entries).toHaveLength(1);
    expect(JSON.parse(again.get("collab/comments.json")!.toString()).comments).toHaveLength(2);
  });

  it("saves the map data of the project area for the static viewer when asked, and leaves it out on opening", async () => {
    // OpenStreetMap, WorldPop and the World Bank are not reachable from tests: their answers are stubbed.
    const streets = app.get(StreetNetworkService);
    const osm = '<?xml version="1.0"?><osm version="0.6"><node id="1" lat="52.5" lon="13.4"/></osm>';
    const empty = '<?xml version="1.0"?><osm version="0.6"></osm>';
    const spies = [
      vi.spyOn(streets, "tile").mockResolvedValue(osm),
      vi.spyOn(streets, "walkTile").mockResolvedValue(empty),
      vi.spyOn(streets, "railTile").mockResolvedValue(osm),
      vi.spyOn(streets, "buildingTile").mockResolvedValue('{"buildings":[]}'),
      vi.spyOn(streets, "placeTile").mockResolvedValue('{"places":[]}'),
      vi.spyOn(streets, "water").mockResolvedValue('{"areas":[],"rivers":[],"sea":[]}'),
      vi.spyOn(app.get(PopulationService), "gridFor").mockImplementation(async (b) => ({
        status: "ready",
        grid: { x0: b[0], y0: b[1], dx: 1 / 1200, dy: 1 / 1200, nx: 1, ny: 1, people: [42] },
        source: {
          id: "worldpop",
          name: "WorldPop",
          dataset: "WorldPop",
          url: "https://www.worldpop.org",
          licence: "CC BY 4.0",
          citation: "",
          year: 2020,
        } as never,
      })),
      vi
        .spyOn(app.get(EconomyService), "countryAt")
        .mockResolvedValue({ iso3: "DEU", iso2: "DE", name: "Germany" }),
      vi
        .spyOn(app.get(EconomyService), "countries")
        .mockResolvedValue([{ iso3: "DEU", iso2: "DE", name: "Germany", income: null }]),
      vi.spyOn(app.get(EconomyService), "economy").mockResolvedValue({ fx: null } as never),
      vi.spyOn(app.get(BenefitsService), "indicators").mockResolvedValue({ gdp: null } as never),
    ];
    try {
      // The project area: one polygon round what is drawn.
      const [w, s, e, n] = [13.37, 52.482, 13.44, 52.518];
      const areaSet = await as("alice").put(`/api/projects/${source}/area`, {
        polygons: [
          {
            id: "a1",
            name: "Mitte",
            detail: "full",
            ring: [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          },
        ],
        import: false,
      });
      expect(areaSet.status).toBe(200);
      const lines = { lines: [{ name: "1", points: [{ lonlat: [13.4, 52.5] }, { lonlat: [13.41, 52.5] }] }] };
      expect(
        (
          await as("alice").put(`/api/projects/${source}/drawings/street-lines`, {
            doc: lines,
            baseVersion: null,
          })
        ).status,
      ).toBe(200);
      const res = await as("alice").download(`/api/projects/${source}/mslab?map=true`);
      expect(res.status).toBe(200);
      const files = readZip(res.body as Buffer, {
        zipBytes: 1e9,
        entries: 5000,
        fileBytes: 1e9,
        totalBytes: 1e9,
        maxRatio: 1e9,
      });
      const manifest = JSON.parse(files.get("manifest.json")!.toString());
      // The facts kept for the area (fetched/facts.json) make it format 1.6.
      expect(manifest).toMatchObject({ formatVersion: "1.6.0", includes: { runs: false, map: true } });
      expect(JSON.parse(files.get("fetched/facts.json")!.toString()).entries.length).toBeGreaterThan(0);
      expect(JSON.parse(files.get("project.json")!.toString()).areaPolygons).toEqual([
        {
          id: "a1",
          name: "Mitte",
          detail: "full",
          ring: [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        },
      ]);
      const area = JSON.parse(files.get("map/area.json")!.toString());
      expect(area.kinds).toEqual(["streets", "walk", "buildings", "places", "rail"]);
      expect(area.tiles.length).toBeGreaterThan(1);
      // One archive per kind, read by byte range in the static viewer; empty tiles are left out.
      expect(area.layout).toBe("archive");
      expect([...files.keys()].filter((n) => /^map\/[a-z-]+\//.test(n))).toEqual([]);
      const streetsArchive = readArchive(files.get("map/streets.pmtiles")!);
      expect(streetsArchive.size).toBe(area.tiles.length);
      for (const [x, y] of area.tiles as [number, number][])
        expect(streetsArchive.get(`14/${x}/${y}`)).toBe(osm);
      expect(readArchive(files.get("map/walk.pmtiles")!).size).toBe(0);
      expect(readArchive(files.get("map/buildings.pmtiles")!).size).toBe(0);
      expect(files.has("map/bike-amenities.pmtiles")).toBe(false);
      expect(JSON.parse(files.get("map/population.json")!.toString()).grids[0].people).toEqual([42]);
      expect(Object.keys(JSON.parse(files.get("map/reference.json")!.toString())).sort()).toEqual([
        "/api/benefits/indicators?code=DEU",
        "/api/economy/countries",
        "/api/economy/country-at",
        "/api/economy/indicators?code=DEU&base=2023",
        // Saving the area looked up its facts (country, holidays), kept for the static viewer.
        "@facts",
      ]);
      expect(files.get("ATTRIBUTION.md")!.toString()).toContain("map/population.json");

      const opened = await as("alice").upload("/api/projects/import", res.body as Buffer);
      expect(opened.status).toBe(201);
      // The opened project has the same area.
      const openedArea = (await as("alice").get(`/api/projects/${opened.body.project.id}/area`)).body;
      expect(openedArea.polygons.map((x: { name: string }) => x.name)).toEqual(["Mitte"]);
      expect(opened.body.skipped).toEqual([
        "plugin com.example.missing 1.0.0: not installed on this MobSimLab",
      ]);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("carries the data the project fetched and imported, and opens with it", async () => {
    const tile = (values: number[]) => deflateSync(Buffer.from(new Float32Array(values).buffer));
    const su = await db.superuser();
    try {
      await su.query(
        `INSERT INTO project.data_cache (project_id, kind, key, body) VALUES ($1, 'facts', 'climate/52.5,13.4', '{"months":[1]}')
         ON CONFLICT DO NOTHING`,
        [source],
      );
      for (const [kind, key, body] of [
        ["osm", "streets/14/8802/5373", "<osm/>"],
        ["height", "13.4000,52.5000", "35"],
      ] as const) {
        const r = await su.query(
          "INSERT INTO geo.shared_data (kind, key, body) VALUES ($1, $2, $3) RETURNING id",
          [kind, key, Buffer.from(body)],
        );
        await su.query(
          "INSERT INTO project.data_use (project_id, kind, key, shared_id) VALUES ($1, $2, $3, $4)",
          [source, kind, key, r.rows[0].id],
        );
      }
      const imp = await su.query(
        `INSERT INTO geo.import (project_id, kind, method, status, bbox, buffer_km, source, finished_at)
         VALUES ($1, 'dem', 'copernicus', 'done', ARRAY[13.3, 52.4, 13.7, 52.6], 2,
                 '{"name":"Copernicus GLO-30","licence":"Copernicus licence"}', now()) RETURNING id`,
        [source],
      );
      // One tile in the full-detail polygon and one outside it; each 4 × 4 values.
      const sixteen = Array.from({ length: 16 }, (_, i) => i);
      for (const lon of [13.4, 13.6])
        await su.query(
          `INSERT INTO geo.dem_tile (project_id, import_id, priority, width, height, origin_lon, origin_lat,
             step_lon, step_lat, data, envelope)
           VALUES ($1, $2, 0, 4, 4, $3::double precision, 52.5, 0.001, 0.001, $4, ST_MakeEnvelope($3::double precision, 52.496, $3::double precision + 0.004, 52.5, 4326))`,
          [source, imp.rows[0].id, lon, tile(sixteen)],
        );
      for (const [name, src, people] of [
        ["WorldPop 2025", "worldpop", 30],
        ["Census zones", "upload", 7],
      ] as const) {
        const l = await su.query(
          `INSERT INTO geo.population_layer (project_id, name, source, kind, status, confidence, reference_year,
             resolution_m, coverage, people_total, feature_count, is_primary, options, updated_at)
           VALUES ($1, $2, $3, 'grid', 'ready', 'medium', 2025, 100, ST_MakeEnvelope(13.37, 52.48, 13.44, 52.52, 4326),
                   $4, 2, $5, '{"year":2025}', now()) RETURNING id`,
          [source, name, src, people, src === "worldpop"],
        );
        await su.query(
          `INSERT INTO geo.population_feature (layer_id, n, zone_id, people, geom) VALUES
             ($1, 0, NULL, $2, ST_SetSRID(ST_MakePoint(13.40, 52.50), 4326)),
             ($1, 1, 'z "1"', 0, ST_MakeEnvelope(13.41, 52.50, 13.42, 52.51, 4326))`,
          [l.rows[0].id, people],
        );
      }
    } finally {
      await su.end();
    }

    // Without the planner's own files: the uploaded population layer stays out.
    const res = await as("alice").download(`/api/projects/${source}/mslab?uploads=false`);
    expect(res.status).toBe(200);
    const files = readZip(res.body as Buffer, {
      zipBytes: 1e9,
      entries: 5000,
      fileBytes: 1e9,
      totalBytes: 1e9,
      maxRatio: 1e9,
    });
    expect(JSON.parse(files.get("manifest.json")!.toString()).formatVersion).toBe("1.6.0");
    const facts = JSON.parse(files.get("fetched/facts.json")!.toString()).entries as { key: string }[];
    expect(facts.map((f) => f.key)).toContain("climate/52.5,13.4");
    expect(JSON.parse(files.get("fetched/live-osm-1.json")!.toString()).entries).toMatchObject([
      { key: "streets/14/8802/5373", body: "<osm/>" },
    ]);
    expect(JSON.parse(files.get("fetched/live-height-1.json")!.toString()).entries).toMatchObject([
      { key: "13.4000,52.5000", body: "35" },
    ]);
    const elevation = JSON.parse(files.get("fetched/elevation.json")!.toString());
    // 30 m in the full-detail polygon, every third sample (about 90 m) outside it.
    const saved = elevation.imports[0].tiles as { width: number; stepLon: number }[];
    expect(saved.map((t) => t.width)).toEqual([4, 2]);
    expect(saved[0]!.stepLon).toBeCloseTo(0.001, 9);
    expect(saved[1]!.stepLon).toBeCloseTo(0.003, 9);
    const population = JSON.parse(files.get("fetched/population.json")!.toString());
    expect(population.layers.map((l: { name: string }) => l.name)).toEqual(["WorldPop 2025"]);
    expect(files.get("fetched/population-1-1.ndjson")!.toString().trim().split("\n")).toHaveLength(2);
    const attribution = files.get("ATTRIBUTION.md")!.toString();
    expect(attribution).toContain("Copernicus GLO-30, Copernicus licence");
    expect(attribution).toContain('Population layer "WorldPop 2025"');

    const opened = await as("bob").upload("/api/projects/import", res.body as Buffer);
    expect(opened.status).toBe(201);
    const id = opened.body.project.id as string;
    // The opened project reads the population layer, the tiles and the heights without downloading them.
    const layers = (await as("bob").get(`/api/projects/${id}/population`)).body.layers as Record<
      string,
      unknown
    >[];
    expect(layers).toMatchObject([
      { name: "WorldPop 2025", source: "worldpop", status: "ready", peopleTotal: 30, featureCount: 2 },
    ]);
    const su2 = await db.superuser();
    try {
      const kept = await su2.query(
        "SELECT key FROM project.data_cache WHERE project_id = $1 AND kind = 'facts' ORDER BY key",
        [id],
      );
      expect(kept.rows.map((r) => r.key)).toContain("climate/52.5,13.4");
      // The live copies belong to the opened project only: no other project is handed them.
      const live = await su2.query(
        `SELECT u.kind, u.key, s.key AS held, convert_from(s.body, 'UTF8') AS body
         FROM project.data_use u JOIN geo.shared_data s ON s.id = u.shared_id
         WHERE u.project_id = $1 ORDER BY u.kind`,
        [id],
      );
      expect(live.rows).toEqual([
        { kind: "height", key: "13.4000,52.5000", held: `file/${id}/13.4000,52.5000`, body: "35" },
        { kind: "osm", key: "streets/14/8802/5373", held: `file/${id}/streets/14/8802/5373`, body: "<osm/>" },
      ]);
      const tiles = await su2.query(
        `SELECT t.width, i.method, i.status FROM geo.dem_tile t JOIN geo.import i ON i.id = t.import_id
         WHERE t.project_id = $1 ORDER BY t.origin_lon`,
        [id],
      );
      expect(tiles.rows).toEqual([
        { width: 4, method: "copernicus", status: "done" },
        { width: 2, method: "copernicus", status: "done" },
      ]);
      const zone = await su2.query(
        `SELECT f.zone_id, ST_AsText(f.geom) AS g FROM geo.population_feature f
         JOIN geo.population_layer l ON l.id = f.layer_id WHERE l.project_id = $1 AND f.n = 1`,
        [id],
      );
      expect(zone.rows[0].zone_id).toBe('z "1"');
      expect(zone.rows[0].g).toMatch(/^POLYGON/);
    } finally {
      await su2.end();
    }
    // What the opened project holds shows in Saved project files.
    const rows = Object.fromEntries(
      (
        (await as("bob").get(`/api/projects/${id}/mslab/contents`)).body.rows as {
          id: string;
          items: number;
        }[]
      ).map((r) => [r.id, r.items]),
    );
    expect(rows).toMatchObject({ liveTiles: 1, population: 1, uploads: 0 });
    expect(rows.elevation).toBe(3);

    // With every kind switched off the file holds none of it.
    const none = await as("alice").download(
      `/api/projects/${source}/mslab?facts=false&economy=false&otherFetched=false&liveTiles=false&elevation=false&population=false&uploads=false`,
    );
    const bare = readZip(none.body as Buffer, {
      zipBytes: 1e9,
      entries: 5000,
      fileBytes: 1e9,
      totalBytes: 1e9,
      maxRatio: 1e9,
    });
    expect([...bare.keys()].filter((n) => n.startsWith("fetched/"))).toEqual([]);
    expect(JSON.parse(bare.get("manifest.json")!.toString()).formatVersion).toBe("1.5.0");
  });

  it("refuses files it cannot open, with a plain reason", async () => {
    const bad = await as("bob").upload("/api/projects/import", Buffer.from("hello"));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/^This file cannot be opened: the file is not a ZIP file/);
    const empty = await as("bob").post("/api/projects/import", {});
    expect(empty.status).toBe(400);
  });

  it("lists the size, date and source of each kind of data the project holds", async () => {
    const su = await db.superuser();
    try {
      await su.query(
        `INSERT INTO project.data_cache (project_id, kind, key, body) VALUES
           ($1, 'facts', 'climate/47.0,8.0', '{"months":[]}'),
           ($1, 'facts', 'economy/CH/2020', '{"ppp":1}'),
           ($1, 'facts', 'osm-areas/8.000000,47.000000', '[]')`,
        [source],
      );
    } finally {
      await su.end();
    }
    const res = await as("alice").get(`/api/projects/${source}/mslab/contents`);
    expect(res.status).toBe(200);
    const rows = Object.fromEntries(
      (
        res.body.rows as { id: string; bytes: number; items: number; at: string | null; sources: string[] }[]
      ).map((r) => [r.id, r]),
    );
    expect(Object.keys(rows)).toEqual([
      "design",
      "vehicles",
      "processed",
      "runs",
      "comments",
      "history",
      "osm",
      "liveTiles",
      "elevation",
      "population",
      "uploads",
      "facts",
      "economy",
      "otherFetched",
      "viewerMap",
    ]);
    expect(rows.design!.items).toBeGreaterThanOrEqual(2);
    expect(rows.design!.bytes).toBeGreaterThan(0);
    expect(rows.design!.at).not.toBeNull();
    expect(rows.runs!.items).toBeGreaterThanOrEqual(1);
    expect(rows.comments!.items).toBeGreaterThanOrEqual(2);
    expect(rows.history!.items).toBeGreaterThanOrEqual(1);
    // Setting the area in the test before may have kept more facts: those add to the rows.
    expect(rows.facts!.sources).toContain("Open-Meteo");
    expect(rows.economy!.sources).toContain("World Bank");
    expect(rows.otherFetched!.sources).toContain("OpenStreetMap");
    for (const k of ["facts", "economy", "otherFetched"] as const)
      expect(rows[k]!.items).toBeGreaterThanOrEqual(1);
    expect(rows.osm).toMatchObject({ bytes: 0, items: 0, at: null });

    // Leaving out the results keeps everything else.
    const plain = await as("alice").download(`/api/projects/${source}/mslab?results=false`);
    expect(plain.status).toBe(200);
  });

  it("lets only people who can open a project save it", async () => {
    expect((await as("bob").download(`/api/projects/${source}/mslab`)).status).toBe(404);
    expect((await as("bob").get(`/api/projects/${source}/mslab/contents`)).status).toBe(404);
  });
});

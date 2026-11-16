import { generateKeyPairSync } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { zip } from "../src/plugins/zip";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";
import { PluginCodeService } from "../src/plugins/code/code.service";
import { examplePlugin, samplePlugin, signed } from "./support/plugins";

/** Integration: installing plugins (Admins), trusted keys, and plugins per project (project Owners), ADR-0036 §9. */
describe("plugins", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const browsers: Record<string, { cookie: string; csrf: string; id: string }> = {};
  const lab = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const labPem = lab.publicKey.export({ type: "spki", format: "pem" }).toString();

  async function login(sub: string, a: NestExpressApplication = app): Promise<void> {
    const res = await signIn(a, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in: ${String(res.headers.location)}`);
    const cookie = `msl_session=${token}`;
    const me = (await request(a.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken, id: me.user.id };
  }

  const as = (sub: string, a: NestExpressApplication = app) => {
    const b = browsers[sub];
    if (!b) throw new Error(`${sub} is not signed in`);
    const server = a.getHttpServer();
    const write = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      post: (path: string, body: object = {}) => write(request(server).post(path)).send(body),
      upload: (path: string, file: Buffer) =>
        write(request(server).post(path)).set("Content-Type", "application/octet-stream").send(file),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
      patch: (path: string, body: object) => write(request(server).patch(path)).send(body),
      del: (path: string, body: object = {}) => write(request(server).delete(path)).send(body),
    };
  };

  const pkg = (over: Record<string, unknown> = {}, id?: string) =>
    zip(signed(samplePlugin(over, id), lab.privateKey));

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
    await login("dave");
    await as("alice").patch(`/api/admin/users/${browsers.dave?.id}`, { role: "admin" });
    await login("dave");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
  });

  it("lists the bundled plugins to Admins only", async () => {
    const res = await as("dave").get("/api/admin/plugins");
    expect(res.status).toBe(200);
    expect(res.body.bundled.map((p: { id: string }) => p.id)).toContain("org.mobsimlab.ferry");
    expect(res.body).toMatchObject({ installed: [], keys: [], developmentMode: false, allowUnsigned: false });
    expect((await as("bob").get("/api/admin/plugins")).status).toBe(403);
    expect((await as("bob").upload("/api/admin/plugins", pkg())).status).toBe(403);
  });

  it("refuses unsigned and untrusted packages, and installs one signed with a trusted key", async () => {
    const unsigned = await as("dave").upload("/api/admin/plugins/inspect", zip(samplePlugin()));
    expect(unsigned.status).toBe(200);
    expect(unsigned.body.inspection.signature).toBe("unsigned");
    expect(unsigned.body.inspection.problems.join()).toContain("not signed");

    const untrusted = await as("dave").upload("/api/admin/plugins", pkg());
    expect(untrusted.status).toBe(400);
    expect(untrusted.body.problems.join()).toContain("does not trust");

    expect((await as("dave").post("/api/admin/plugin-keys", { name: "Lab", publicKey: "nope" })).status).toBe(
      400,
    );
    const key = await as("dave").post("/api/admin/plugin-keys", {
      name: "Example Transit Lab",
      publicKey: labPem,
    });
    expect(key.status).toBe(201);
    expect(
      (await as("dave").post("/api/admin/plugin-keys", { name: "Again", publicKey: labPem })).status,
    ).toBe(409);

    const look = await as("dave").upload("/api/admin/plugins/inspect", pkg());
    expect(look.body.inspection).toMatchObject({
      signature: "trusted",
      signer: "Example Transit Lab",
      problems: [],
      plugin: {
        id: "org.example.water-taxi",
        version: "1.0.0",
        contributes: { modes: ["Water taxi"], parameters: 1 },
      },
    });
    const ok = await as("dave").upload("/api/admin/plugins", pkg());
    expect(ok.status).toBe(201);
    expect(ok.body.plugin).toMatchObject({ id: "org.example.water-taxi", signature: { status: "trusted" } });
    const again = await as("dave").upload("/api/admin/plugins", pkg());
    expect(again.body.problems).toContain("org.example.water-taxi 1.0.0 is already installed");
    expect((await as("dave").upload("/api/admin/plugins", pkg({ version: "1.1.0" }))).status).toBe(201);

    const broken = await as("dave").upload("/api/admin/plugins", Buffer.from("not a zip"));
    expect(broken.body.problems).toEqual(["the file is not a ZIP package"]);

    const audit = await db.superuser();
    const { rows } = await audit.query(
      "SELECT action FROM audit.record WHERE chain = 'instance' AND action LIKE 'plugin.%' ORDER BY seq",
    );
    await audit.end();
    expect(rows.map((r) => r.action)).toEqual(["plugin.key_added", "plugin.installed", "plugin.installed"]);
  });

  let project = "";

  it("keeps installed plugins off in a project until its Owner turns one on, with a pinned version", async () => {
    project = (await as("bob").post("/api/projects", { name: "Harbour" })).body.project.id;
    await as("bob").post(`/api/projects/${project}/members`, { email: "alice@example.org", role: "editor" });
    const list = (await as("bob").get(`/api/projects/${project}/plugins`)).body.plugins;
    expect(list.find((p: { id: string }) => p.id === "org.mobsimlab.ferry")).toMatchObject({
      bundled: true,
      enabled: true,
    });
    const taxi = list.find((p: { id: string }) => p.id === "org.example.water-taxi");
    expect(taxi).toMatchObject({ enabled: false, versions: ["1.0.0", "1.1.0"], version: "1.1.0" });
    expect(taxi.entry).toBeUndefined();

    // An Editor cannot change plugins.
    expect(
      (await as("alice").put(`/api/projects/${project}/plugins/org.example.water-taxi`, { enabled: true }))
        .status,
    ).toBe(403);

    const on = await as("bob").put(`/api/projects/${project}/plugins/org.example.water-taxi`, {
      enabled: true,
      version: "1.0.0",
    });
    expect(on.status).toBe(200);
    const t = on.body.plugins.find((p: { id: string }) => p.id === "org.example.water-taxi");
    expect(t).toMatchObject({ enabled: true, version: "1.0.0" });
    expect(t.entry.modes[0].id).toBe("water_taxi");
    expect(
      (
        await as("bob").put(`/api/projects/${project}/plugins/org.example.water-taxi`, {
          enabled: true,
          version: "9.9.9",
        })
      ).status,
    ).toBe(400);

    const off = await as("bob").put(`/api/projects/${project}/plugins/org.mobsimlab.noise`, {
      enabled: false,
    });
    expect(off.body.plugins.find((p: { id: string }) => p.id === "org.mobsimlab.noise").enabled).toBe(false);

    // A copy keeps the project's plugin choices.
    const copy = (await as("bob").post(`/api/projects/${project}/duplicate`)).body.project.id;
    const copied = (await as("bob").get(`/api/projects/${copy}/plugins`)).body.plugins;
    expect(copied.find((p: { id: string }) => p.id === "org.example.water-taxi")).toMatchObject({
      enabled: true,
      version: "1.0.0",
    });
    expect(copied.find((p: { id: string }) => p.id === "org.mobsimlab.noise").enabled).toBe(false);
  });

  it("refuses to remove a version projects use, unless the Admin confirms", async () => {
    const used = await as("dave").del("/api/admin/plugins/org.example.water-taxi/1.0.0");
    expect(used.status).toBe(409);
    expect(used.body.projects.length).toBe(2);
    expect((await as("dave").del("/api/admin/plugins/org.example.water-taxi/1.1.0")).status).toBe(200);
    expect(
      (await as("dave").del("/api/admin/plugins/org.example.water-taxi/1.0.0", { force: true })).status,
    ).toBe(200);
    const list = (await as("bob").get(`/api/projects/${project}/plugins`)).body.plugins;
    expect(list.find((p: { id: string }) => p.id === "org.example.water-taxi")).toMatchObject({
      enabled: false,
      missing: true,
      versions: [],
    });
    const admin = (await as("dave").get("/api/admin/plugins")).body;
    expect(admin.installed).toEqual([]);
  });

  it("installs a plugin with code: compiles it in the sandbox, serves it to members and runs it (Phase 2)", async () => {
    const pkgFile = zip(signed(examplePlugin(), lab.privateKey));
    const seen = await as("dave").upload("/api/admin/plugins/inspect", pkgFile);
    expect(seen.body.inspection.problems).toEqual([]);
    expect(seen.body.inspection.plugin).toMatchObject({ runsCode: true, tiers: ["compute", "ui"] });
    // A component that imports WASI (or anything but the host) is refused at install.
    const files = examplePlugin();
    files.set("wasm/importer.wasm", files.get("wasm/calculation.wasm")!);
    const wrong = await as("dave").upload("/api/admin/plugins/inspect", zip(signed(files, lab.privateKey)));
    expect(wrong.body.inspection.problems.join("\n")).toContain("must export only importFiles");

    const installed = await as("dave").upload("/api/admin/plugins", pkgFile);
    expect(installed.status).toBe(201);
    const sha = installed.body.plugin.sha256 as string;

    const p = (await as("bob").post("/api/projects", { name: "Timetables" })).body.project.id as string;
    const code = `/api/projects/${p}/plugins/org.example.timetable-csv/code/wasm/calculation.wasm/glue.js`;
    expect((await as("bob").get(code)).status).toBe(404); // off until the Owner turns it on
    await as("bob").put(`/api/projects/${p}/plugins/org.example.timetable-csv`, { enabled: true });
    const listed = (await as("bob").get(`/api/projects/${p}/plugins`)).body;
    expect(listed.limits).toEqual({ memoryMb: 256, timeS: 30 });
    expect(listed.plugins.find((x: { id: string }) => x.id === "org.example.timetable-csv")).toMatchObject({
      enabled: true,
      sha256: sha,
    });
    const glue = await as("bob").get(code);
    expect(glue.status).toBe(200);
    expect(glue.headers["content-type"]).toContain("text/javascript");
    expect(String(glue.text)).toContain("export function instantiate");
    const wasm = await as("bob").get(code.replace("glue.js", "glue.core.wasm")).buffer(true);
    expect(wasm.headers["content-type"]).toBe("application/wasm");
    // Non-members get nothing.
    expect((await as("alice").get(code)).status).toBe(404);

    // Tab pages: no session needed, sandboxed by CSP, framed only by MobSimLab.
    const page = await request(app.getHttpServer()).get(`/api/plugin-ui/${sha}/tab/index.html`);
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain("sandbox allow-scripts");
    expect(page.headers["content-security-policy"]).toContain("connect-src 'none'");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(
      (await request(app.getHttpServer()).get(`/api/plugin-ui/${sha}/mobsimlab-plugin.json`)).status,
    ).toBe(404);
    expect((await request(app.getHttpServer()).get(`/api/plugin-ui/${sha}/tab/..%2f..%2fx.js`)).status).toBe(
      400,
    );

    // On the server (agent tools): runs in the tool-runner with the instance's limits.
    const codeSvc = app.get(PluginCodeService);
    const bob = { userId: browsers.bob!.id, role: "user" as const, ipHash: null, requestId: null };
    const csv = "t1,A,bus,Harbour,47.1,8.1,07:00\nt1,A,bus,Market,47.11,8.11,07:06\n";
    const imported = await codeSvc.run(bob, p, "org.example.timetable-csv", "importer", "csv_import", {
      files: [{ name: "times.csv", data: Buffer.from(csv) }],
    });
    expect(imported.output).toMatchObject({ summary: { trips: 1, stops: 2 } });
    const sum = await codeSvc.run(bob, p, "org.example.timetable-csv", "calculation", "route_summary", {
      input: JSON.stringify({ inputs: { timetable: (imported.output as { timetable: unknown }).timetable } }),
    });
    expect(sum.output).toMatchObject({
      kpis: [
        { id: "routes", value: 1 },
        { id: "trips", value: 1 },
      ],
    });
    expect(sum.logs).toEqual([["info", "summing up routes"]]);

    // Admins set the limits; the audit keeps the change.
    expect((await as("bob").put("/api/admin/plugin-limits", { memoryMb: 128, timeS: 10 })).status).toBe(403);
    expect((await as("dave").put("/api/admin/plugin-limits", { memoryMb: 8, timeS: 10 })).status).toBe(400);
    const set = await as("dave").put("/api/admin/plugin-limits", { memoryMb: 128, timeS: 10 });
    expect(set.body.limits).toEqual({ memoryMb: 128, timeS: 10 });
    expect((await as("dave").get("/api/admin/plugins")).body.limits).toEqual({ memoryMb: 128, timeS: 10 });

    // Removing the version removes its code.
    await as("dave").del("/api/admin/plugins/org.example.timetable-csv/1.0.0", { force: true });
    const su = await db.superuser();
    const { rows } = await su.query(
      "SELECT count(*)::int AS n FROM plugin.file WHERE plugin_id = 'org.example.timetable-csv'",
    );
    await su.end();
    expect(rows[0].n).toBe(0);
  });

  it("lets an Owner allow unsigned plugins only in development mode", async () => {
    expect((await as("dave").put("/api/admin/plugin-settings", { allowUnsigned: true })).status).toBe(403);
    expect((await as("alice").put("/api/admin/plugin-settings", { allowUnsigned: true })).status).toBe(409);

    const dev = await createApp({ ...config, developmentMode: true });
    try {
      await login("alice", dev);
      expect((await as("alice", dev).put("/api/admin/plugin-settings", { allowUnsigned: true })).status).toBe(
        200,
      );
      const res = await as("alice", dev).upload(
        "/api/admin/plugins",
        zip(samplePlugin({ version: "2.0.0" })),
      );
      expect(res.status).toBe(201);
      expect(res.body.plugin.signature).toEqual({ status: "unsigned", signer: null });
      // Outside development mode the setting has no effect.
      expect((await as("dave").get("/api/admin/plugins")).body.allowUnsigned).toBe(false);
    } finally {
      await dev.close();
    }
  });
});

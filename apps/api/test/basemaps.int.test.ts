import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EsriImageryClient } from "../src/basemaps/esri.client";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

const KEY = "AAPTesriTestKey_0123456789abcdefWXYZ";

/** Integration: the Admin's ArcGIS key for Esri World Imagery, and its tiles through the API. */
describe("Esri World Imagery", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const browsers: Record<string, { cookie: string; csrf: string; id: string }> = {};

  async function login(sub: string): Promise<void> {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in: ${String(res.headers.location)}`);
    const cookie = `msl_session=${token}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken, id: me.user.id };
  }

  const as = (sub: string) => {
    const b = browsers[sub];
    if (!b) throw new Error(`${sub} is not signed in`);
    const server = app.getHttpServer();
    const write = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
      patch: (path: string, body: object) => write(request(server).patch(path)).send(body),
      del: (path: string) => write(request(server).delete(path)).send({}),
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
    await request(app.getHttpServer())
      .post("/api/setup/finish")
      .set("Cookie", browsers.alice!.cookie)
      .set("Origin", config.publicUrl.origin)
      .set("X-CSRF-Token", browsers.alice!.csrf);
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
    vi.restoreAllMocks();
  });

  it("is not offered and serves no tiles until an Admin saves a key", async () => {
    expect((await as("bob").get("/api/basemaps")).body).toEqual({ available: [] });
    expect((await as("bob").get("/api/basemaps/esri/tiles/1/0/0")).status).toBe(404);
    expect((await request(app.getHttpServer()).get("/api/basemaps/esri/tiles/1/0/0")).status).toBe(401);
    const status = await as("alice").get("/api/admin/basemaps");
    expect(status.body.esri).toMatchObject({ configured: false, keyEnd: null });
  });

  it("lets only Admins save a key, and only with Esri's terms accepted", async () => {
    expect((await as("bob").put("/api/admin/basemaps/esri", { apiKey: KEY, acceptTerms: true })).status).toBe(
      403,
    );
    expect((await as("alice").put("/api/admin/basemaps/esri", { apiKey: KEY })).status).toBe(400);
    expect(
      (await as("alice").put("/api/admin/basemaps/esri", { apiKey: "short", acceptTerms: true })).status,
    ).toBe(400);
    const saved = await as("alice").put("/api/admin/basemaps/esri", { apiKey: KEY, acceptTerms: true });
    expect(saved.status).toBe(200);
    expect(saved.body.esri).toMatchObject({ configured: true, keyEnd: "WXYZ" });
    expect(saved.body.esri.termsAcceptedAt).toBeTruthy();
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    expect(JSON.stringify((await as("alice").get("/api/admin/basemaps")).body)).not.toContain(KEY);

    // The audit log records who accepted the terms, never the key.
    const su = await db.superuser();
    const { rows } = await su.query(
      "SELECT action, after::text AS after FROM audit.record WHERE action LIKE 'instance.esri_key%' ORDER BY seq",
    );
    await su.end();
    expect(rows.map((r: { action: string }) => r.action)).toEqual(["instance.esri_key_set"]);
    expect(rows[0].after).not.toContain(KEY);
  });

  it("serves tiles to members through the API with the saved key", async () => {
    const tile = vi
      .spyOn(EsriImageryClient.prototype, "tile")
      .mockResolvedValue({ body: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg", maxAgeS: 600 });
    expect((await as("bob").get("/api/basemaps")).body).toEqual({ available: ["esri"] });
    const res = await as("bob").get("/api/basemaps/esri/tiles/12/1434/2145");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("private, max-age=600");
    expect(tile).toHaveBeenCalledWith(KEY, 12, 2145, 1434);
    expect((await as("bob").get("/api/basemaps/esri/tiles/1/5/0")).status).toBe(400);
    expect((await as("bob").get("/api/basemaps/esri/tiles/a/0/0")).status).toBe(400);
    tile.mockRestore();
  });

  it("stops at once when the key is removed", async () => {
    expect((await as("bob").del("/api/admin/basemaps/esri")).status).toBe(403);
    const removed = await as("alice").del("/api/admin/basemaps/esri");
    expect(removed.body.esri).toMatchObject({ configured: false, keyEnd: null });
    expect((await as("bob").get("/api/basemaps")).body).toEqual({ available: [] });
    expect((await as("bob").get("/api/basemaps/esri/tiles/1/0/0")).status).toBe(404);
  });
});

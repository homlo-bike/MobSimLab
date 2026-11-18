import type { NestExpressApplication } from "@nestjs/platform-express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EsriImageryClient } from "../src/basemaps/esri.client";
import { readCapabilities } from "../src/basemaps/ogc";
import type { BuiltinService } from "../src/basemaps/builtin-layers";
import { MapLayersService } from "../src/basemaps/map-layers.service";
import { OgcClient, OgcError } from "../src/basemaps/ogc.client";
import { CredentialVault } from "../src/config/credential-vault";
import { CredentialsAtRest } from "../src/config/credentials-at-rest";
import type { AppConfig } from "../src/config/env";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

// A made-up key with little variety, so secret scanners do not take it for a real one.
const KEY = `test-${"x".repeat(26)}WXYZ`;

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
      post: (path: string, body: object) => write(request(server).post(path)).send(body),
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
    expect((await as("bob").get("/api/basemaps")).body).toEqual({ available: [], layers: [] });
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

  it("stores the key encrypted, and encrypts a key saved before encryption at the next start", async () => {
    const su = await db.superuser();
    const stored = async () =>
      (await su.query("SELECT esri_api_key FROM iam.instance")).rows[0].esri_api_key as string;
    const sealed = await stored();
    expect(sealed.startsWith("msv1:")).toBe(true);
    expect(sealed).not.toContain(KEY);
    expect(sealed).not.toContain(Buffer.from(KEY).toString("base64").slice(0, 12));

    // A value moved to another place does not read there.
    const vault = app.get(CredentialVault);
    expect(() => vault.decrypt(sealed, "plugin.map_layer_service.auth_secret:x")).toThrow();

    // A key from an older release, in plain text, is encrypted by the start-up pass and still works.
    await su.query("UPDATE iam.instance SET esri_api_key = $1", [KEY]);
    expect(await app.get(CredentialsAtRest).reseal()).toBe(1);
    const again = await stored();
    expect(again.startsWith("msv1:")).toBe(true);
    expect(vault.decrypt(again, "iam.instance.esri_api_key")).toBe(KEY);
    expect(await app.get(CredentialsAtRest).reseal()).toBe(0);
    await su.end();
  });

  it("serves tiles to members through the API with the saved key", async () => {
    const tile = vi
      .spyOn(EsriImageryClient.prototype, "tile")
      .mockResolvedValue({ body: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg", maxAgeS: 600 });
    expect((await as("bob").get("/api/basemaps")).body).toEqual({ available: ["esri"], layers: [] });
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
    expect((await as("bob").get("/api/basemaps")).body).toEqual({ available: [], layers: [] });
    expect((await as("bob").get("/api/basemaps/esri/tiles/1/0/0")).status).toBe(404);
  });

  describe("WMS, WMTS and XYZ map layers", () => {
    // A made-up secret with little variety, so secret scanners do not take it for a real one.
    const SECRET = `test-${"x".repeat(20)}KEY9`;
    const wms = readFileSync(join(__dirname, "fixtures", "ogc", "wms-130.xml"), "utf8");
    const service = {
      kind: "wms",
      url: "https://maps.example.org/services/service?request=GetCapabilities",
      auth: { type: "basic", name: "ana", secret: SECRET },
      name: "Topographic map",
      attribution: "© Example contributors",
      showAs: "basemap",
      layers: ["TOPO-OSM-WMS"],
    };

    it("lets only Admins read and add services, and never sends the password back or audits it", async () => {
      const caps = vi
        .spyOn(OgcClient.prototype, "capabilities")
        .mockImplementation(async () => readCapabilities("wms", wms));
      expect((await as("bob").get("/api/admin/map-layers")).status).toBe(403);
      expect((await as("bob").post("/api/admin/map-layers", service)).status).toBe(403);
      expect((await as("alice").get("/api/admin/map-layers")).body).toEqual({ services: [] });

      const found = await as("alice").post("/api/admin/map-layers/inspect", {
        kind: service.kind,
        url: service.url,
        auth: service.auth,
      });
      expect(found.status).toBe(200);
      expect(found.body.layers.map((l: { id: string }) => l.id)).toEqual([
        "TOPO-OSM-WMS",
        "SRTM30-Colored",
        "UTM-only",
      ]);
      expect(caps).toHaveBeenCalledWith("wms", service.url, service.auth);

      // Refused: an internal address, a layer the map cannot draw, an XYZ address without {z}/{x}/{y}.
      expect(
        (await as("alice").post("/api/admin/map-layers", { ...service, url: "https://10.0.0.1/wms" })).status,
      ).toBe(400);
      expect(
        (await as("alice").post("/api/admin/map-layers", { ...service, layers: ["UTM-only"] })).status,
      ).toBe(400);
      expect(
        (
          await as("alice").post("/api/admin/map-layers", {
            ...service,
            kind: "xyz",
            url: "https://t.example.org/tiles",
          })
        ).status,
      ).toBe(400);

      const added = await as("alice").post("/api/admin/map-layers", service);
      expect(added.status).toBe(201);
      expect(added.body.services).toHaveLength(1);
      expect(added.body.services[0]).toMatchObject({
        kind: "wms",
        name: "Topographic map",
        address: "maps.example.org/services/service",
        auth: { type: "basic", name: "ana" },
        layers: [{ id: "TOPO-OSM-WMS", title: "Topographic map & OSM" }],
      });
      expect(JSON.stringify(added.body)).not.toContain(SECRET);
      expect(JSON.stringify((await as("alice").get("/api/admin/map-layers")).body)).not.toContain(SECRET);

      const su = await db.superuser();
      const { rows } = await su.query(
        "SELECT action, after::text AS after FROM audit.record WHERE action LIKE 'instance.map_layer%' ORDER BY seq",
      );
      await su.end();
      expect(rows.map((r: { action: string }) => r.action)).toEqual(["instance.map_layer_service_added"]);
      expect(rows[0].after).not.toContain(SECRET);
      // The password is stored encrypted.
      const su2 = await db.superuser();
      const stored = (await su2.query("SELECT auth_secret FROM plugin.map_layer_service")).rows[0]
        .auth_secret;
      await su2.end();
      expect(stored.startsWith("msv1:")).toBe(true);
      expect(stored).not.toContain(SECRET);
      // A key belongs in the sign-in fields, not in the address, which is kept as typed.
      expect(
        (
          await as("alice").post("/api/admin/map-layers/inspect", {
            kind: "xyz",
            url: "https://t.example.org/{z}/{x}/{y}.png?apikey=abc123",
            auth: { type: "none" },
          })
        ).status,
      ).toBe(400);
      caps.mockRestore();
    });

    it("offers the layers to members with tiles through the API, signed in on the server", async () => {
      const listed = (await as("bob").get("/api/basemaps")).body;
      expect(listed.layers).toHaveLength(1);
      const layer = listed.layers[0];
      expect(layer).toMatchObject({
        label: "Topographic map",
        kind: "wms",
        showAs: "basemap",
        tileSize: 256,
      });
      expect(layer.tiles[0]).toMatch(/^\/api\/map-layers\/[0-9a-f-]+\/0\/tiles\/\{z\}\/\{x\}\/\{y\}$/);
      expect(JSON.stringify(listed)).not.toContain(SECRET);
      expect(JSON.stringify(listed)).not.toContain("maps.example.org");

      const fetched: { url: string; auth: unknown }[] = [];
      const tile = vi.spyOn(OgcClient.prototype, "tile").mockImplementation(async (_service, url, auth) => {
        fetched.push({ url: url.toString(), auth });
        return { body: Buffer.from([0x89, 0x50]), contentType: "image/png", maxAgeS: 0 };
      });
      const path = layer.tiles[0].replace("{z}", "12").replace("{x}", "2145").replace("{y}", "1434");
      const res = await as("bob").get(path);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(fetched[0]!.url).toContain("REQUEST=GetMap");
      expect(fetched[0]!.auth).toEqual(service.auth);
      expect((await as("bob").get(path.replace("/0/tiles/", "/7/tiles/"))).status).toBe(404);
      expect((await as("bob").get(path.replace("/tiles/12/", "/tiles/23/"))).status).toBe(400);
      expect((await request(app.getHttpServer()).get(path)).status).toBe(401);

      tile.mockRejectedValueOnce(
        new OgcError("the service refused access; an Admin should check the sign-in details", 502),
      );
      expect((await as("bob").get(path)).status).toBe(502);
      tile.mockRestore();
    });

    it("takes a removed service's layers off the maps", async () => {
      const id = (await as("alice").get("/api/admin/map-layers")).body.services[0].id;
      expect((await as("bob").del(`/api/admin/map-layers/${id}`)).status).toBe(403);
      expect((await as("alice").del(`/api/admin/map-layers/${id}`)).body).toEqual({ services: [] });
      expect((await as("bob").get("/api/basemaps")).body.layers).toEqual([]);
    });

    it("adds the built-in services once, and hides them instead of removing them", async () => {
      const caps = vi
        .spyOn(OgcClient.prototype, "capabilities")
        .mockImplementation(async () => readCapabilities("wms", wms));
      const builtins: BuiltinService[] = [
        {
          id: "example-topo",
          kind: "wms",
          url: "https://maps.example.org/osm/service",
          name: "Example topo",
          attribution: "© Example contributors",
          showAs: "basemap",
          layers: ["TOPO-OSM-WMS"],
          maxzoom: 9,
        },
        // A layer the service does not have (yet): skipped, tried again later.
        {
          ...service,
          id: "example-gone",
          url: "https://maps.example.org/gone",
          layers: ["Gone"],
        } as BuiltinService,
      ];
      const layers = app.get(MapLayersService);
      await layers.addBuiltins(builtins);
      await layers.addBuiltins(builtins);
      const listed = (await as("alice").get("/api/admin/map-layers")).body.services;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ name: "Example topo", builtin: true, hidden: false, addedBy: null });
      expect(caps).toHaveBeenCalledWith("wms", "https://maps.example.org/osm/service", { type: "none" });
      const offered = (await as("bob").get("/api/basemaps")).body.layers;
      expect(offered).toHaveLength(1);
      expect(offered[0].maxzoom).toBe(9);

      // Remove hides it, so the next start does not add it again; it can be shown again.
      const id = listed[0].id;
      expect((await as("alice").del(`/api/admin/map-layers/${id}`)).body.services[0].hidden).toBe(true);
      await layers.addBuiltins(builtins);
      expect((await as("alice").get("/api/admin/map-layers")).body.services).toHaveLength(1);
      expect((await as("bob").get("/api/basemaps")).body.layers).toEqual([]);
      expect((await as("bob").put(`/api/admin/map-layers/${id}/hidden`, { hidden: false })).status).toBe(403);
      const shown = await as("alice").put(`/api/admin/map-layers/${id}/hidden`, { hidden: false });
      expect(shown.body.services[0].hidden).toBe(false);
      expect((await as("bob").get("/api/basemaps")).body.layers).toHaveLength(1);
      caps.mockRestore();
    });
  });
});

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { OverpassClient } from "../src/gateway/overpass.client";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

const square = (x: number, y: number, d: number): [number, number][] => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
  [x, y],
];

/** Integration: the project area as drawn polygons (large-area projects, step 1). */
describe("project area polygons", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  const browsers: Record<string, { cookie: string; csrf: string }> = {};

  async function login(sub: string): Promise<void> {
    const res = await signIn(app, idp, sub);
    const token = cookieValue(res, "msl_session");
    if (!token) throw new Error(`${sub} could not sign in`);
    const cookie = `msl_session=${token}`;
    const me = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body;
    browsers[sub] = { cookie, csrf: me.csrfToken };
  }
  const as = (sub: string) => {
    const b = browsers[sub]!;
    const server = app.getHttpServer();
    const write = (r: request.Test) =>
      r.set("Cookie", b.cookie).set("Origin", config.publicUrl.origin).set("X-CSRF-Token", b.csrf);
    return {
      get: (path: string) => request(server).get(path).set("Cookie", b.cookie),
      post: (path: string, body: object = {}) => write(request(server).post(path)).send(body),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
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
    // Nothing reaches OpenStreetMap: country look-ups find nothing.
    const overpass = { run: async () => JSON.stringify({ elements: [] }) };
    app = await createApp(config, (b) => b.overrideProvider(OverpassClient).useValue(overpass));
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

  const damascus = { id: "a1", name: "Damascus", detail: "full", ring: square(36.2, 33.45, 0.15) };
  const corridor = {
    id: "a2",
    name: "M5 corridor",
    detail: "main",
    ring: [
      [36.29, 33.5],
      [37.16, 36.19],
      [37.18, 36.2],
      [36.31, 33.51],
      [36.29, 33.5],
    ],
  };

  it("estimates a drawn area before the project exists", async () => {
    const r = await as("bob").post("/api/area/estimate", { polygons: [damascus, corridor] });
    expect(r.status).toBe(200);
    expect(r.body.tiles.full).toBeGreaterThan(0);
    expect(r.body.tiles.main).toBeGreaterThan(100);
    expect(r.body.limitBytes).toBe(1000 * 1024 * 1024);
    expect(r.body.overLimit).toBe(false);
    expect(r.body.polygons.map((p: { id: string }) => p.id)).toEqual(["a1", "a2"]);
    expect(
      (await as("bob").post("/api/area/estimate", { polygons: [{ ...damascus, detail: "x" }] })).status,
    ).toBe(400);
  });

  it("saves polygons as the area, which alone set the box imports cover", async () => {
    const p = (await as("alice").post("/api/projects", { name: "Syria intercity" })).body.project;
    const base = `/api/projects/${p.id}/area`;
    // Nothing drawn yet: no area.
    const empty = (await as("alice").get(base)).body;
    expect(empty).toMatchObject({ polygons: [], bbox: null, dataDate: null });

    const set = await as("alice").put(base, { polygons: [damascus, corridor], import: false });
    expect(set.status).toBe(200);
    expect(set.body.polygons.map((x: { name: string }) => x.name)).toEqual(["Damascus", "M5 corridor"]);
    expect(set.body.bbox).toEqual([36.2, 33.45, 37.18, 36.2]);
    expect(set.body.estimate.tiles.main).toBeGreaterThan(100);

    const read = (await as("alice").get(base)).body;
    expect(read.polygons).toEqual(set.body.polygons);
    expect((await as("alice").get(`/api/projects/${p.id}`)).body.project.areaName).toBe(
      "Damascus, M5 corridor",
    );

    // A copy keeps the drawn area.
    const copy = (await as("alice").post(`/api/projects/${p.id}/duplicate`, { name: "Copy" })).body.project;
    expect((await as("alice").get(`/api/projects/${copy.id}/area`)).body.polygons).toEqual(set.body.polygons);

    // An area over the limit is refused with what it holds.
    const huge = { id: "a3", name: "Too much", detail: "full", ring: square(35, 32, 3) };
    const refused = await as("alice").put(base, { polygons: [huge], import: false });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/MB of map data, more than the 1000 MB/);
    expect((await as("alice").get(base)).body.polygons).toHaveLength(2);

    // Members who only read cannot change it; people outside the project cannot read it.
    expect((await as("bob").get(base)).status).toBe(404);
  });

  it("downloads the map data again on Refresh, for Owners and Editors", async () => {
    const p = (await as("alice").post("/api/projects", { name: "Refresh" })).body.project;
    await as("alice").put(`/api/projects/${p.id}/area`, { polygons: [damascus], import: false });
    const r = await as("alice").post(`/api/projects/${p.id}/area/refresh`);
    expect(r.status).toBe(200);
    expect(r.body.imports.map((i: { kind: string }) => i.kind).sort()).toEqual(["dem", "osm", "population"]);
    expect((await as("bob").post(`/api/projects/${p.id}/area/refresh`)).status).toBe(404);
  });
});

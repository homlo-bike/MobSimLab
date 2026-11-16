import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { GhslClient } from "../src/gateway/ghsl.client";
import { OverpassClient } from "../src/gateway/overpass.client";
import { WorldPopClient } from "../src/gateway/worldpop.client";
import { converterFor } from "../src/population/crs";
import { createApp, testConfig } from "./support/app";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";
import { buildTiff, buildZip } from "./support/tiff";

/** Integration: population layers of a project (06-gis §3): imports, uploads, primary layer, difference. */
describe("population layers", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  let ghslDir: string;
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
      post: (path: string, body: object = {}) => write(request(server).post(path)).send(body),
      put: (path: string, body: object) => write(request(server).put(path)).send(body),
      patch: (path: string, body: object) => write(request(server).patch(path)).send(body),
      del: (path: string) => write(request(server).delete(path)).send({}),
      upload: (path: string, info: object, bytes: Uint8Array) =>
        write(request(server).post(path))
          .query({ info: JSON.stringify(info) })
          .set("Content-Type", "application/octet-stream")
          .send(Buffer.from(bytes)),
    };
  };

  // GHSL tile R5 C19 (0° to 10° E, 40° to 50° N) at 0.01°: 2 people per cell.
  const tile = buildZip({
    "GHS_POP_R5_C19.tif": buildTiff({
      width: 1000,
      height: 1000,
      value: () => 2,
      origin: [0, 50],
      pixel: [0.01, 0.01],
      compression: "deflate",
      tile: 256,
    }),
  });

  beforeAll(async () => {
    db = await startDatabase();
    idp = await startIdp();
    ghslDir = await mkdtemp(join(tmpdir(), "ghsl-int-"));
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: idp.issuer, clientId: "mobsimlab", allowInsecureHttp: true },
    });
    const ghsl = new GhslClient({
      base: "https://ghsl.test/G",
      path: "{epoch}/{res}/R{row}_C{col}.zip",
      cacheDir: ghslDir,
      backoffMs: [],
      fetchImpl: (async (url: string) =>
        url.endsWith("2025/3ss/R5_C19.zip")
          ? new Response(tile, { status: 200 })
          : new Response("no", { status: 404 })) as unknown as typeof fetch,
    });
    // WorldPop: one Luxembourg grid, half a person per 100 m cell.
    const worldpop = {
      entry: async (iso3: string, year?: number) => ({
        iso3,
        year: year === 2020 ? 2020 : 2025,
        url: "https://data.worldpop.org/GIS/x/lux.tif",
        citation: "WorldPop test citation",
        doi: "",
      }),
      file: async () => ({ path: "", header: {} }),
      addTo: async (grid: { people: Float64Array }) => {
        grid.people.fill(0.5);
      },
      downloadProgress: () => null,
    };
    const overpass = {
      run: async () => JSON.stringify({ elements: [{ tags: { "ISO3166-1:alpha3": "LUX" } }] }),
    };
    app = await createApp(config, (b) =>
      b
        .overrideProvider(GhslClient)
        .useValue(ghsl)
        .overrideProvider(WorldPopClient)
        .useValue(worldpop)
        .overrideProvider(OverpassClient)
        .useValue(overpass),
    );
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
    await rm(ghslDir, { recursive: true, force: true });
  });

  let project = "";
  const base = () => `/api/projects/${project}/population`;
  const waitReady = async (layerId: string) => {
    for (let i = 0; i < 100; i++) {
      const l = (await as("alice").get(`${base()}/layers/${layerId}`)).body.layer;
      if (l.status !== "importing") return l;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("import did not finish");
  };

  it("has no area until something is drawn, then the box round it widened by the buffer", async () => {
    project = (await as("alice").post("/api/projects", { name: "Population" })).body.project.id;
    const empty = (await as("alice").get(base())).body;
    expect(empty).toMatchObject({ area: null, bufferKm: 2, layers: [] });
    expect((await as("alice").post(`${base()}/imports`, { source: "ghsl" })).status).toBe(400);
    const saved = await as("alice").put(`/api/projects/${project}/drawings/street-lines`, {
      doc: { lines: [{ points: [{ lonlat: [6.1, 49.6] }, { lonlat: [6.12, 49.61] }] }] },
      baseVersion: null,
    });
    expect(saved.status).toBe(200);
    const o = (await as("alice").get(base())).body;
    expect(o.area.drawnBbox).toEqual([6.1, 49.6, 6.12, 49.61]);
    expect(o.area.bbox[1]).toBeCloseTo(49.6 - 2 / 111.32, 6);
    const changed = (await as("alice").put(`${base()}/area`, { bufferKm: 1 })).body;
    expect(changed.bufferKm).toBe(1);
    expect(changed.area.bbox[1]).toBeCloseTo(49.6 - 1 / 111.32, 6);
    expect((await as("alice").put(`${base()}/area`, { bufferKm: 51 })).status).toBe(400);
    // Someone without access cannot tell the project exists.
    expect((await as("bob").get(base())).status).toBe(404);
  });

  let ghsl = "";
  let worldpop = "";
  it("imports GHSL and WorldPop for the project area in the background", async () => {
    const g = await as("alice").post(`${base()}/imports`, { source: "ghsl" });
    expect(g.status).toBe(201);
    expect(g.body.layer).toMatchObject({
      source: "ghsl",
      status: "importing",
      referenceYear: 2025,
      resolutionM: 100,
    });
    const gl = await waitReady(g.body.layer.id);
    expect(gl).toMatchObject({ status: "ready", name: "GHSL 2025, 100 m", confidence: "medium" });
    expect(gl.options.tiles).toEqual(["R5_C19"]);
    // 2 people per 0.01° cell whose centre lies in the area.
    expect(gl.peopleTotal / 2).toBe(gl.featureCount);
    expect(gl.featureCount).toBeGreaterThan(10);
    expect(gl.citation).toMatch(/GHS-POP R2023A/);
    ghsl = gl.id;

    const w = await as("alice").post(`${base()}/imports`, { source: "worldpop", year: 2020 });
    const wl = await waitReady(w.body.layer.id);
    expect(wl).toMatchObject({
      status: "ready",
      source: "worldpop",
      referenceYear: 2020,
      citation: "WorldPop test citation",
    });
    expect(wl.options.countries).toEqual(["LUX"]);
    expect(wl.peopleTotal).toBeCloseTo(wl.featureCount * 0.5, 6);
    worldpop = wl.id;
    expect((await as("alice").post(`${base()}/imports`, { source: "ghsl", epoch: 2026 })).status).toBe(400);
  });

  let zones = "";
  it("stores the planner's own GeoJSON zones, CSV values per zone, CSV points and a GeoTIFF in UTM", async () => {
    const details = { name: "Census zones", licence: "Own data", confidence: "high", referenceYear: 2022 };
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "Z1", pop: 1000 },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [6.1, 49.6],
                [6.11, 49.6],
                [6.11, 49.61],
                [6.1, 49.61],
                [6.1, 49.6],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: { id: "Z2", pop: 500 },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [6.11, 49.6],
                [6.12, 49.6],
                [6.12, 49.61],
                [6.11, 49.61],
                [6.11, 49.6],
              ],
            ],
          },
        },
      ],
    };
    const z = await as("alice").upload(
      `${base()}/uploads`,
      { details, file: { format: "geojson", peopleField: "pop", zoneField: "id" } },
      new TextEncoder().encode(JSON.stringify(fc)),
    );
    expect(z.status).toBe(201);
    expect(z.body.layer).toMatchObject({
      kind: "zones",
      status: "ready",
      peopleTotal: 1500,
      featureCount: 2,
      referenceYear: 2022,
    });
    expect(z.body.layer.coverage).toEqual([6.1, 49.6, 6.12, 49.61]);
    zones = z.body.layer.id;

    const joined = await as("alice").upload(
      `${base()}/uploads`,
      {
        details: { ...details, name: "Census 2024" },
        file: { format: "csv", mode: "zones", zoneField: "zone", peopleField: "people", zonesLayerId: zones },
      },
      new TextEncoder().encode("zone;people\nZ1;1100\nZ9;5\n"),
    );
    expect(joined.status).toBe(201);
    expect(joined.body.layer).toMatchObject({ kind: "zones", peopleTotal: 1100, featureCount: 1 });
    expect(joined.body.layer.options.notes).toEqual([
      "1 zone ids of the CSV match no zone and were left out.",
    ]);

    const pts = await as("alice").upload(
      `${base()}/uploads`,
      {
        details: { ...details, name: "Addresses" },
        file: { format: "csv", mode: "points", lonField: "x", latField: "y", peopleField: "n" },
      },
      new TextEncoder().encode("x,y,n\n6.105,49.605,3\n6.115,49.605,4\n"),
    );
    expect(pts.body.layer).toMatchObject({ kind: "points", peopleTotal: 7 });

    const utm = converterFor(32632);
    const [x0, y0] = utm.fromLonLat([6.1, 49.61]);
    const tif = buildTiff({
      width: 10,
      height: 10,
      value: () => 1,
      origin: [Math.round(x0), Math.round(y0)],
      pixel: [100, 100],
      epsg: 32632,
      geographic: false,
      compression: "deflate",
    });
    const grid = await as("alice").upload(
      `${base()}/uploads`,
      { details: { ...details, name: "Census grid" }, file: { format: "geotiff" } },
      tif,
    );
    expect(grid.status).toBe(201);
    expect(grid.body.layer).toMatchObject({ kind: "grid", peopleTotal: 100, featureCount: 100 });
    expect(grid.body.layer.resolutionM).toBeCloseTo(100, -1);

    const bad = await as("alice").upload(
      `${base()}/uploads`,
      { details, file: { format: "geotiff" } },
      new Uint8Array(10),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/not a TIFF/);
    const noField = await as("alice").upload(
      `${base()}/uploads`,
      { details, file: { format: "geojson", peopleField: "nope" } },
      new TextEncoder().encode(JSON.stringify(fc)),
    );
    expect(noField.body.message).toMatch(/No feature has the field "nope"/);
    expect((await as("alice").get(base())).body.layers.length).toBe(6);
  });

  it("feeds the primary layer to the noise map and benefit tables, and WorldPop when there is none", async () => {
    const box = [6.1, 49.6, 6.12, 49.61];
    const set = await as("alice").put(`${base()}/primary`, { layerId: zones });
    expect(
      set.body.layers.filter((l: { isPrimary: boolean }) => l.isPrimary).map((l: { id: string }) => l.id),
    ).toEqual([zones]);
    const g = await as("alice").post(`${base()}/grid`, { bbox: box });
    expect(g.status).toBe(200);
    expect(g.body.status).toBe("ready");
    expect(g.body.source).toMatchObject({ id: `layer:${zones}`, name: "Census zones", year: 2022 });
    const sum = (g.body.grid.people as number[]).reduce((a, v) => a + v, 0);
    // People per cell are rounded to hundredths.
    expect(Math.abs(sum - 1500)).toBeLessThan(2);
    const b = await as("alice").post(`${base()}/catchments`, {
      areas: [
        {
          id: "west",
          ring: [
            [6.1, 49.6],
            [6.11, 49.6],
            [6.11, 49.61],
            [6.1, 49.61],
            [6.1, 49.6],
          ],
        },
      ],
    });
    expect(Math.abs(b.body.populations.west - 1000)).toBeLessThan(2);
    expect(b.body.source.name).toBe("Census zones");
    // No access, no project data.
    expect((await as("bob").post(`${base()}/grid`, { bbox: box })).status).toBe(404);
    // Back to WorldPop's live grid (stubbed: half a person per cell).
    await as("alice").put(`${base()}/primary`, { layerId: null });
    const live = await as("alice").post(`${base()}/grid`, { bbox: box });
    expect(live.body.source.id).toBe("worldpop_r2025a");
  });

  it("shows a layer and the difference between two layers on a lattice", async () => {
    const one = (await as("alice").post(`${base()}/lattice`, { layerId: zones, cellM: 1000 })).body;
    expect(one.cellM).toBe(1019);
    const total = (one.grid.values as number[]).reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(1500, 0);
    const diff = (
      await as("alice").post(`${base()}/lattice`, { layerId: zones, minusId: worldpop, cellM: 1000 })
    ).body;
    const wl = (await as("alice").get(`${base()}/layers/${worldpop}`)).body.layer;
    const dsum = (diff.grid.values as number[]).reduce((a, v) => a + v, 0);
    expect(dsum).toBeCloseTo(1500 - wl.peopleTotal, -1);
    expect((await as("alice").post(`${base()}/lattice`, { layerId: zones, cellM: 10 })).status).toBe(400);
  });

  it("changes details, deletes layers and keeps an audit trail", async () => {
    const p = await as("alice").patch(`${base()}/layers/${ghsl}`, { confidence: "low", name: "GHSL check" });
    expect(p.body.layer).toMatchObject({ confidence: "low", name: "GHSL check" });
    await as("alice").put(`${base()}/primary`, { layerId: ghsl });
    expect((await as("alice").del(`${base()}/layers/${ghsl}`)).status).toBe(200);
    const after = (await as("alice").get(base())).body.layers;
    expect(after.some((l: { id: string }) => l.id === ghsl)).toBe(false);
    expect(after.some((l: { isPrimary: boolean }) => l.isPrimary)).toBe(false);
    const su = await db.superuser();
    const { rows } = await su.query(
      "SELECT action FROM audit.record WHERE object_id = $1 AND action LIKE 'project.population%' ORDER BY seq",
      [project],
    );
    await su.end();
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "project.population_imported",
        "project.population_uploaded",
        "project.population_primary_changed",
        "project.population_layer_changed",
        "project.population_layer_deleted",
      ]),
    );
  });
});

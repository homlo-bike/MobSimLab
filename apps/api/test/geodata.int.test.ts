import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env";
import { cellName } from "../src/gateway/copernicus-dem.client";
import { GeodataService } from "../src/geodata/geodata.service";
import { tilesFor } from "../src/street-network/street-network.service";
import { createApp, testConfig } from "./support/app";
import { buildCog, height, W } from "./support/cog";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/**
 * Integration: OpenStreetMap and elevation imported per project area (ADR-0045), with the real osmium and
 * osm2pgsql, the real flex style and PostGIS. Overpass and the GLO-30 bucket are faked: Overpass answers the
 * fixture `small.osm` for every tile, the bucket serves the small COG of `support/cog.ts` over N50 E007.
 */
const FIXTURE = join(__dirname, "fixtures", "small.osm");
const OSM_XML = readFileSync(FIXTURE, "utf8");
const COG = buildCog();

describe("geodata import", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  let dataDir: string;
  let project = "";
  const overpassQueries: string[] = [];
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
      upload: (path: string, data: Buffer) =>
        write(request(server).post(path)).set("Content-Type", "application/octet-stream").send(data),
      del: (path: string) => write(request(server).delete(path)),
    };
  };

  const idle = () => app.get(GeodataService).idle();

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "msl-geodata-"));
    vi.stubEnv("MOBSIMLAB_DATA_DIR", dataDir);
    vi.stubEnv("MOBSIMLAB_OSM_OVERPASS_INTERVAL_S", "0");
    vi.stubEnv("MOBSIMLAB_ELEVATION_FALLBACK", "off");
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://overpass-api.de/")) {
        overpassQueries.push(new URLSearchParams(String(init?.body)).get("data") ?? "");
        return new Response(OSM_XML, { status: 200 });
      }
      if (u.startsWith("https://copernicus-dem-30m.s3.amazonaws.com/")) {
        if (u.split("/").at(-2) !== cellName(7.5, 50.5)) return new Response("", { status: 404 });
        const m = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range") ?? "")!;
        return new Response(COG.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
      }
      return realFetch(url, init);
    });
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
    project = (await as("alice").post("/api/projects", { name: "Riverside" })).body.project.id;
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await app?.close();
    await idp?.server.stop();
    await db?.container.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("asks for a drawing before importing", async () => {
    const st = await as("alice").get(`/api/projects/${project}/geodata`);
    expect(st.status).toBe(200);
    expect(st.body.area).toBeNull();
    expect(st.body.canImport).toBe(true);
    expect(
      (await as("alice").post(`/api/projects/${project}/geodata/osm`, { method: "overpass" })).status,
    ).toBe(400);
    // Someone without access cannot tell the project exists.
    expect((await as("bob").get(`/api/projects/${project}/geodata`)).status).toBe(404);
  });

  it("imports OpenStreetMap through Overpass into the project's tables", async () => {
    const su = await db.superuser();
    await su.query(`INSERT INTO project.drawing (project_id, kind, doc) VALUES ($1, 'street-lines', $2)`, [
      project,
      JSON.stringify({
        lines: [
          {
            points: [
              [7.0, 50.0],
              [7.01, 50.2],
            ],
          },
        ],
      }),
    ]);
    await su.end();
    const st = (await as("alice").get(`/api/projects/${project}/geodata`)).body;
    expect(st.area.drawnBbox).toEqual([7.0, 50.0, 7.01, 50.2]);
    expect(st.area.bufferKm).toBe(2);
    expect(st.suggestedMethod).toBe("overpass");

    const start = await as("alice").post(`/api/projects/${project}/geodata/osm`, { method: "overpass" });
    expect(start.status).toBe(201);
    expect(start.body.import).toMatchObject({ kind: "osm", method: "overpass", status: "queued" });
    expect(
      (await as("bob").post(`/api/projects/${project}/geodata/osm`, { method: "overpass" })).status,
    ).toBe(404);
    await idle();

    const done = (await as("alice").get(`/api/projects/${project}/geodata`)).body;
    expect(done.osm.latest.error).toBeNull();
    expect(done.osm.current).toMatchObject({ status: "done", method: "overpass" });
    expect(done.osm.coversDrawing).toBe(true);
    expect(done.osm.current.source).toMatchObject({
      name: "OpenStreetMap",
      licence: "© OpenStreetMap contributors, ODbL 1.0",
      dataTimestamp: "2026-11-15T08:00:00Z",
    });
    // The 2 km buffer makes the area larger than one 3 km tile; every tile answers the same fixture, and the
    // merge keeps each object once.
    expect(overpassQueries.length).toBeGreaterThan(1);
    expect(done.osm.current.stats.rows).toMatchObject({
      osm_way_road: 1,
      osm_way_rail: 1,
      osm_building: 1,
      osm_structure: 2,
      osm_water: 1,
    });
    // A construction road is left out unless the import asks for planned roads.
    const su2 = await db.superuser();
    const roads = await su2.query(`SELECT osm_id::int AS id FROM geo.osm_way_road WHERE project_id = $1`, [
      project,
    ]);
    expect(roads.rows).toEqual([{ id: 100 }]);
    await su2.end();
  });

  it("serves street tiles, buildings and places from the import", async () => {
    const [x, y] = tilesFor([7.005, 50.003, 7.005, 50.003])[0]!;
    overpassQueries.length = 0;
    const streets = await as("alice").get(`/api/street-network/tiles/14/${x}/${y}?project=${project}`);
    expect(streets.status).toBe(200);
    expect(streets.text).toContain('<way id="100"');
    expect(streets.text).not.toContain('<way id="103"');
    const rail = await as("alice").get(`/api/street-network/rail-tiles/14/${x}/${y}?project=${project}`);
    expect(rail.text).toContain('<way id="103"');
    const buildings = await as("alice").get(
      `/api/street-network/building-tiles/14/${x}/${y}?project=${project}`,
    );
    expect(buildings.body.buildings).toEqual([
      expect.objectContaining({ id: "w102", levels: 3, use: "school", homes: false }),
    ]);
    const places = await as("alice").get(`/api/street-network/place-tiles/14/${x}/${y}?project=${project}`);
    expect(places.body.places.map((p: { id: string; kind: string }) => [p.id, p.kind]).sort()).toEqual([
      ["n8", "school"],
      ["w102", "school"],
    ]);
    const water = await as("alice").get(
      `/api/street-network/water?bbox=6.99,49.99,7.02,50.05&project=${project}`,
    );
    expect(water.status).toBe(200);
    expect(Object.keys(water.body).sort()).toEqual(["areas", "rivers", "sea"]);
    // Nothing of that came from Overpass.
    expect(overpassQueries).toEqual([]);
    // A project the caller cannot read is a 404, and a malformed one a 400.
    expect((await as("bob").get(`/api/street-network/tiles/14/${x}/${y}?project=${project}`)).status).toBe(
      404,
    );
    expect((await as("alice").get(`/api/street-network/tiles/14/${x}/${y}?project=nope`)).status).toBe(400);
  });

  it("imports GLO-30 heights and answers terrain requests from them", async () => {
    const start = await as("alice").post(`/api/projects/${project}/geodata/dem`);
    expect(start.status).toBe(201);
    await idle();
    const st = (await as("alice").get(`/api/projects/${project}/geodata`)).body;
    expect(st.dem.current).toMatchObject({ status: "done", method: "copernicus" });
    expect(st.dem.current.stats.tiles).toBeGreaterThan(0);
    expect(st.dem.current.source).toMatchObject({ id: "copernicus_glo30", verticalAccuracyM: 4 });

    // Pixel centres of the fake COG: column c, row r at 7 + c/W, 51 - r/W. Halfway between columns 0 and 1 and
    // rows 6 and 7 the bilinear height is the mean of the four.
    const res = await as("alice").post("/api/terrain/points", {
      points: [[7 + 0.5 / W, 51 - 6.5 / W]],
      projectId: project,
    });
    expect(res.status).toBe(200);
    expect(res.body.elevationsM[0]).toBeCloseTo(
      (height(0, 6) + height(1, 6) + height(0, 7) + height(1, 7)) / 4,
      2,
    );
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].retrievedAt).toBeTruthy();
  });

  it("replaces the import with an uploaded .osm.pbf, keeping planned roads when asked", async () => {
    const pbf = join(dataDir, "fixture.osm.pbf");
    execFileSync("osmium", ["cat", "--overwrite", FIXTURE, "-o", pbf]);
    const before = (await as("alice").get(`/api/projects/${project}/geodata`)).body.osm.current.id;
    const up = await as("alice").upload(
      `/api/projects/${project}/geodata/osm/upload?name=small.osm.pbf&planned=true`,
      readFileSync(pbf),
    );
    expect(up.status).toBe(201);
    expect(up.body.import).toMatchObject({ method: "upload", options: { planned: true } });
    await idle();
    const st = (await as("alice").get(`/api/projects/${project}/geodata`)).body;
    expect(st.osm.latest.error).toBeNull();
    expect(st.osm.current.id).toBe(up.body.import.id);
    expect(st.osm.current.source.via).toBe("Uploaded file small.osm.pbf");
    const su = await db.superuser();
    const imports = await su.query(`SELECT id FROM geo.import WHERE project_id = $1 AND kind = 'osm'`, [
      project,
    ]);
    expect(imports.rows.map((r) => r.id)).toEqual([up.body.import.id]);
    const roads = await su.query(
      `SELECT osm_id::int AS id FROM geo.osm_way_road WHERE project_id = $1 ORDER BY osm_id`,
      [project],
    );
    expect(roads.rows).toEqual([{ id: 100 }, { id: 101 }]);
    const old = await su.query(`SELECT count(*)::int AS n FROM geo.osm_building WHERE import_id = $1`, [
      before,
    ]);
    expect(old.rows[0].n).toBe(0);
    await su.end();
    // Something that is not an .osm.pbf fails the import, and the earlier one stays current.
    const bad = await as("alice").upload(
      `/api/projects/${project}/geodata/osm/upload`,
      Buffer.from("not a pbf"),
    );
    expect(bad.status).toBe(201);
    await idle();
    const after = (await as("alice").get(`/api/projects/${project}/geodata`)).body;
    expect(after.osm.latest.status).toBe("failed");
    expect(after.osm.latest.error).toMatch(/osmium/);
    expect(after.osm.current.id).toBe(up.body.import.id);
  });

  it("removes an import and its data", async () => {
    const st = (await as("alice").get(`/api/projects/${project}/geodata`)).body;
    expect(
      (await as("alice").del(`/api/projects/${project}/geodata/imports/${st.dem.current.id}`)).status,
    ).toBe(204);
    const su = await db.superuser();
    const tiles = await su.query(`SELECT count(*)::int AS n FROM geo.dem_tile WHERE project_id = $1`, [
      project,
    ]);
    expect(tiles.rows[0].n).toBe(0);
    await su.end();
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env";
import { CopernicusDemClient, cellName } from "../src/gateway/copernicus-dem.client";
import { GeodataService } from "../src/geodata/geodata.service";
import { SharedDataStore } from "../src/geodata/shared-data";
import { tilesFor } from "../src/street-network/street-network.service";
import { createApp, testConfig } from "./support/app";
import { buildCog, W } from "./support/cog";
import { startDatabase, type TestDatabase } from "./support/database";
import { cookieValue, signIn, startIdp, type TestIdp } from "./support/idp";

/**
 * Integration: map data held once for the instance (large-area projects, step 4). Two projects in the same area
 * download each street tile, height and GLO-30 byte range once. Overpass and the GLO-30 bucket are faked and
 * count their requests.
 */
const OSM_XML = readFileSync(join(__dirname, "fixtures", "small.osm"), "utf8");
const COG = buildCog();

describe("shared map data", () => {
  let db: TestDatabase;
  let idp: TestIdp;
  let app: NestExpressApplication;
  let config: AppConfig;
  let dataDir: string;
  let cookie = "";
  let csrf = "";
  let su: Client;
  const overpassQueries: string[] = [];
  const bucketRanges: string[] = [];

  const get = (path: string) => request(app.getHttpServer()).get(path).set("Cookie", cookie);
  const post = (path: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set("Cookie", cookie)
      .set("Origin", config.publicUrl.origin)
      .set("X-CSRF-Token", csrf)
      .send(body);

  // One polygon in the GLO-30 cell the fake bucket serves (N50 E007).
  const ring = [
    [7.0, 50.0],
    [7.4, 50.0],
    [7.4, 50.4],
    [7.0, 50.4],
    [7.0, 50.0],
  ];
  const newProject = async (name: string): Promise<string> => {
    const id = (await post("/api/projects", { name })).body.project.id as string;
    await su.query(`UPDATE project.project SET area_polygons = $2 WHERE id = $1`, [
      id,
      JSON.stringify([{ id: "a1", name: "Area", detail: "full", ring }]),
    ]);
    return id;
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "msl-shared-"));
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
        const range = new Headers(init?.headers).get("Range") ?? "";
        bucketRanges.push(`${u.split("/").at(-2)} ${range}`);
        if (u.split("/").at(-2) !== cellName(7.5, 50.5)) return new Response("", { status: 404 });
        const m = /bytes=(\d+)-(\d+)/.exec(range)!;
        return new Response(COG.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
      }
      return realFetch(url, init);
    });
    db = await startDatabase();
    su = await db.superuser();
    idp = await startIdp();
    config = testConfig({
      db: { host: db.host, port: db.port, name: "mobsimlab" },
      secrets: { ...testConfig().secrets, db_app_password: db.appPassword },
      oidc: { issuer: idp.issuer, clientId: "mobsimlab", allowInsecureHttp: true },
    });
    app = await createApp(config);
    const res = await signIn(app, idp, "alice");
    cookie = `msl_session=${cookieValue(res, "msl_session")}`;
    csrf = (await request(app.getHttpServer()).get("/api/auth/me").set("Cookie", cookie)).body.csrfToken;
    await post("/api/setup/finish");
  }, 180_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await app?.close();
    await su?.end();
    await idp?.server.stop();
    await db?.container.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("downloads a street tile once for two projects in the same area, each pointing at the one copy", async () => {
    const a = await newProject("North");
    const b = await newProject("South");
    const [x, y] = tilesFor([7.01, 50.01, 7.01, 50.01])[0]!;
    const first = await get(`/api/street-network/tiles/14/${x}/${y}?project=${a}`);
    expect(first.status).toBe(200);
    expect(overpassQueries).toHaveLength(1);
    const second = await get(`/api/street-network/tiles/14/${x}/${y}?project=${b}`);
    expect(second.text).toBe(first.text);
    expect(overpassQueries).toHaveLength(1);
    const copies = await su.query(`SELECT id FROM geo.shared_data WHERE kind = 'osm' AND key = $1`, [
      `road/${x}/${y}`,
    ]);
    expect(copies.rows).toHaveLength(1);
    const uses = await su.query(`SELECT project_id FROM project.data_use WHERE shared_id = $1 ORDER BY 1`, [
      copies.rows[0].id,
    ]);
    expect(uses.rows.map((r) => r.project_id).sort()).toEqual([a, b].sort());

    // A copy older than MOBSIMLAB_OSM_CACHE_DAYS (7) is not taken by a new project, which gets a copy of its own.
    await su.query(`UPDATE geo.shared_data SET data_date = now() - interval '30 days' WHERE kind = 'osm'`);
    const c = await newProject("East");
    await get(`/api/street-network/tiles/14/${x}/${y}?project=${c}`);
    const own = await su.query(
      `SELECT s.id, s.data_date > now() - interval '1 day' AS fresh FROM project.data_use u
       JOIN geo.shared_data s ON s.id = u.shared_id WHERE u.project_id = $1`,
      [c],
    );
    expect(own.rows).toEqual([{ id: expect.not.stringMatching(`^${copies.rows[0].id}$`), fresh: true }]);
    // The projects that used the older copy keep it until they fetch again.
    const kept = await su.query(`SELECT shared_id FROM project.data_use WHERE project_id = $1`, [a]);
    expect(kept.rows).toEqual([{ shared_id: copies.rows[0].id }]);
    expect(overpassQueries).toHaveLength(1);

    // Deleting a project leaves the copies the others use.
    await su.query(`DELETE FROM project.project WHERE id = $1`, [b]);
    expect(
      (await su.query(`SELECT 1 FROM geo.shared_data WHERE id = $1`, [copies.rows[0].id])).rowCount,
    ).toBe(1);
  });

  it("reads heights and GLO-30 ranges once for two projects in the same area", async () => {
    const a = await newProject("Hill");
    const b = await newProject("Valley");
    const points = [[7 + 0.5 / W, 51 - 6.5 / W]];
    const ha = await post("/api/terrain/points", { points, projectId: a });
    expect(ha.status).toBe(200);
    expect(ha.body.liveCount).toBe(1);
    const afterA = bucketRanges.length;
    expect(afterA).toBeGreaterThan(0);
    const hb = await post("/api/terrain/points", { points, projectId: b });
    expect(hb.body.elevationsM).toEqual(ha.body.elevationsM);
    expect(bucketRanges).toHaveLength(afterA);

    // Elevation imports: the second project reads every range from the store, none from the bucket.
    expect((await post(`/api/projects/${a}/geodata/dem`)).status).toBe(201);
    await app.get(GeodataService).idle();
    const afterImportA = bucketRanges.length;
    expect((await post(`/api/projects/${b}/geodata/dem`)).status).toBe(201);
    await app.get(GeodataService).idle();
    expect(bucketRanges).toHaveLength(afterImportA);
    const st = (await get(`/api/projects/${b}/geodata`)).body;
    expect(st.dem.current).toMatchObject({ status: "done", method: "copernicus" });
    expect(st.dem.current.stats.tiles).toBeGreaterThan(0);
    const ranges = await su.query(`SELECT count(*)::int AS n FROM geo.shared_data WHERE kind = 'glo30'`);
    expect(ranges.rows[0].n).toBeGreaterThan(0);
    // A client with nothing in memory (another process, or after a restart) reads the ranges from the store too.
    const fresh = new CopernicusDemClient({ store: app.get(SharedDataStore).glo30() });
    const win = await fresh.window(cellName(7.5, 50.5), [7, 50, 7.4, 50.4]);
    expect(win?.values.some((v) => !Number.isNaN(v))).toBe(true);
    expect(bucketRanges).toHaveLength(afterImportA);
  });
});

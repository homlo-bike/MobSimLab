import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  CopernicusDemClient,
  cellName,
  copernicusEndpoint,
  decodeTile,
  parseHeader,
} from "../src/gateway/copernicus-dem.client";
import { OverpassClient } from "../src/gateway/overpass.client";
import { buildingHeight, buildingQuery, crossings } from "../src/terrain/buildings";
import { TerrainModule } from "../src/terrain/terrain.module";
import { OpenElevationClient } from "../src/gateway/open-elevation.client";
import { distanceM, samplePositions } from "../src/terrain/terrain.service";

import { W, buildCog, height } from "./support/cog";

const COG = buildCog();

function fakeHost(status: Record<string, number> = {}) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const name = u.split("/").at(-2)!;
    if (status[name]) return new Response("", { status: status[name] });
    if (name !== cellName(7.5, 50.5)) return new Response("<Error/>", { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("Range") ?? "")!;
    const body = COG.slice(Number(m[1]), Number(m[2]) + 1);
    return new Response(body, { status: 206 });
  });
  return {
    fetchImpl,
    client: new CopernicusDemClient({
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => {},
      backoffMs: [1],
    }),
  };
}

/** Longitude and latitude of a pixel centre of the synthetic cell (row 0 lies on the cell's north edge). */
const at = (col: number, row: number): [number, number] => [7 + col / W, 51 - row / W];

describe("Copernicus GLO-30 reader", () => {
  it("names cells like the published bucket", () => {
    expect(cellName(6.96, 50.94)).toBe("Copernicus_DSM_COG_10_N50_00_E006_00_DEM");
    expect(cellName(-0.1, -0.1)).toBe("Copernicus_DSM_COG_10_S01_00_W001_00_DEM");
    expect(cellName(-122.4, 37.8)).toBe("Copernicus_DSM_COG_10_N37_00_W123_00_DEM");
  });

  it("accepts only https endpoints", () => {
    expect(copernicusEndpoint({})).toBe("https://copernicus-dem-30m.s3.amazonaws.com");
    expect(copernicusEndpoint({ MOBSIMLAB_COPERNICUS_URL: "https://dem.example.org/" })).toBe(
      "https://dem.example.org",
    );
    expect(() => copernicusEndpoint({ MOBSIMLAB_COPERNICUS_URL: "http://dem.example.org" })).toThrow();
  });

  it("parses the header and decodes a predicted, deflated tile", () => {
    const h = parseHeader(COG);
    expect([h.width, h.tileWidth, h.predictor, h.compression]).toEqual([8, 4, 3, 8]);
    expect(h.originLon).toBeCloseTo(7 - 1 / 16, 12);
    const t3 = decodeTile(COG.subarray(h.tileOffsets[3]!, h.tileOffsets[3]! + h.tileByteCounts[3]!), h);
    expect(t3[0]).toBe(height(4, 4));
    expect(t3[15]).toBe(height(7, 7));
  });

  it("interpolates bilinearly between pixel centres", async () => {
    const { client, fetchImpl } = fakeHost();
    expect(await client.elevation(...at(1, 2))).toBe(height(1, 2));
    // Halfway between four pixels across the tile boundary.
    const [lon, lat] = at(3.5, 3.5);
    expect(await client.elevation(lon, lat)).toBeCloseTo(100 + 3.5 + 35, 6);
    // Clamped at the cell edge.
    expect(await client.elevation(7.0001, 50.9999)).toBeCloseTo(height(0, 0), 1);
    // One header read plus each of the four tiles once, whatever the number of points.
    for (let i = 0; i < 20; i++) await client.elevation(...at(i % 8, 1 + ((i * 3) % 7)));
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("gives null outside DEM coverage and retries busy hosts", async () => {
    const { client } = fakeHost();
    expect(await client.elevation(-30, 40)).toBeNull();
    const busy = fakeHost({ [cellName(7.5, 50.5)]: 503 });
    await expect(busy.client.elevation(7.5, 50.5)).rejects.toThrow("503");
    expect(busy.fetchImpl).toHaveBeenCalledTimes(2);
  });
});

/** A square building, `size` m wide, centred `atM` metres east of (7.1, 50.5). */
function square(id: number, atM: number, size: number, tags: Record<string, string>) {
  const k = 111_320 * Math.cos((50.5 * Math.PI) / 180);
  const x = (m: number) => 7.1 + m / k;
  const y = (m: number) => 50.5 + m / 111_320;
  const h = size / 2;
  const ring = [
    [atM - h, -h],
    [atM + h, -h],
    [atM + h, h],
    [atM - h, h],
    [atM - h, -h],
  ].map(([a, b]) => ({ lon: x(a!), lat: y(b!) }));
  return { type: "way", id, tags: { building: "yes", ...tags }, geometry: ring };
}
const k50 = 111_320 * Math.cos((50.5 * Math.PI) / 180);
const LINE: Array<[number, number]> = [
  [7.1, 50.5],
  [7.1 + 500 / k50, 50.5],
];
const OSM = JSON.stringify({
  elements: [
    square(1, 100, 20, { height: "32 m" }),
    square(2, 300, 10, { "building:levels": "4" }),
    square(3, 450, 8, {}),
  ],
});
const overpass = { run: vi.fn(async () => OSM) };

describe("buildings along a line", () => {
  it("reads heights from tags", () => {
    expect(buildingHeight({ height: "32 m" })).toEqual({ heightM: 32, estimated: false });
    expect(buildingHeight({ "building:levels": "4", "roof:levels": "1" })).toEqual({
      heightM: 17,
      estimated: false,
    });
    expect(buildingHeight({})).toEqual({ heightM: 10, estimated: true });
  });

  it("asks Overpass for the buildings in padded boxes along the line", () => {
    const q = buildingQuery(LINE);
    // 500 m in two pieces of 250 m, each a box padded by 6 m.
    expect(q.match(/way\["building"\]\(/g)).toHaveLength(2);
    expect(q.match(/rel\["building"\]\(/g)).toHaveLength(2);
    expect(q).toContain('way["building"](50.4999461,7.0999153,50.5000539,');
  });

  it("finds where the line passes over each building", () => {
    const c = crossings(LINE, OSM);
    expect(c.map((b) => b.osmId)).toEqual([1, 2, 3]);
    // 20 m wide plus 6 m either side.
    expect(Math.abs(c[0]!.fromM - 84)).toBeLessThanOrEqual(2); // sampled every 2 m
    expect(Math.abs(c[0]!.toM - 116)).toBeLessThanOrEqual(2);
    expect(c[0]!.heightM).toBe(32);
    expect(c[1]!.heightM).toBe(14);
    expect(c[2]!.estimated).toBe(true);
  });

  it("joins the outer ways of a multipolygon building, such as a cathedral", () => {
    // Building 1's outline split into two ways, the second one reversed, on a relation.
    const ring = square(1, 200, 30, {}).geometry;
    const rel = {
      type: "relation",
      id: 99,
      tags: { type: "multipolygon", building: "cathedral", height: "157" },
      members: [
        { type: "way", role: "outer", geometry: ring.slice(0, 3) },
        { type: "way", role: "outer", geometry: ring.slice(2).reverse() },
        { type: "way", role: "inner", geometry: square(2, 200, 4, {}).geometry },
      ],
    };
    const c = crossings(LINE, JSON.stringify({ elements: [rel] }));
    expect(c).toHaveLength(1);
    expect(c[0]!.osmId).toBe(99);
    expect(c[0]!.heightM).toBe(157);
    expect(Math.abs(c[0]!.toM - c[0]!.fromM - 42)).toBeLessThanOrEqual(4);
  });
});

describe("terrain profiles", () => {
  it("samples every spacing and at every vertex", () => {
    const line: Array<[number, number]> = [
      [7.1, 50.5],
      [7.1, 50.501],
      [7.102, 50.501],
    ];
    const len1 = distanceM(line[0]!, line[1]!);
    const ps = samplePositions(line, 50);
    expect(ps[0]!.distM).toBe(0);
    expect(ps.some((p) => Math.abs(p.distM - len1) < 0.01)).toBe(true);
    expect(ps.filter((p) => p.distM % 50 === 0).length).toBeGreaterThan(3);
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.distM).toBeGreaterThan(ps[i - 1]!.distM);
      expect(ps[i]!.distM - ps[i - 1]!.distM).toBeLessThanOrEqual(50.01);
    }
  });

  it("serves points and profiles, with null outside coverage and the source", async () => {
    const { client } = fakeHost();
    const mod = await Test.createTestingModule({ imports: [TerrainModule] })
      .overrideProvider(CopernicusDemClient)
      .useValue(client)
      .overrideProvider(OverpassClient)
      .useValue(overpass)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const http = () => request(app.getHttpServer());

    const pts = await http()
      .post("/api/terrain/points")
      .send({ points: [at(1, 2), [-30, 40]] })
      .expect(200);
    expect(pts.body.elevationsM).toEqual([height(1, 2), null]);
    expect(pts.body.source.name).toBe("Copernicus DEM GLO-30");
    expect(pts.body.source.verticalAccuracyM).toBe(4);

    const prof = await http()
      .post("/api/terrain/profile")
      .send({ lines: [[at(1, 1), at(1, 7)], [at(2, 2)]], spacingM: 100 })
      .expect(200);
    const [a, b] = prof.body.lines;
    expect(a.lengthM).toBeGreaterThan(8_000);
    expect(a.samples[0].elevationM).toBe(height(1, 1));
    expect(a.samples.at(-1).elevationM).toBe(height(1, 7));
    expect(a.samples.length).toBe(Math.ceil(a.lengthM / 100) + 1);
    expect(b.samples).toEqual([{ distM: 0, lon: at(2, 2)[0], lat: at(2, 2)[1], elevationM: height(2, 2) }]);

    const withBuildings = await http()
      .post("/api/terrain/profile")
      .send({ lines: [LINE], spacingM: 100, buildings: true })
      .expect(200);
    expect(withBuildings.body.lines[0].buildings.map((b: { osmId: number }) => b.osmId)).toEqual([1, 2, 3]);
    expect(withBuildings.body.buildingSource.licence).toContain("OpenStreetMap");
    expect(prof.body.lines[0].buildings).toBeUndefined();

    await http().post("/api/terrain/profile").send({ lines: [] }).expect(400);
    await http()
      .post("/api/terrain/points")
      .send({ points: [[200, 0]] })
      .expect(400);
    await http()
      .post("/api/terrain/profile")
      .send({
        lines: [
          [
            [7, 50],
            [8, 51],
          ],
        ],
        spacingM: 5,
      })
      .expect(400);
    await app.close();
  });

  it("passes on an unavailable DEM host as 502 when the fallback is off", async () => {
    const { client } = fakeHost({ [cellName(7.5, 50.5)]: 500 });
    const mod = await Test.createTestingModule({ imports: [TerrainModule] })
      .overrideProvider(CopernicusDemClient)
      .useValue(client)
      .overrideProvider(OverpassClient)
      .useValue(overpass)
      .overrideProvider(OpenElevationClient)
      .useValue(null)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer())
      .post("/api/terrain/points")
      .send({ points: [[7.5, 50.5]] })
      .expect(502);
    await app.close();
  });

  it("falls back to Open-Elevation when the DEM host cannot be read", async () => {
    const { client } = fakeHost({ [cellName(7.5, 50.5)]: 500 });
    const asked: unknown[] = [];
    const fallback = new OpenElevationClient({
      endpoint: "https://elevation.example",
      batchSize: 2,
      minIntervalMs: 0,
      backoffMs: [],
      fetchImpl: (async (url: string, init: RequestInit) => {
        expect(url).toBe("https://elevation.example/api/v1/lookup");
        const body = JSON.parse(String(init.body)) as {
          locations: { latitude: number; longitude: number }[];
        };
        asked.push(body.locations.length);
        return new Response(
          JSON.stringify({
            results: body.locations.map((l) => ({ ...l, elevation: Math.round(l.latitude * 10) })),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    const mod = await Test.createTestingModule({ imports: [TerrainModule] })
      .overrideProvider(CopernicusDemClient)
      .useValue(client)
      .overrideProvider(OverpassClient)
      .useValue(overpass)
      .overrideProvider(OpenElevationClient)
      .useValue(fallback)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer())
      .post("/api/terrain/points")
      .send({
        points: [
          [7.5, 50.5],
          [7.6, 50.6],
          [7.7, 50.7],
          [7.5, 50.5],
        ],
      })
      .expect(200);
    expect(res.body.elevationsM).toEqual([505, 506, 507, 505]);
    // Three distinct points in batches of two.
    expect(asked).toEqual([2, 1]);
    expect(res.body.source.id).toBe("open_elevation");
    expect(res.body.sources.map((x: { id: string }) => x.id)).toEqual(["open_elevation"]);
    await app.close();
  });
});

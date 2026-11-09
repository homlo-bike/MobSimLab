import { deflateSync } from "node:zlib";
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
import { distanceM, samplePositions } from "../src/terrain/terrain.service";

/**
 * A small GLO-30-like COG: 8×8 pixels in 4×4 tiles over the cell N50 E007, float32, DEFLATE,
 * floating-point predictor. Height = 100 + col + 10 × row, so bilinear values are easy to check.
 */
const W = 8;
const T = 4;
const height = (col: number, row: number) => 100 + col + 10 * row;

function predictRow(values: number[]): Uint8Array {
  const w = values.length;
  const f = new DataView(new ArrayBuffer(4 * w));
  values.forEach((v, i) => f.setFloat32(4 * i, v, false)); // big-endian: byte 0 is the most significant
  const planes = new Uint8Array(4 * w);
  for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) planes[k * w + x] = f.getUint8(4 * x + k);
  const out = new Uint8Array(4 * w);
  for (let i = 0; i < out.length; i++) out[i] = (planes[i]! - (i ? planes[i - 1]! : 0)) & 0xff;
  return out;
}

function buildCog(): Uint8Array {
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < W / T; ty++)
    for (let tx = 0; tx < W / T; tx++) {
      const rows: Uint8Array[] = [];
      for (let r = 0; r < T; r++)
        rows.push(predictRow(Array.from({ length: T }, (_, c) => height(tx * T + c, ty * T + r))));
      tiles.push(deflateSync(Buffer.concat(rows)));
    }
  const scale = 1 / W;
  const entries: Array<[number, number, number[]]> = [
    [256, 3, [W]],
    [257, 3, [W]],
    [258, 3, [32]],
    [259, 3, [8]],
    [277, 3, [1]],
    [317, 3, [3]],
    [322, 3, [T]],
    [323, 3, [T]],
    [324, 4, [0, 0, 0, 0]],
    [325, 4, tiles.map((t) => t.length)],
    [339, 3, [3]],
    [33550, 12, [scale, scale, 0]],
    [33922, 12, [0, 0, 0, 7 - scale / 2, 51 + scale / 2, 0]],
  ];
  const ifd = 8;
  const size = (t: number) => ({ 3: 2, 4: 4, 12: 8 })[t as 3 | 4 | 12];
  let extra = ifd + 2 + entries.length * 12 + 4;
  const layout = entries.map(([, type, vals]) => {
    const n = size(type) * vals.length;
    if (n <= 4) return -1;
    const at = extra;
    extra += n;
    return at;
  });
  let dataAt = extra;
  entries[8]![2] = tiles.map((t) => {
    const at = dataAt;
    dataAt += t.length;
    return at;
  });
  const buf = new Uint8Array(dataAt);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49]);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, entries.length, true);
  entries.forEach(([tag, type, vals], i) => {
    const e = ifd + 2 + i * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, vals.length, true);
    const at = layout[i]! < 0 ? e + 8 : layout[i]!;
    if (layout[i]! >= 0) dv.setUint32(e + 8, at, true);
    vals.forEach((v, k) => {
      if (type === 3) dv.setUint16(at + 2 * k, v, true);
      else if (type === 4) dv.setUint32(at + 4 * k, v, true);
      else dv.setFloat64(at + 8 * k, v, true);
    });
  });
  let at = extra;
  for (const t of tiles) {
    buf.set(t, at);
    at += t.length;
  }
  return buf;
}

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

  it("asks Overpass for buildings around the polyline", () => {
    expect(buildingQuery(LINE)).toContain('way["building"](around:6,50.5000000,7.1000000,50.5000000,');
    expect(buildingQuery(LINE)).toContain('rel["building"](around:6,');
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

  it("passes on an unavailable DEM host as 502", async () => {
    const { client } = fakeHost({ [cellName(7.5, 50.5)]: 500 });
    const mod = await Test.createTestingModule({ imports: [TerrainModule] })
      .overrideProvider(CopernicusDemClient)
      .useValue(client)
      .overrideProvider(OverpassClient)
      .useValue(overpass)
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    await request(app.getHttpServer())
      .post("/api/terrain/points")
      .send({ points: [[7.5, 50.5]] })
      .expect(502);
    await app.close();
  });
});

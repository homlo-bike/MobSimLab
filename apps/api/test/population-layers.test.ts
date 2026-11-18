import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GhslClient, nearestEpoch, tilesFor, tileUrl } from "../src/gateway/ghsl.client";
import { extractEntry, zipEntries } from "../src/gateway/zipfile";
import { converterFor, CrsError, epsgDefinition } from "../src/population/crs";
import { bufferReader, openGeoTiff, packBitsDecode } from "../src/population/geotiff";
import { addFeature, inPolygon, latticeOver } from "../src/population/lattice";
import { boxAreaKm2, cellDegrees } from "../src/population/layers.service";
import {
  parseCsv,
  parseCsvPoints,
  parseCsvZones,
  parseGeoJson,
  parseGeoTiff,
  peopleValue,
  ringAreaM2,
} from "../src/population/uploads";
import { boxOf, bufferedBox, drawnPoints } from "../src/projects/project-area";
import { buildTiff, buildZip } from "./support/tiff";

const LIMITS = { maxFeatures: 100_000 };
const enc = (s: string) => new TextEncoder().encode(s);

describe("GeoTIFF reader", () => {
  const value = (c: number, r: number) => (c + 1) * 10 + r;
  const cases = [
    { name: "float32 strips, little-endian, uncompressed", spec: { type: "float32" as const } },
    {
      name: "float32 tiles, deflate, floating point predictor",
      spec: { tile: 16, compression: "deflate" as const, predictor: 3 as const },
    },
    {
      name: "float64 big-endian strips of 3 rows, deflate",
      spec: {
        type: "float64" as const,
        littleEndian: false,
        rowsPerStrip: 3,
        compression: "deflate" as const,
      },
    },
    {
      name: "int16 big-endian, horizontal predictor",
      spec: { type: "int16" as const, littleEndian: false, predictor: 2 as const },
    },
    {
      name: "uint16 tiles, horizontal predictor, deflate",
      spec: { type: "uint16" as const, tile: 16, predictor: 2 as const, compression: "deflate" as const },
    },
  ];
  for (const c of cases)
    it(`reads ${c.name}`, async () => {
      const buf = buildTiff({ width: 20, height: 7, value, origin: [6, 50], pixel: [0.01, 0.01], ...c.spec });
      const g = await openGeoTiff(bufferReader(buf));
      expect(g.width).toBe(20);
      expect(g.height).toBe(7);
      expect(g.crs).toMatchObject({ epsg: 4326, geographic: true });
      expect(g.transform).toEqual([6, 0.01, 0, 50, 0, -0.01]);
      const w = await g.window(3, 2, 19, 7);
      expect(w.length).toBe(16 * 5);
      expect(w[0]).toBe(value(3, 2));
      expect(w[16 * 4 + 15]).toBe(value(18, 6));
    });

  it("turns no data into NaN and names a projected system", async () => {
    const buf = buildTiff({
      width: 4,
      height: 2,
      value: (c) => (c === 1 ? -200 : 5),
      noData: -200,
      origin: [500_000, 5_600_000],
      pixel: [100, 100],
      epsg: 32632,
      geographic: false,
    });
    const g = await openGeoTiff(bufferReader(buf));
    expect(g.crs).toMatchObject({ epsg: 32632, geographic: false });
    const w = await g.window(0, 0, 4, 1);
    expect(Number.isNaN(w[1])).toBe(true);
    expect(w[0]).toBe(5);
  });

  it("refuses files that are not GeoTIFFs", async () => {
    await expect(openGeoTiff(bufferReader(enc("hello world, not a tiff")))).rejects.toThrow(/not a TIFF/);
  });

  it("decodes PackBits", () => {
    expect([...packBitsDecode(new Uint8Array([2, 1, 2, 3, 0xfe, 9]), 6)]).toEqual([1, 2, 3, 9, 9, 9]);
  });
});

describe("coordinate systems", () => {
  it("converts UTM to longitude and latitude and back", () => {
    const c = converterFor(32632);
    const [lon, lat] = c.toLonLat([500_000, 5_650_000]);
    expect(lon).toBeCloseTo(9, 6);
    expect(lat).toBeCloseTo(51.0, 0);
    const [x, y] = c.fromLonLat([lon, lat]);
    expect(x).toBeCloseTo(500_000, 3);
    expect(y).toBeCloseTo(5_650_000, 3);
  });

  it("prefers the planner's own definition and names unknown systems", () => {
    expect(converterFor(null, "EPSG:3035").toLonLat([4_321_000, 3_210_000])[0]).toBeCloseTo(10, 6);
    expect(converterFor(9999, "+proj=longlat +datum=WGS84").toLonLat([7, 50])).toEqual([7, 50]);
    expect(() => converterFor(9999)).toThrow(CrsError);
    expect(() => converterFor(null)).toThrow(/does not name its coordinate system/);
    expect(epsgDefinition(25832)).toContain("+zone=32");
    expect(epsgDefinition(32718)).toContain("+south");
  });
});

describe("uploads", () => {
  it("reads a census grid in UTM, clipped to the project area, counts or densities", async () => {
    // 10 × 10 cells of 100 m, 4 people each, around 9° E 51° N.
    const buf = buildTiff({
      width: 10,
      height: 10,
      value: () => 4,
      origin: [499_500, 5_651_000],
      pixel: [100, 100],
      epsg: 32632,
      geographic: false,
    });
    const all = await parseGeoTiff(
      buf,
      { format: "geotiff", values: "count", clipToArea: true },
      null,
      LIMITS,
    );
    expect(all.kind).toBe("grid");
    expect(all.features.length).toBe(100);
    expect(all.resolutionM).toBeCloseTo(100, 0);
    // A box covering only the western half.
    const c = converterFor(32632);
    const [w, s] = c.toLonLat([499_500, 5_650_000]);
    const [e, n] = c.toLonLat([499_990, 5_651_000]);
    const half = await parseGeoTiff(
      buf,
      { format: "geotiff", values: "count", clipToArea: true },
      [w - 1e-5, s - 1e-5, e, n + 1e-5],
      LIMITS,
    );
    expect(half.features.length).toBe(50);
    expect(half.notes.join(" ")).toMatch(/cells outside the project area/);
    const density = await parseGeoTiff(
      buf,
      { format: "geotiff", values: "density_km2", clipToArea: false },
      null,
      LIMITS,
    );
    // 4 people per km² over 0.01 km² cells.
    expect(density.features[0]!.people).toBeCloseTo(0.04, 3);
  });

  it("reads GeoJSON zones and points with a people field", () => {
    const zones = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { pop: "1 200", code: "A" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [7, 50],
                [7.01, 50],
                [7.01, 50.01],
                [7, 50.01],
                [7, 50],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: { pop: 300, code: "B" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [7.02, 50],
                  [7.03, 50],
                  [7.03, 50.01],
                  [7.02, 50],
                ],
              ],
            ],
          },
        },
        { type: "Feature", properties: { other: 1 }, geometry: null },
      ],
    };
    const r = parseGeoJson(
      enc(JSON.stringify(zones)),
      { format: "geojson", peopleField: "pop", zoneField: "code" },
      LIMITS,
    );
    expect(r.kind).toBe("zones");
    expect(r.features.map((f) => [f.people, f.zoneId])).toEqual([
      [1200, "A"],
      [300, "B"],
    ]);
    expect(r.notes.join(" ")).toMatch(/1 features without the field/);
    const pts = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { n: 5 },
          geometry: { type: "Point", coordinates: [500_000, 5_650_000] },
        },
      ],
    };
    const p = parseGeoJson(
      enc(JSON.stringify(pts)),
      { format: "geojson", peopleField: "n", crs: "EPSG:32632" },
      LIMITS,
    );
    expect(p.kind).toBe("points");
    expect((p.features[0]!.geom.coordinates as number[])[0]).toBeCloseTo(9, 5);
    expect(() =>
      parseGeoJson(enc(JSON.stringify(zones)), { format: "geojson", peopleField: "nope" }, LIMITS),
    ).toThrow(/No feature has the field/);
  });

  it("reads CSV points and zone values with semicolons and decimal commas", () => {
    const csv = 'lon;lat;"people"\n7,1;50,2;12,5\n7.2;50.3;3\nx;y;1\n';
    const r = parseCsvPoints(
      enc(csv),
      { format: "csv", mode: "points", lonField: "lon", latField: "lat", peopleField: "people" },
      LIMITS,
    );
    expect(r.features.map((f) => [f.geom.coordinates, f.people])).toEqual([
      [[7.1, 50.2], 12.5],
      [[7.2, 50.3], 3],
    ]);
    expect(r.notes[0]).toMatch(/1 rows/);
    const z = parseCsvZones(
      enc("zone,people\nA,10\nB,4\nA,1\n,3\n"),
      {
        format: "csv",
        mode: "zones",
        zoneField: "zone",
        peopleField: "people",
        zonesLayerId: "00000000-0000-4000-8000-000000000000",
      },
      LIMITS,
    );
    expect([...z.values]).toEqual([
      ["A", 11],
      ["B", 4],
    ]);
    expect(z.skipped).toBe(1);
    expect(parseCsv('a,"b ""q""",c\r\n1,"2,5",3').rows).toEqual([["1", "2,5", "3"]]);
    expect(peopleValue("1.234,5", true)).toBe(1234.5);
    expect(peopleValue("1234.5", true)).toBe(1234.5);
    expect(peopleValue("-1")).toBeNull();
  });
});

describe("lattice", () => {
  it("shares a zone's people over the cells whose centres it holds, and keeps small features whole", () => {
    const d = 0.01;
    const l = latticeOver([7, 50, 7.05, 50.05], d);
    expect([l.nx, l.ny]).toEqual([5, 5]);
    const zone = {
      type: "Polygon",
      coordinates: [
        [
          [7, 50],
          [7.02, 50],
          [7.02, 50.02],
          [7, 50.02],
          [7, 50],
        ],
      ],
    };
    addFeature(l, 7.01, 50.01, zone, 100);
    expect(l.people.reduce((a, v) => a + v, 0)).toBeCloseTo(100, 9);
    expect(l.people[0]).toBeCloseTo(25, 9);
    // A point and a feature smaller than a cell go to their cell.
    addFeature(l, 7.045, 50.045, null, 7);
    expect(l.people[24]).toBe(7);
    // A zone reaching outside the lattice only adds its share inside.
    const wide = {
      type: "Polygon",
      coordinates: [
        [
          [7.04, 50],
          [7.06, 50],
          [7.06, 50.01],
          [7.04, 50.01],
          [7.04, 50],
        ],
      ],
    };
    addFeature(l, 7.05, 50.005, wide, 10);
    expect(l.people[4]).toBeCloseTo(5, 9);
  });

  it("tests points against polygons with holes", () => {
    const outer: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ];
    const hole: [number, number][] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
      [1, 1],
    ];
    expect(inPolygon(0.5, 0.5, [outer, hole])).toBe(true);
    expect(inPolygon(2, 2, [outer, hole])).toBe(false);
  });

  it("rounds cell sizes to whole multiples of 3 arc seconds", () => {
    expect(cellDegrees(100) * 3600).toBe(3);
    expect(cellDegrees(500) * 3600).toBe(15);
    expect(cellDegrees(1000) * 3600).toBe(33);
  });
});

describe("project area", () => {
  it("takes the box round everything drawn, converting the railway's metres", () => {
    const pts = drawnPoints({
      "street-lines": { lines: [{ points: [{ lonlat: [7, 50] }, { lonlat: [7.1, 50.05] }] }] },
      railway: {
        origin: [7.05, 50],
        stations: [{ x: 0, y: 0 }],
        tracks: [{ points: [{ x: 7_000, y: 11_000 }], start: { type: "free", x: -1000, y: 0 }, end: null }],
      },
      regions: {
        regions: [
          {
            ring: [
              [6.9, 49.9],
              [6.95, 49.9],
              [6.95, 49.95],
              [6.9, 49.9],
            ],
          },
        ],
      },
      "cargo-bike": { start: [7.2, 50.2], destination: null },
      depots: { depots: [{ boundary: [[7.3, 50.3]], gates: [], zones: [] }] },
    });
    const b = boxOf(pts)!;
    expect(b[0]).toBeCloseTo(6.9, 9);
    expect(b[1]).toBeCloseTo(49.9, 9);
    expect(b[2]).toBeCloseTo(7.3, 9);
    expect(b[3]).toBeCloseTo(50.3, 9);
    // The railway's point 11 km north of its origin.
    const north = pts.reduce((a, p) => (Math.abs(p[0] - 7.148) < 0.01 ? p : a), [0, 0]);
    expect(north[1]).toBeCloseTo(50.0989, 3);
    expect(boxOf([])).toBeNull();
  });

  it("counts the plugin lines: ferry piers, via points and speed zones, cable car stations", () => {
    const pts = drawnPoints({
      "plugin-lines": {
        tools: {
          ferry: {
            doc: {
              piers: [{ lonlat: [35.497, 33.903] }, { lonlat: [35.643, 34.122] }],
              calls: [
                { pier: 0, via: [] },
                { pier: 1, via: [[35.4, 34.0]] },
              ],
              zones: [
                {
                  ring: [
                    [35.49, 33.8],
                    [35.51, 33.8],
                    [35.5, 33.81],
                  ],
                },
              ],
            },
          },
          "cable-car": { doc: { stations: [{ lonlat: [35.6, 34.3] }] } },
          broken: { doc: null },
        },
      },
    });
    expect(boxOf(pts)).toEqual([35.4, 33.8, 35.643, 34.3]);
  });

  it("widens the box by the buffer in kilometres", () => {
    const b = bufferedBox([7, 50, 7.1, 50.1], 2);
    expect(50 - b[1]).toBeCloseTo(2 / 111.32, 6);
    expect(7 - b[0]).toBeCloseTo(2 / 111.32 / Math.cos((50.1 * Math.PI) / 180), 6);
    expect(boxAreaKm2([0, 0, 1, 1])).toBeCloseTo(12_364, -1);
    expect(
      ringAreaM2([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ).toBeGreaterThan(1.2e10);
  });
});

describe("GHSL", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ghsl-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("names the tiles of an area and their addresses", () => {
    const o = { tileDeg: 10, originLon: -180, originLat: 90 };
    expect(tilesFor([7, 50, 7.1, 50.1], o)).toEqual([{ row: 4, col: 19 }]);
    expect(tilesFor([9.9, 49.9, 10.1, 50.1], o)).toEqual([
      { row: 4, col: 19 },
      { row: 4, col: 20 },
      { row: 5, col: 19 },
      { row: 5, col: 20 },
    ]);
    expect(
      tileUrl({ base: "https://x.test/G", path: "E{epoch}/{res}/R{row}_C{col}.zip" }, 2025, "3ss", {
        row: 4,
        col: 19,
      }),
    ).toBe("https://x.test/G/E2025/3ss/R4_C19.zip");
    expect(nearestEpoch(2026)).toBe(2025);
    expect(nearestEpoch(2029)).toBe(2030);
  });

  it("unpacks a ZIP entry from disk", async () => {
    const zip = join(dir, "a.zip");
    await writeFile(zip, buildZip({ "x/readme.txt": enc("hi"), "t.tif": enc("tiff bytes") }));
    const entries = await zipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["x/readme.txt", "t.tif"]);
    await extractEntry(zip, entries[1]!, join(dir, "out.tif"), 1000);
    await expect(extractEntry(zip, entries[1]!, join(dir, "big.tif"), 3)).rejects.toThrow(/size limit/);
  });

  it("downloads a tile once, reads the cells of an area and treats missing tiles as sea", async () => {
    // Tile R5 C19 (0° to 10° E, 40° to 50° N) at 0.5°: one person per cell plus the column number.
    const tif = buildTiff({
      width: 20,
      height: 20,
      value: (c) => 1 + c,
      origin: [0, 50],
      pixel: [0.5, 0.5],
      compression: "deflate",
      predictor: 3,
      tile: 16,
      noData: -200,
    });
    const zip = buildZip({ "GHS_POP_R5_C19.tif": tif });
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      if (url.endsWith("R5_C19.zip"))
        return new Response(zip, { status: 200, headers: { "content-length": String(zip.length) } });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = new GhslClient({
      base: "https://ghsl.test/G",
      path: "{epoch}/{res}/R{row}_C{col}.zip",
      cacheDir: dir,
      fetchImpl,
      backoffMs: [],
      sleep: async () => undefined,
    });
    const cells: number[][] = [];
    const got = await client.read([1, 41, 2.5, 49.5], 2025, "3ss", (w, s, e, n, p) =>
      cells.push([w, s, e, n, p]),
    );
    expect(got).toEqual({ tiles: ["R5_C19"], missing: [] });
    // Columns 2 to 4 (lon 1 to 2.5), rows 1 to 17 (lat 49.5 to 41).
    expect(cells.length).toBe(3 * 17);
    expect(cells[0]).toEqual([1, 49, 1.5, 49.5, 3]);
    // Again, from the unpacked file; the archive was deleted.
    await client.read([1, 41, 1.4, 41.4], 2025, "3ss", () => undefined);
    expect(asked.length).toBe(1);
    expect((await readdir(dir)).filter((n) => n.endsWith(".zip"))).toEqual([]);
    // Sea: no tile.
    const sea = await client.read([-30, 40, -29, 41], 2025, "3ss", () => undefined);
    expect(sea).toEqual({ tiles: [], missing: ["R5_C16"] });
  });

  it("refuses a tile that does not lie where the settings say", async () => {
    const tif = buildTiff({ width: 2, height: 2, value: () => 1, origin: [100, 0], pixel: [1, 1] });
    const zip = buildZip({ "a.tif": tif });
    const client = new GhslClient({
      base: "https://ghsl.test/G",
      path: "{epoch}/{res}/R{row}_C{col}.zip",
      cacheDir: dir,
      fetchImpl: (async () => new Response(zip, { status: 200 })) as unknown as typeof fetch,
      backoffMs: [],
      sleep: async () => undefined,
    });
    await expect(client.read([7, 50, 7.1, 50.1], 2025, "3ss", () => undefined)).rejects.toThrow(
      /does not cover/,
    );
  });
});

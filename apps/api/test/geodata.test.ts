import { describe, expect, it } from "vitest";
import { regionsHolding } from "../src/gateway/geofabrik.client";
import { cutTiles, decodeValues, encodeValues, sample, tileBounds } from "../src/geodata/dem-tiles";
import { DemUploadError, resampleDem } from "../src/geodata/dem-upload";
import { clipTo, holds, toElement } from "../src/geodata/geodata-reader";
import { bufferReader } from "../src/population/geotiff";
import { buildTiff } from "./support/tiff";
import { areaQuery, osmBase, quarters, runtimeError, splitBox } from "../src/geodata/overpass-import";
import { bboxAreaKm2, geodataSettings } from "../src/geodata/settings";

describe("geodata settings", () => {
  it("has defaults and refuses values out of range", () => {
    const s = geodataSettings({});
    expect(s.overpass).toMatchObject({ maxAreaKm2: 400, tileKm: 3, intervalS: 5, cacheDays: 7 });
    expect(s.geofabrikUrl).toBe("https://download.geofabrik.de");
    expect(geodataSettings({ MOBSIMLAB_OSM_OVERPASS_MAX_KM2: "50" }).overpass.maxAreaKm2).toBe(50);
    expect(() => geodataSettings({ MOBSIMLAB_OSM_OVERPASS_TILE_KM: "0" })).toThrow();
    expect(() => geodataSettings({ MOBSIMLAB_GEOFABRIK_URL: "http://example.org" })).toThrow();
  });

  it("measures a box in km²", () => {
    expect(bboxAreaKm2([0, 0, 1, 1])).toBeCloseTo(111.32 * 111.32, -1);
    expect(bboxAreaKm2([7, 60, 8, 61])).toBeCloseTo(111.32 * 111.32 * Math.cos((60.5 * Math.PI) / 180), -1);
  });
});

describe("Overpass area fetch", () => {
  it("asks for nodes, ways and multipolygon or restriction relations only", () => {
    const q = areaQuery([7, 50, 7.1, 50.1], 180, 1000);
    expect(q).toContain("[timeout:180][maxsize:1000]");
    expect(q).toContain("node(50.0000000,7.0000000,50.1000000,7.1000000)");
    expect(q).toContain(
      'rel(50.0000000,7.0000000,50.1000000,7.1000000)["type"~"^(multipolygon|restriction)$"]',
    );
  });

  it("splits an area into tiles and a failed tile into quarters", () => {
    const tiles = splitBox([7, 50, 7.2, 50.1], 3);
    // 0.2° of longitude at 50° N is about 14.3 km: 5 columns; 0.1° of latitude is 11.1 km: 4 rows.
    expect(tiles).toHaveLength(20);
    expect(tiles[0]![0]).toBe(7);
    expect(tiles.at(-1)![2]).toBeCloseTo(7.2);
    expect(splitBox([7, 50, 7.001, 50.001], 3)).toEqual([[7, 50, 7.001, 50.001]]);
    expect(quarters([0, 0, 2, 2])).toEqual([
      [0, 0, 1, 1],
      [1, 0, 2, 1],
      [0, 1, 1, 2],
      [1, 1, 2, 2],
    ]);
  });

  it("reads the data date and runtime errors of an answer", () => {
    expect(osmBase('<osm><meta osm_base="2026-11-15T08:00:00Z"/></osm>')).toBe("2026-11-15T08:00:00Z");
    expect(osmBase("<osm/>")).toBeNull();
    expect(runtimeError('<osm><remark> runtime error: Query timed out in "query" </remark></osm>')).toMatch(
      /^runtime error: Query timed out/,
    );
    expect(runtimeError("<osm/>")).toBeNull();
  });
});

describe("Geofabrik regions", () => {
  const square = (w: number, s: number, e: number, n: number) => [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ];
  const index = {
    features: [
      {
        properties: { id: "europe", name: "Europe", urls: { pbf: "https://x/europe.osm.pbf" } },
        geometry: { type: "Polygon" as const, coordinates: square(-30, 30, 50, 75) as [number, number][][] },
      },
      {
        properties: { id: "koeln", name: "Köln", parent: "nrw", urls: { pbf: "https://x/koeln.osm.pbf" } },
        geometry: {
          type: "MultiPolygon" as const,
          coordinates: [square(6, 50, 8, 51)] as [number, number][][][],
        },
      },
      {
        properties: { id: "duesseldorf", name: "Düsseldorf", urls: { pbf: "https://x/d.osm.pbf" } },
        geometry: { type: "Polygon" as const, coordinates: square(6, 51, 8, 52) as [number, number][][] },
      },
    ],
  };

  it("lists the regions holding the whole box, smallest first", () => {
    expect(regionsHolding(index, [6.9, 50.8, 7.1, 50.9]).map((r) => r.id)).toEqual(["koeln", "europe"]);
    // A box across two regions is only held by the larger one.
    expect(regionsHolding(index, [6.9, 50.9, 7.1, 51.1]).map((r) => r.id)).toEqual(["europe"]);
  });
});

describe("elevation tiles", () => {
  const grid = (w: number, h: number) => ({
    width: w,
    height: h,
    originLon: 7,
    originLat: 51,
    stepLon: 0.1,
    stepLat: 0.1,
    values: Float32Array.from({ length: w * h }, (_, i) => (i % w) + 10 * Math.floor(i / w)),
  });

  it("cuts a grid into tiles sharing their edge pixels", () => {
    const tiles = cutTiles(grid(5, 4), 3);
    expect(tiles.map((t) => [t.width, t.height])).toEqual([
      [3, 3],
      [3, 3],
      [3, 2],
      [3, 2],
    ]);
    // The second tile starts at the last column of the first.
    expect(tiles[1]!.originLon).toBeCloseTo(7.2);
    expect(tiles[1]!.values[0]).toBe(2);
    expect(tileBounds(tiles[0]!)).toEqual([6.95, expect.closeTo(50.75), expect.closeTo(7.25), 51.05]);
  });

  it("leaves out tiles with no data and keeps values through storage", () => {
    const g = grid(3, 3);
    g.values.fill(Number.NaN);
    expect(cutTiles(g)).toEqual([]);
    const v = Float32Array.from([1.5, Number.NaN, -3]);
    expect([...decodeValues(encodeValues(v), 3, 1)]).toEqual([1.5, Number.NaN, -3]);
    expect(() => decodeValues(encodeValues(v), 2, 1)).toThrow();
  });

  it("interpolates bilinearly, skipping no-data pixels", () => {
    const [t] = cutTiles(grid(3, 3));
    expect(sample(t!, 7.05, 50.95)).toBeCloseTo((0 + 1 + 10 + 11) / 4);
    expect(sample(t!, 7, 51)).toBe(0);
    expect(sample(t!, 8, 51)).toBeNull();
    t!.values[0] = Number.NaN;
    expect(sample(t!, 7.05, 50.95)).toBeCloseTo((1 + 10 + 11) / 3);
  });
});

describe("imported rows as Overpass elements", () => {
  it("turns ways, multipolygons, lines and points into elements", () => {
    const ring: [number, number][] = [
      [7, 50],
      [7.1, 50],
      [7.1, 50.1],
      [7, 50],
    ];
    expect(toElement("W", "5", { building: "yes" }, { type: "MultiPolygon", coordinates: [[ring]] })).toEqual(
      {
        type: "way",
        id: 5,
        tags: { building: "yes" },
        geometry: ring.map(([lon, lat]) => ({ lat, lon })),
      },
    );
    const rel = toElement("R", 9, null, { type: "MultiPolygon", coordinates: [[ring, ring]] })!;
    expect(rel.type).toBe("relation");
    expect(rel.members!.map((m) => m.role)).toEqual(["outer", "inner"]);
    expect(toElement("N", 1, {}, { type: "Point", coordinates: [7, 50] })).toMatchObject({
      type: "node",
      lon: 7,
      lat: 50,
    });
    expect(toElement("W", 2, {}, { type: "LineString", coordinates: ring })!.geometry).toHaveLength(4);
  });

  it("checks that an import holds a box", () => {
    expect(holds([0, 0, 2, 2], [0.5, 0.5, 1, 1])).toBe(true);
    expect(holds([0, 0, 2, 2], [1, 1, 3, 1.5])).toBe(false);
  });

  it("answers a box that pokes out of the import from the part the import covers", () => {
    // Damascus: the schematic asked for water up to 36.576° E, the import ends at 36.543° E.
    expect(clipTo([36.2, 33.4, 36.543, 33.6], [36.25, 33.45, 36.576, 33.58])).toEqual([
      36.25, 33.45, 36.543, 33.58,
    ]);
    expect(clipTo([0, 0, 2, 2], [0.5, 0.5, 1, 1])).toEqual([0.5, 0.5, 1, 1]);
    // Wholly outside, or only touching an edge: not from the import.
    expect(clipTo([0, 0, 2, 2], [3, 3, 4, 4])).toBeNull();
    expect(clipTo([0, 0, 2, 2], [2, 0, 3, 1])).toBeNull();
  });
});

describe("own elevation grid", () => {
  const tif = (w: number, h: number, value: (c: number, r: number) => number, noData?: number) =>
    bufferReader(
      buildTiff({ width: w, height: h, value, origin: [7, 50.01], pixel: [0.001, 0.001], noData }),
    );

  it("resamples a WGS 84 grid over the area, filling single no-data pixels from their neighbours", async () => {
    const r = await resampleDem(
      tif(10, 10, (c, r) => (c === 0 && r === 0 ? -9999 : 100 + c), -9999),
      [7, 50, 7.01, 50.01],
      { maxCells: 1e6 },
    );
    expect(r.crs).toBe("EPSG:4326");
    expect(r.fileResolutionM).toBeCloseTo(71.5, 0);
    expect(r.window.values.some((v) => Number.isNaN(v))).toBe(false);
    const t = { ...r.window };
    // The middle of column 4 (between pixel centres 4 and 5 of the file) is 104.5.
    const mid = sample({ ...t, values: t.values }, 7 + 0.005, 50.005);
    expect(mid).toBeCloseTo(104.5, 2);
  });

  it("stores a coarser grid when the area holds too many cells, and refuses too large a file window", async () => {
    // Pixels 0.005° wide but 0.0001° tall: at the file's finest resolution the area would need ~6,500 cells.
    const narrow = bufferReader(
      buildTiff({ width: 2, height: 100, value: () => 50, origin: [7, 50.01], pixel: [0.005, 0.0001] }),
    );
    const r = await resampleDem(narrow, [7, 50, 7.01, 50.01], { maxCells: 500 });
    expect(r.window.width * r.window.height).toBeLessThanOrEqual(500);
    expect(r.notes[0]).toMatch(/stored at/);
    await expect(
      resampleDem(
        tif(100, 100, () => 50),
        [7, 50, 7.1, 50.01],
        { maxCells: 20 },
      ),
    ).rejects.toThrow(DemUploadError);
  });

  it("asks for the coordinate system when a projected file does not name it", async () => {
    const read = bufferReader(
      buildTiff({
        width: 4,
        height: 4,
        value: () => 1,
        origin: [0, 0],
        pixel: [10, 10],
        epsg: null,
        geographic: false,
      }),
    );
    await expect(resampleDem(read, [7, 50, 7.01, 50.01], { maxCells: 1e6 })).rejects.toThrow(
      /does not name its coordinate system/,
    );
  });
});

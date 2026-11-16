import { describe, expect, it } from "vitest";
import { regionsHolding } from "../src/gateway/geofabrik.client";
import { cutTiles, decodeValues, encodeValues, sample, tileBounds } from "../src/geodata/dem-tiles";
import { holds, toElement } from "../src/geodata/geodata-reader";
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
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AccessService } from "../src/agents/access.service";
import { AnalysisService } from "../src/agents/analysis.service";
import { destinationCategories } from "../src/agents/destinations";
import { exportGtfs } from "../src/agents/gtfs-export";
import { lpModel, solveMaxCover } from "../src/agents/mclp";
import { crc32, writeZip } from "../src/agents/zip";
import { NetworkService, type TileSource } from "../src/agents/network.service";
import { applyChanges, EMPTY_DOC, type ScenarioDoc } from "../src/agents/scenario";
import { destinationQuery, destinations } from "../src/street-network/street-network.service";

/** The WebAssembly kernels must be built (tools/wasm/build-api.sh); CI builds them before the tests. */
const WASM = existsSync(join(__dirname, "..", "wasm", "street-routing", "street_routing_wasm.js"));

const LON0 = 7.0;
const LAT0 = 50.0;
const DLAT = 1 / 111_195;
const DLON = 1 / (111_195 * Math.cos((LAT0 * Math.PI) / 180));
const ll = (x: number, y: number): [number, number] => [LON0 + x * DLON, LAT0 + y * DLAT];

/** Residential streets every 100 m from -1500 to 1500 m in both directions around (7°E, 50°N). */
function gridXml(): string {
  const n = 15;
  const id = (i: number, j: number) => 1 + (i + n) * 100 + (j + n);
  let xml = "<osm>";
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const [lon, lat] = ll(i * 100, j * 100);
      xml += `<node id="${id(i, j)}" lat="${lat}" lon="${lon}"/>`;
    }
  let w = 1;
  for (let i = -n; i <= n; i++)
    for (const nodes of [
      Array.from({ length: 2 * n + 1 }, (_, j) => id(j - n, i)),
      Array.from({ length: 2 * n + 1 }, (_, j) => id(i, j - n)),
    ])
      xml += `<way id="${w++}">${nodes.map((x) => `<nd ref="${x}"/>`).join("")}<tag k="highway" v="residential"/></way>`;
  return `${xml}</osm>`;
}

function services() {
  const grid = gridXml();
  const n = 2 ** 14;
  const holds = (x: number, y: number) => {
    const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
    return (
      LON0 >= (x / n) * 360 - 180 && LON0 < ((x + 1) / n) * 360 - 180 && LAT0 <= lat(y) && LAT0 > lat(y + 1)
    );
  };
  const tiles: TileSource = {
    tile: async (x, y) => (holds(x, y) ? grid : "<osm></osm>"),
    walkTile: async (x, y) => (holds(x, y) ? grid : "<osm></osm>"),
    destinationTile: async () => JSON.stringify({ destinations: [] }),
  };
  const network = new NetworkService(tiles);
  const analysis = new AnalysisService(network);
  return { network, analysis, access: new AccessService(network, analysis) };
}

/** Bus W–C–E every 10 min and metro C–N every 5 min, stops 800 m apart, study area ±1.4 km. */
async function scenario(network: NetworkService): Promise<ScenarioDoc> {
  const stops = (
    [
      ["W", -800, 0],
      ["C", 0, 0],
      ["E", 800, 0],
      ["N", 0, 800],
    ] as const
  ).map(([id, x, y]) => {
    const [lon, lat] = ll(x, y);
    return { op: "add_stop" as const, stop: { id, name: `Stop ${id}`, lon, lat } };
  });
  const [w, s] = ll(-1400, -1400);
  const [e, nn] = ll(1400, 1400);
  const doc = applyChanges(EMPTY_DOC, [
    ...stops,
    {
      op: "add_line",
      line: {
        id: "B1",
        name: "1",
        mode: "bus",
        stop_ids: ["W", "C", "E"],
        headway_min: { peak: 10, off_peak: 20 },
      },
    },
    {
      op: "add_line",
      line: {
        id: "M1",
        name: "U1",
        mode: "metro",
        stop_ids: ["C", "N"],
        headway_min: { peak: 5, off_peak: 10 },
      },
    },
    { op: "set_study_area", bbox: [w, s, e, nn] },
  ] as never);
  return network.route(doc);
}

const pt = (x: number, y: number, weight = 1) => {
  const [lon, lat] = ll(x, y);
  return { lon, lat, weight };
};

describe("15-minute city destination list", () => {
  it("sorts OSM tags into the daily-needs categories", () => {
    expect(destinationCategories({ shop: "supermarket" })).toEqual(["food_shop"]);
    expect(destinationCategories({ amenity: "school", "isced:level": "1;2" })).toEqual(["primary_school"]);
    expect(destinationCategories({ amenity: "school", school: "secondary" })).toEqual([]);
    expect(destinationCategories({ amenity: "pharmacy", healthcare: "pharmacy" })).toEqual(["pharmacy"]);
    expect(destinationCategories({ healthcare: "doctor" })).toEqual(["gp_clinic"]);
    expect(destinationCategories({ leisure: "park" })).toEqual(["park"]);
    expect(destinationCategories({ office: "company", shop: "bakery" })).toEqual(["food_shop", "workplace"]);
    expect(destinationCategories({ shop: "clothes" })).toEqual([]);
  });

  it("asks Overpass for centres and reads them back", () => {
    const q = destinationQuery(14, 8508, 5556);
    expect(q).toContain("out tags center");
    expect(q).toContain('nwr["leisure"="park"]');
    const got = destinations(
      JSON.stringify({
        elements: [
          { type: "way", id: 5, tags: { leisure: "park", name: "Stadtpark" }, center: { lat: 50, lon: 7 } },
          { type: "node", id: 6, tags: { shop: "clothes" }, lat: 50, lon: 7 },
        ],
      }),
    );
    expect(got).toEqual([{ id: "w5", categories: ["park"], lonlat: [7, 50], name: "Stadtpark" }]);
  });
});

describe("exact maximal covering (HiGHS)", () => {
  // Points L1 L2 M R1 R2; the middle candidate is the best single stop, the outer pair the best two.
  const inst = {
    weights: [3, 3, 1, 3, 3],
    candidates: [0, 1, 2],
    cover: [
      [1, 2, 3],
      [0, 1],
      [3, 4],
    ],
    conflicts: [] as [number, number][],
  };

  it("writes the covering problem in LP format", () => {
    const lp = lpModel(inst, 2);
    expect(lp).toContain("Maximize");
    expect(lp).toContain(" k:");
    expect(lp).toContain("Binary");
    expect(lp).toMatch(/c1: y1\n - x0 - x1\n <= 0/);
  });

  it("beats the greedy choice where greedy is not optimal", async () => {
    const r = await solveMaxCover(inst, 2, 5);
    expect(r).not.toBeNull();
    expect(r!.optimal).toBe(true);
    expect(r!.chosen.sort()).toEqual([1, 2]);
    expect(r!.objective).toBe(12);
  });

  it("respects the minimum spacing between candidates", async () => {
    const r = await solveMaxCover({ ...inst, conflicts: [[1, 2]] }, 2, 5);
    expect(r!.chosen).toHaveLength(2);
    expect(r!.chosen).toContain(0);
    expect(r!.objective).toBe(10);
  });
});

describe.skipIf(!WASM)("accessibility analyses (ADR-0035 §6)", () => {
  it("grades points by TfL PTAL along the street network", async () => {
    const { network, access } = services();
    const doc = await scenario(network);
    const r = await access.ptal(doc, { demand: [pt(50, 0), pt(1000, -1000)], listPoints: 10 });
    expect(r.preset).toBe("ptal");
    expect(r.basis).toContain("80 m/min");
    expect(r.method_source).toContain("Transport for London");
    const near = r.points!.features.find((f) => f.geometry.coordinates[0]! < LON0 + 0.001)!;
    // Bus: 50 m → 0.625 + 5 + 2 = 7.625 min; metro: 0.625 + 2.5 + 0.75 = 3.875 min; 30/7.625 + 30/3.875.
    expect(near.properties.access_index).toBeCloseTo(30 / 7.625 + 30 / 3.875, 1);
    expect(near.properties.ptal).toBe("3");
    expect(r.bands.find((b) => b.band === "0")!.share_pct).toBe(50);
    expect(r.share_with_any_access_pct).toBe(50);
  });

  it("counts daily needs on foot, by bicycle and with public transport", async () => {
    const { network, access } = services();
    const doc = await scenario(network);
    const dests = [
      { category: "food_shop", ...pt(300, 0) },
      { category: "pharmacy", ...pt(0, 1000) },
    ];
    const walk = await access.destinations(doc, {
      mode: "walk",
      destinations: dests,
      demand: [pt(0, 0), pt(-1000, -1000)],
    });
    expect(walk.preset).toBe("fifteen_minute_city");
    expect(walk.basis).toContain("within 15 min on foot");
    // The centre reaches both (300 m, 1000 m); the corner neither (2300 m, 3000 m).
    expect(walk.share_reaching_all_pct).toBe(50);
    expect(walk.categories.map((c) => c.share_reaching_one_pct)).toEqual([50, 50]);
    expect(walk.gaps.features[0]!.properties.missing).toEqual(["food_shop", "pharmacy"]);
    const cycle = await access.destinations(doc, {
      mode: "cycle",
      destinations: dests,
      demand: [pt(0, 0), pt(-1000, -1000)],
    });
    expect(cycle.share_reaching_all_pct).toBe(100);
    expect(cycle.assumption_keys).toContain("analysis.cycle_speed_kmh");
    // From W, the pharmacy 300 m beyond N is 1900 m on foot (over 25 min) but bus + metro gets there in time.
    const far = [{ category: "pharmacy", ...pt(0, 1100) }];
    const onFoot = await access.destinations(doc, {
      mode: "walk",
      minutes: 25,
      destinations: far,
      demand: [pt(-800, 0)],
    });
    expect(onFoot.share_reaching_all_pct).toBe(0);
    const transit = await access.destinations(doc, {
      mode: "walk_transit",
      minutes: 25,
      destinations: far,
      demand: [pt(-800, 0)],
      window: [8 * 3600, 9 * 3600],
    });
    expect(transit.share_reaching_all_pct).toBe(100);
    expect(transit.basis).toContain("median over departures every 10 min from 08:00 to 09:00");
  });

  it("solves stop placement exactly and never does worse than greedy", async () => {
    const { network, analysis, access } = services();
    const doc = await scenario(network);
    const greedy = await analysis.suggestStops(doc, 2, { minutes: 5 });
    const exact = await access.suggestStopsExact(doc, 2, { minutes: 5, timeLimitS: 20 });
    expect(exact.solver).toMatch(/HiGHS/);
    expect(exact.covered_after_pct).toBeGreaterThanOrEqual(greedy.covered_after_pct);
    expect(exact.suggestions.length).toBeGreaterThan(0);
    expect(exact).not.toHaveProperty("instance");
    expect(exact).not.toHaveProperty("context");
  });
});

describe("zip writer", () => {
  it("stores files with their CRC and a central directory", () => {
    const z = writeZip({ "a.txt": "hello", "b.txt": "wörld" });
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(14)).toBe(crc32(Buffer.from("hello")));
    expect(z.subarray(30, 35).toString()).toBe("a.txt");
    const end = z.length - 22;
    expect(z.readUInt32LE(end)).toBe(0x06054b50);
    expect(z.readUInt16LE(end + 10)).toBe(2);
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe.skipIf(!WASM)("GTFS export (ADR-0035 export_gtfs)", () => {
  it("writes the scenario as a weekday feed with frequencies", async () => {
    const { network, analysis } = services();
    const doc = await scenario(network);
    const feed = exportGtfs(doc, analysis, {
      agencyName: "Test",
      agencyUrl: "https://example.org",
      timezone: "Europe/Berlin",
      lang: "en",
      startDate: "20270101",
      endDate: "20271231",
    });
    expect(Object.keys(feed.files)).toEqual(
      expect.arrayContaining([
        "agency.txt",
        "stops.txt",
        "routes.txt",
        "trips.txt",
        "stop_times.txt",
        "calendar.txt",
      ]),
    );
    expect(feed.rows["stops.txt"]).toBe(4);
    expect(feed.rows["routes.txt"]).toBe(2);
    expect(feed.files["agency.txt"]).toContain("Europe/Berlin");
    expect(feed.files["calendar.txt"]).toContain("20270101");
    expect(feed.files["routes.txt"]).toMatch(/B1,.*,3,/);
    // Lines run at their headways: one template trip per direction and period, repeated by frequencies.txt.
    expect(feed.rows["frequencies.txt"]).toBeGreaterThan(0);
    expect(feed.zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("refuses a scenario without service", () => {
    const { analysis } = services();
    expect(() =>
      exportGtfs(EMPTY_DOC, analysis, {
        agencyName: "x",
        agencyUrl: "https://example.org",
        timezone: "UTC",
        lang: "en",
        startDate: "20270101",
        endDate: "20271231",
      }),
    ).toThrow(/no routed line/);
  });
});

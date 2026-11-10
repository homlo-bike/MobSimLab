import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenefitTables } from "../src/features/benefits/BenefitTables";
import type { BenefitsApi, OsmArea } from "../src/features/benefits/data";
import { catchmentTiles, countryFigures, loadTiles } from "../src/features/benefits/data";
import { compile, FormulaError, formulaProblem } from "../src/features/benefits/formula";
import { FORMULAS, formulaText } from "../src/features/benefits/formulas";
import {
  type BuildingIn,
  catchments,
  classify,
  type CountryFigures,
  decay,
  estimate,
  type PlaceIn,
  prepare,
  scenarios,
} from "../src/features/benefits/model";
import { metres, networkOf, withoutRoutes } from "../src/features/benefits/network";
import { libraryValue, p10p50p90, paramValue, seeded, triangular } from "../src/features/benefits/params";
import { RegionEditor } from "../src/features/benefits/RegionEditor";
import { inRing, type Region, ringAreaM2 } from "../src/features/benefits/regions";
import { accessByScenario, groupOf, spendingFrom } from "../src/features/benefits/run";
import { projectTimetable } from "../src/features/benefits/timetable";
import type { Estimate as CostEstimate } from "../src/features/costs/model";
import type { LonLat, ReachLoader, Timetable } from "../src/features/journey-planner/types";

afterEach(cleanup);

const C: LonLat = [5.0, 52.0];
/** `[lon, lat]` x metres east and y metres north of C. */
function at(x: number, y: number): LonLat {
  return [C[0] + x / (111_320 * Math.cos((C[1] * Math.PI) / 180)), C[1] + y / 110_574];
}

/** Metro M1 west–east over 3 km (stations every 1.5 km), bus B1 from Central 1.5 km north. */
function network(): Timetable {
  const stop = (id: string, name: string, x: number, y: number) => {
    const [lon, lat] = at(x, y);
    return { stop_id: id, stop_name: name, stop_lon: lon, stop_lat: lat };
  };
  const periods = [{ start_time: 6 * 3600, end_time: 22 * 3600, headway_secs: 300, kind: "peak" as const }];
  return {
    stops: [
      stop("m1", "West", 0, 0),
      stop("m2", "Central", 1500, 0),
      stop("m3", "East", 3000, 0),
      stop("b1", "Central", 1530, 40),
      stop("b2", "North", 1500, 1500),
    ],
    routes: [
      { route_id: "rail:M1", route_short_name: "M1", mode: "metro", route_color: "0055aa" },
      { route_id: "street:0", route_short_name: "B1", mode: "bus" },
    ],
    trips: [],
    transfers: [],
    frequency_patterns: [
      {
        pattern_id: "m",
        route_id: "rail:M1",
        stops: [
          { stop_id: "m1", run_time: 0, dwell_time: 0 },
          { stop_id: "m2", run_time: 120, dwell_time: 30 },
          { stop_id: "m3", run_time: 120, dwell_time: 30 },
        ],
        periods,
      },
      {
        pattern_id: "b",
        route_id: "street:0",
        stops: [
          { stop_id: "b1", run_time: 0, dwell_time: 0 },
          { stop_id: "b2", run_time: 300, dwell_time: 20 },
        ],
        periods,
      },
    ],
  };
}

/**
 * A stand-in for the journey planner: from a point, the stops of every route with a stop within 500 m
 * are reached after a 3-minute wait at 10 m/s along the straight line; one ride only.
 */
const fakeReach: ReachLoader = async (tt) => ({
  reach: (from, t0) => {
    const pos = new Map(tt.stops.map((s) => [s.stop_id, [s.stop_lon, s.stop_lat] as LonLat]));
    const routes = new Map<string, string[]>();
    for (const p of tt.frequency_patterns)
      routes.set(
        p.route_id,
        p.stops.map((s) => s.stop_id),
      );
    const arrive = new Map<string, number>();
    for (const stops of routes.values()) {
      const board = stops.filter((s) => metres(from, pos.get(s)!) <= 500);
      if (!board.length) continue;
      for (const s of stops) {
        const a = t0 + 180 + metres(from, pos.get(s)!) / 10;
        arrive.set(s, Math.min(arrive.get(s) ?? Infinity, a));
      }
    }
    const ids = tt.stops.map((s) => s.stop_id);
    return { stop_ids: ids, arrive_s: ids.map((id) => arrive.get(id) ?? null) };
  },
  dispose: () => {},
});

/** A 20 × 20 m building `x, y` metres from C with `levels` floors. */
function building(id: string, x: number, y: number, use: string, levels = 4): BuildingIn {
  const r: LonLat[] = [at(x, y), at(x + 20, y), at(x + 20, y + 20), at(x, y + 20), at(x, y)];
  return { id, ring: r, levels, use };
}

function buildings(): BuildingIn[] {
  const out: BuildingIn[] = [];
  // Homes near every station, offices near Central and East.
  for (const [sx, sy] of [
    [0, 0],
    [1500, 0],
    [3000, 0],
    [1500, 1500],
  ] as const)
    for (let i = 0; i < 10; i++)
      out.push(building(`h${sx}-${sy}-${i}`, sx + 60 * i - 300, sy + 100, "apartments"));
  for (let i = 0; i < 10; i++) out.push(building(`o${i}`, 1500 + 50 * i - 250, -150, "office", 8));
  for (let i = 0; i < 5; i++) out.push(building(`e${i}`, 3000 + 50 * i - 100, -120, "office", 6));
  return out;
}

const PLACES: PlaceIn[] = [
  { id: "n1", kind: "hospital", lonlat: at(3050, 100) },
  { id: "n2", kind: "school", lonlat: at(1500, 1450) },
  { id: "n3", kind: "university", lonlat: at(1550, 50) },
  { id: "n4", kind: "clinic", lonlat: at(0, 80) },
];

const COUNTRY: CountryFigures = {
  gdpPerCapita: 40_000,
  employmentRatio15: 0.55,
  under15: 0.15,
  popGrowth: 1.02,
};

function worldpop(tt: Timetable, people = 5000): Record<string, number | null> {
  return Object.fromEntries(catchments(tt, undefined).map((a) => [a.id, people]));
}

async function run(
  opts: {
    regions?: Region[];
    wp?: Record<string, number | null>;
    prefs?: Record<string, number>;
    doc?: { formulas?: Record<string, string> };
  } = {},
) {
  const tt = network();
  const P = prepare({
    timetable: tt,
    buildings: buildings(),
    places: PLACES,
    worldpop: opts.wp ?? worldpop(tt),
    country: COUNTRY,
    regions: opts.regions ?? [],
    prefs: opts.prefs,
  });
  const acc = await accessByScenario(P, tt, fakeReach, opts.prefs);
  const spending = new Map([
    [
      "rail:M1",
      {
        civil: [400e6, 600e6, 900e6] as [number, number, number],
        systems: [100e6, 150e6, 200e6] as [number, number, number],
        vehicles: [50e6, 60e6, 80e6] as [number, number, number],
        operating: [20e6, 25e6, 30e6] as [number, number, number],
      },
    ],
  ]);
  const e = estimate({
    prepared: P,
    access: acc,
    spending,
    country: COUNTRY,
    prefs: opts.prefs,
    doc: opts.doc as never,
    draws: 60,
  });
  return { P, acc, e, tt };
}

describe("formula language", () => {
  it("follows the usual precedence and functions", () => {
    const f = (s: string, v: Record<string, number> = {}) => compile(s, Object.keys(v)).fn(v);
    expect(f("1 + 2 * 3")).toBe(7);
    expect(f("(1 + 2) * 3")).toBe(9);
    expect(f("2 ^ 3 ^ 2")).toBe(512);
    expect(f("-2 ^ 2")).toBe(-4);
    expect(f("a × b ÷ 4", { a: 6, b: 2 })).toBe(3);
    expect(f("ln(exp(2)) + max(1, 5, 3) + min(4) + sqrt(9) + abs(-1) + log10(100)")).toBeCloseTo(17);
    expect(f("1.5e3 / .5")).toBe(3000);
    expect(compile("pop * share + pop", ["pop", "share", "x"]).uses.sort()).toEqual(["pop", "share"]);
  });

  it("reports what is wrong and where", () => {
    expect(() => compile("pop * x", ["pop"])).toThrow(FormulaError);
    expect(formulaProblem("pop * x", ["pop"])).toBe('Unknown variable "x" (at character 7)');
    expect(formulaProblem("foo(1)", [])).toContain('Unknown function "foo"');
    expect(formulaProblem("ln(1, 2)", [])).toContain('"ln" takes 1 values');
    expect(formulaProblem("1 +", [])).toContain("ends too early");
    expect(formulaProblem("1 2", [])).toContain("Unexpected text");
    expect(formulaProblem("1 $ 2", [])).toContain('Unexpected "$"');
    expect(formulaProblem("constructor", [])).toContain("Unknown variable");
    expect(formulaProblem("pop", ["pop"])).toBeNull();
  });

  it("ships defaults that compile, and falls back to them for a broken project formula", () => {
    for (const f of FORMULAS)
      expect(
        formulaProblem(
          f.default,
          f.vars.map((v) => v.name),
        ),
        f.id,
      ).toBeNull();
    expect(formulaText({ formulas: { ridership_daily: "pop * 0.1" } }, "ridership_daily")).toBe("pop * 0.1");
    expect(formulaText({ formulas: { ridership_daily: "pop * nope" } }, "ridership_daily")).toBe(
      "pop * resident_share * trips_per_user",
    );
  });
});

describe("parameters and sampling", () => {
  it("draws within the range, repeats with a seed and takes the project's value", () => {
    const r = seeded(7);
    const xs = Array.from({ length: 2000 }, () => triangular([1, 2, 5], r()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(5);
    const [lo, mid, hi] = p10p50p90(xs);
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(seeded(3)()).toBe(seeded(3)());
    expect(libraryValue("benefit.elasticity_agglomeration")).toEqual([0.02, 0.04, 0.07]);
    expect(
      paramValue("benefit.elasticity_agglomeration", "*", { "benefit.elasticity_agglomeration": 0.08 }),
    ).toEqual([0.04, 0.08, 0.14]);
    expect(
      paramValue("benefit.uplift.residential", "metro", { "benefit.uplift.residential.metro": 0.06 })[1],
    ).toBe(0.06);
    expect(paramValue("mode.catchment_m", "metro", undefined)[1]).toBeGreaterThan(
      paramValue("mode.catchment_m", "bus", undefined)[1],
    );
  });
});

describe("stations and lines", () => {
  it("joins stops of one name close together and lists each line's stations", () => {
    const n = networkOf(network());
    expect(n.stations).toHaveLength(4);
    const central = n.stations.find((s) => s.name === "Central")!;
    expect(central.stopIds.sort()).toEqual(["b1", "m2"]);
    expect(central.modes.sort()).toEqual(["bus", "metro"]);
    expect(n.lines.map((l) => [l.id, l.stations.length])).toEqual([
      ["rail:M1", 3],
      ["street:0", 2],
    ]);
    expect(withoutRoutes(network(), new Set(["street:0"])).frequency_patterns).toHaveLength(1);
    expect(scenarios(n).map((s) => s.key)).toEqual([
      "all",
      "none",
      "-line:rail:M1",
      "-line:street:0",
      "-mode:metro",
      "-mode:bus",
    ]);
  });

  it("builds one timetable with the cost tables' line ids", () => {
    const rail = { ...network(), routes: [{ route_id: "M1", route_short_name: "M1", mode: "metro" }] };
    rail.frequency_patterns = [{ ...rail.frequency_patterns[0]!, route_id: "M1" }];
    const tt = projectTimetable([], rail, []);
    expect(tt!.routes.map((r) => r.route_id)).toEqual(["rail:M1"]);
    expect(projectTimetable([], null, [])).toBeNull();
  });
});

describe("buildings and regions", () => {
  it("classifies buildings, with a region's land use for untagged ones", () => {
    expect(classify("house", null, 0.7)).toMatchObject({ homes: 1, jobs: null });
    expect(classify("office", null, 0.7)).toMatchObject({ homes: 0, jobs: "office" });
    expect(classify("amenity:school", null, 0.7)).toMatchObject({ jobs: "public" });
    expect(classify("garage", null, 0.7)).toMatchObject({ homes: 0, jobs: null });
    expect(classify("yes", null, 0.7)).toMatchObject({ homes: 0.7, unknown: true });
    const ind: Region = {
      id: "r",
      name: "Docks",
      ring: [],
      source: "drawn",
      values: { landUse: "industrial" },
    };
    expect(classify("yes", ind, 0.7)).toMatchObject({ homes: 0, jobs: "industrial" });
  });

  it("measures and tests rings, and fades the uplift with distance", () => {
    const sq: LonLat[] = [at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000), at(0, 0)];
    expect(ringAreaM2(sq) / 1e6).toBeCloseTo(1, 1);
    expect(inRing(at(500, 500), sq)).toBe(true);
    expect(inRing(at(1500, 500), sq)).toBe(false);
    expect(decay(100, 800, 0.5)).toBe(1);
    expect(decay(600, 800, 0.5)).toBeCloseTo(0.5);
    expect(decay(900, 800, 0.5)).toBe(0);
  });
});

describe("benefit estimate", () => {
  it("finds people, jobs and places around the stations", async () => {
    const { P } = await run();
    expect(P.zones).toHaveLength(4);
    const central = P.zones.find((z) => z.name === "Central")!;
    expect(central.jobs).toBeGreaterThan(100);
    expect(central.places.university).toBe(1);
    expect(P.popSource.worldpop).toBeGreaterThan(0);
    expect(P.popSource.buildings).toBe(0);
    // WorldPop people of each circle are spread over the circle and scaled by the population growth.
    const total = P.zones.reduce((s, z) => s + z.pop, 0);
    expect(total).toBeGreaterThan(4 * 5000 * 0.7);
    expect(total).toBeLessThan(4 * 5000 * 1.1);
    expect(P.buildings.length).toBeGreaterThan(30);
  });

  it("estimates per line, per mode and in total, the same every run", async () => {
    const { e } = await run();
    expect(e.rows.map((r) => r.id)).toEqual(["rail:M1", "street:0", "mode:metro", "mode:bus", "total"]);
    const total = e.rows.find((r) => r.id === "total")!;
    for (const m of [
      "ridership_daily",
      "ridership_annual",
      "gdp",
      "earnings",
      "land_value",
      "construction_gdp",
      "construction_jobs",
    ] as const) {
      const [lo, mid, hi] = total.values[m];
      expect(mid, m).toBeGreaterThan(0);
      expect(lo, m).toBeLessThanOrEqual(mid);
      expect(hi, m).toBeGreaterThanOrEqual(mid);
    }
    // Ridership: residents near the stations × share × trips, a year = weekdays × days.
    const metro = e.rows.find((r) => r.id === "rail:M1")!;
    expect(metro.values.ridership_annual[1] / metro.values.ridership_daily[1]).toBeGreaterThan(250);
    // The bus has no costs, so no construction jobs; the metro has them.
    expect(e.rows.find((r) => r.id === "street:0")!.values.construction_jobs[1]).toBe(0);
    expect(metro.values.construction_jobs[1]).toBeGreaterThan(1000);
    // Land value uplift: no uplift for ordinary bus lines by default.
    expect(e.rows.find((r) => r.id === "street:0")!.values.land_value[1]).toBeLessThan(
      metro.values.land_value[1],
    );
    // People who gain access to the hospital near East.
    expect(total.access.gaining.hospital).toBeGreaterThan(0);
    expect(total.access.after.jobs).toBeGreaterThan(total.access.before.jobs);
    const again = await run();
    expect(again.e.rows[4]!.values).toEqual(total.values);
  });

  it("uses the project's formulas and parameters", async () => {
    const base = await run();
    const own = await run({ doc: { formulas: { ridership_daily: "pop * 0.5" } } });
    const pop = own.P.zones.reduce((s, z) => s + z.pop, 0);
    expect(own.e.rows.find((r) => r.id === "total")!.values.ridership_daily[1]).toBeCloseTo(pop * 0.5, 0);
    const doubled = await run({ prefs: { "benefit.elasticity_agglomeration": 0.08 } });
    const g = (x: typeof base) => x.e.rows.find((r) => r.id === "total")!.values.gdp[1];
    expect(g(doubled) / g(base)).toBeGreaterThan(1.5);
  });

  it("lets regions take priority over WorldPop, land values and tax", async () => {
    const tt = network();
    const whole: LonLat[] = [
      at(-2000, -2000),
      at(5000, -2000),
      at(5000, 3000),
      at(-2000, 3000),
      at(-2000, -2000),
    ];
    const region: Region = {
      id: "all",
      name: "Everywhere",
      ring: whole,
      source: "drawn",
      values: { populationDensity: 1000, landValuePerM2: 10_000, taxRevenuePerYear: 1e6 },
    };
    const base = await run();
    const r = await run({ regions: [region] });
    expect(r.P.popSource.regions).toBeGreaterThan(0);
    expect(r.P.popSource.worldpop).toBe(0);
    // 1000 people per km² over four catchments of 0.5–0.8 km radius.
    const people = r.P.zones.reduce((s, z) => s + z.pop, 0);
    expect(people).toBeGreaterThan(1000);
    expect(people).toBeLessThan(10_000);
    const lv = (x: typeof base) => x.e.rows.find((y) => y.id === "total")!.values.land_value[1];
    expect(lv(r)).not.toBeCloseTo(lv(base), -3);
    expect(r.e.rows.find((y) => y.id === "total")!.values.property_tax[1]).toBeGreaterThan(0);
    void tt;
  });

  it("estimates population from homes when WorldPop is unavailable", async () => {
    const tt = network();
    const r = await run({ wp: Object.fromEntries(catchments(tt, undefined).map((a) => [a.id, null])) });
    expect(r.P.popSource.worldpop).toBe(0);
    expect(r.P.popSource.buildings).toBeGreaterThan(0);
    expect(r.P.notes.join(" ")).toContain("WorldPop is unavailable");
    // 10 buildings of 400 m² × 4 floors per station at 35 m² per person.
    const people = r.P.zones.reduce((s, z) => s + z.pop, 0);
    expect(people).toBeCloseTo((4 * 10 * 400 * 4) / 35, -1);
  });

  it("splits cost items into spending groups by line", () => {
    expect(groupOf("vehicles")).toBe("vehicles");
    expect(groupOf("switches")).toBe("systems");
    expect(groupOf("tbm")).toBe("civil");
    expect(groupOf("service")).toBe("operating");
    const est = {
      items: [
        { category: "tbm", mode: "metro", line: null, amount: [10, 20, 30] },
        { category: "vehicles", mode: "metro", line: "rail:A", amount: [1, 2, 3] },
        { category: "service", mode: "bus", line: null, amount: [5, 5, 5] },
      ],
      lines: [
        { id: "rail:A", mode: "metro", kmPerYear: 3 },
        { id: "rail:B", mode: "metro", kmPerYear: 1 },
      ],
    } as unknown as CostEstimate;
    const s = spendingFrom(est);
    expect(s.get("rail:A")!.civil).toEqual([7.5, 15, 22.5]);
    expect(s.get("rail:A")!.vehicles).toEqual([1, 2, 3]);
    expect(s.get("rail:B")!.civil).toEqual([2.5, 5, 7.5]);
    expect(s.get(":bus")!.operating).toEqual([5, 5, 5]);
  });
});

describe("data for the benefit tables", () => {
  it("turns World Bank percentages into shares and finds the tiles around stations", async () => {
    expect(
      countryFigures({
        iso3: "NLD",
        gdpPerCapita: { year: 2024, value: 60000 },
        employmentRatio: { year: 2024, value: 62 },
        under15Share: { year: 2024, value: 15 },
        population: { year: 2024, value: 18e6 },
        populationWorldPopYear: { year: 2020, value: 17.4e6 },
        source: { name: "", licence: "", url: "" },
      }),
    ).toEqual({ gdpPerCapita: 60000, employmentRatio15: 0.62, under15: 0.15, popGrowth: 18 / 17.4 });
    expect(countryFigures(null)).toEqual({
      gdpPerCapita: null,
      employmentRatio15: null,
      under15: null,
      popGrowth: 1,
    });
    const tiles = catchmentTiles([{ at: C, radius: 800 }]);
    expect(tiles.length).toBeGreaterThan(0);
    const api = {
      buildingTile: vi.fn(async (x: number) => (x === tiles[0]![0] ? [building("b", 0, 0, "house")] : [])),
      placeTile: vi.fn(async () => {
        throw new Error("down");
      }),
    } as unknown as BenefitsApi;
    const got = await loadTiles(api, tiles);
    expect(got.buildings).toHaveLength(1);
    expect(got.failed).toBe(tiles.length);
  });
});

function fakeApi(over: Partial<BenefitsApi> = {}): BenefitsApi {
  return {
    indicators: async () => ({
      iso3: "NLD",
      gdpPerCapita: { year: 2024, value: 60000 },
      employmentRatio: { year: 2024, value: 62 },
      under15Share: { year: 2024, value: 15 },
      population: { year: 2024, value: 18e6 },
      populationWorldPopYear: { year: 2020, value: 17.4e6 },
      source: { name: "World Bank", licence: "CC BY 4.0", url: "" },
    }),
    population: async (areas) => ({
      year: 2020,
      populations: Object.fromEntries(areas.map((a) => [a.id, 4000])),
      failed: 0,
      source: { name: "WorldPop", licence: "CC BY 4.0", url: "" },
    }),
    buildingTile: async () => buildings(),
    placeTile: async () => PLACES,
    osmAreas: async () => [],
    ...over,
  };
}

describe("benefit tables", () => {
  it("shows the estimates and saves a project's formula", async () => {
    const onDoc = vi.fn();
    render(
      <BenefitTables
        timetable={network()}
        regions={[]}
        preferences={null}
        onPreferences={() => {}}
        doc={null}
        onDoc={onDoc}
        costs={{
          estimate: { items: [], lines: [], modes: [], notes: [] } as unknown as CostEstimate,
          currency: "EUR",
          country: "NLD",
        }}
        api={fakeApi()}
        loadReach={fakeReach}
        draws={30}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Ridership" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Access for people" })).toBeTruthy();
    expect(screen.getAllByText("Land and property value uplift").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: "M1" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "All Metro lines" })).toBeTruthy();
    // Edit the ridership formula: a broken one is flagged and not saved; a good one is saved.
    const box = screen.getByLabelText("Ridership: boardings on a weekday at a station");
    fireEvent.change(box, { target: { value: "pop * share" } });
    expect(screen.getByRole("alert").textContent).toContain('Unknown variable "share"');
    fireEvent.blur(box);
    expect(onDoc).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "pop * 0.2" } });
    fireEvent.blur(box);
    expect(onDoc).toHaveBeenCalledWith({ formulas: { ridership_daily: "pop * 0.2" } });
  });

  it("says when there is nothing to estimate", () => {
    render(
      <BenefitTables
        timetable={null}
        regions={[]}
        preferences={null}
        doc={null}
        costs={null}
        api={fakeApi()}
        loadReach={fakeReach}
      />,
    );
    expect(screen.getByText(/No stations yet/)).toBeTruthy();
  });
});

/** Just enough of a MapLibre map for the region editor: click handlers and GeoJSON sources. */
function fakeMap() {
  const handlers: ((ev: unknown) => void)[] = [];
  const sources = new Map<string, { setData: (d: unknown) => void; data: unknown }>();
  const layers = new Set<string>();
  const map = {
    isStyleLoaded: () => true,
    once: () => {},
    off: (_: string, h: (ev: unknown) => void) => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
    on: (_: string, h: (ev: unknown) => void) => handlers.push(h),
    getStyle: () => ({}),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: { data: unknown }) => {
      const src = { data: s.data, setData: (d: unknown) => (src.data = d) };
      sources.set(id, src);
    },
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    addLayer: (l: { id: string }) => layers.add(l.id),
    removeLayer: (id: string) => layers.delete(id),
    queryRenderedFeatures: () => [],
    getCanvas: () => ({ style: {} }),
    getZoom: () => 12,
    easeTo: () => {},
  };
  const click = (p: LonLat) =>
    act(() => handlers.forEach((h) => h({ lngLat: { lng: p[0], lat: p[1] }, point: { x: 0, y: 0 } })));
  return { map, click, sources };
}

describe("region editor", () => {
  it("draws a region and sets its values", () => {
    const { map, click } = fakeMap();
    let regions: Region[] = [];
    const onChange = vi.fn((r: Region[]) => (regions = r));
    const { rerender } = render(
      <RegionEditor
        map={map as never}
        panel={null}
        regions={regions}
        onChange={onChange}
        editable
        currency="EUR"
        api={fakeApi()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draw a region" }));
    click(at(0, 0));
    click(at(500, 0));
    click(at(500, 500));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(regions[0]!.ring).toHaveLength(4);
    expect(regions[0]!.ring[3]).toEqual(regions[0]!.ring[0]);
    rerender(
      <RegionEditor
        map={map as never}
        panel={null}
        regions={regions}
        onChange={onChange}
        editable
        currency="EUR"
        api={fakeApi()}
      />,
    );
    const value = screen.getByLabelText(/Land and building value/);
    fireEvent.change(value, { target: { value: "4500" } });
    fireEvent.blur(value);
    expect(regions[0]!.values.landValuePerM2).toBe(4500);
    rerender(
      <RegionEditor
        map={map as never}
        panel={null}
        regions={regions}
        onChange={onChange}
        editable
        currency="EUR"
        api={fakeApi()}
      />,
    );
    const rate = screen.getByLabelText(/Residents with a job/);
    fireEvent.change(rate, { target: { value: "48" } });
    fireEvent.blur(rate);
    expect(regions[0]!.values.employmentRate).toBeCloseTo(0.48);
    rerender(
      <RegionEditor
        map={map as never}
        panel={null}
        regions={regions}
        onChange={onChange}
        editable
        currency="EUR"
        api={fakeApi()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Primary land use/), { target: { value: "mixed" } });
    expect(regions[0]!.values.landUse).toBe("mixed");
  });

  it("imports a neighbourhood from OpenStreetMap", async () => {
    const { map, click } = fakeMap();
    const area: OsmArea = {
      id: "r42",
      name: "Oud-West",
      kind: "suburb",
      adminLevel: null,
      ring: [at(0, 0), at(900, 0), at(900, 900), at(0, 0)],
      areaKm2: 0.4,
    };
    const onChange = vi.fn();
    render(
      <RegionEditor
        map={map as never}
        panel={null}
        regions={[]}
        onChange={onChange}
        editable
        api={fakeApi({ osmAreas: async () => [area] })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import from OpenStreetMap" }));
    click(at(100, 100));
    fireEvent.click(await screen.findByRole("button", { name: /Oud-West/ }));
    expect(onChange.mock.calls[0]![0]).toMatchObject([
      { name: "Oud-West", source: "osm", osmId: "r42", values: {} },
    ]);
  });
});

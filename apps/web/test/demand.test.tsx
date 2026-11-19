import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenefitsApi } from "../src/features/benefits/data";
import type { BuildingIn, CountryFigures, PlaceIn } from "../src/features/benefits/model";
import type { LonLat, Timetable } from "../src/features/journey-planner/types";
import {
  type DemandResult,
  type DemandRunDetail,
  type DemandRunsApi,
  demandTiles,
} from "../src/features/demand/api";
import {
  estimateZones,
  makeBundle,
  periodWindows,
  transitOf,
  withStepFree,
} from "../src/features/demand/bundle";
import type { Estimate } from "../src/features/benefits/model";
import { DemandSection } from "../src/features/demand/DemandSection";
import { CalibrationResult, observedForRun, parseCountsCsv } from "../src/features/demand/Calibration";
import type { Calibration } from "../src/features/demand/api";
import { demandRidership, demandStopBoardings, withDemandRidership } from "../src/features/demand/ridership";
import { loadZoneData, zoneTiles } from "../src/features/demand/load";
import {
  activeZones,
  type DemandDoc,
  type DemandZone,
  hexZones,
  linePoints,
  thinRing,
  withZoneValues,
  zoneCentre,
  zoneKm2,
  zonesFromGeoJson,
  zonesToGeoJson,
} from "../src/features/demand/zones";
import { type Note, translate } from "../src/i18n/i18n";

const inEnglish = (notes: Note[]) => notes.map((n) => translate("en", n.key, n.vars));

afterEach(cleanup);

const C: LonLat = [5.0, 52.0];
/** `[lon, lat]` x metres east and y metres north of C. */
function at(x: number, y: number): LonLat {
  return [C[0] + x / (111_320 * Math.cos((C[1] * Math.PI) / 180)), C[1] + y / 110_574];
}

/** Tram T1 west–east over 3 km every 10 min all day; bus B1 with two timetabled trips in the morning. */
function network(): Timetable {
  const stop = (id: string, name: string, x: number, y: number) => {
    const [lon, lat] = at(x, y);
    return { stop_id: id, stop_name: name, stop_lon: lon, stop_lat: lat };
  };
  const st = (stop_id: string, seq: number, t: number) => ({
    stop_id,
    stop_sequence: seq,
    arrival_time: t,
    departure_time: t,
  });
  return {
    stops: [
      stop("t1", "West", 0, 0),
      stop("t2", "Central", 1500, 0),
      stop("t3", "East", 3000, 0),
      stop("b1", "Central bus", 1530, 40),
      stop("b2", "North", 1500, 1500),
      stop("x", "Unused", 9000, 9000),
    ],
    routes: [
      { route_id: "rail:T1", route_short_name: "T1", mode: "tram" },
      { route_id: "street:0", route_short_name: "B1", mode: "bus" },
    ],
    trips: [
      {
        trip_id: "b-a",
        route_id: "street:0",
        stop_times: [st("b1", 1, 7 * 3600 + 600), st("b2", 2, 7 * 3600 + 900)],
      },
      {
        trip_id: "b-b",
        route_id: "street:0",
        stop_times: [st("b1", 1, 8 * 3600), st("b2", 2, 8 * 3600 + 360)],
      },
    ],
    transfers: [],
    frequency_patterns: [
      {
        pattern_id: "t",
        route_id: "rail:T1",
        stops: [
          { stop_id: "t1", run_time: 0, dwell_time: 0 },
          { stop_id: "t2", run_time: 150, dwell_time: 30 },
          { stop_id: "t3", run_time: 150, dwell_time: 30 },
        ],
        periods: [{ start_time: 6 * 3600, end_time: 22 * 3600, headway_secs: 600, kind: "peak" }],
      },
    ],
  };
}

const COUNTRY: CountryFigures = { gdpPerCapita: 50_000, employmentRatio15: 0.6, under15: 0.15 };

function square(id: string, x: number, y: number, size: number, values = {}): DemandZone {
  const ring = [at(x, y), at(x + size, y), at(x + size, y + size), at(x, y + size), at(x, y)];
  return { id, name: `Zone ${id}`, ring, values };
}

describe("model area and automatic zones", () => {
  it("follows the lines: stops and points between them, each once", () => {
    const pts = linePoints(network());
    // Stops and a point at most every 250 m between them; the unused stop is left out.
    expect(pts.length).toBeGreaterThanOrEqual(5 + 2 * 5 + 5);
    expect(pts.length).toBeLessThanOrEqual(5 + 2 * 6 + 6);
    const far = at(9000, 9000);
    expect(pts.some((p) => Math.abs(p[0] - far[0]) < 1e-6 && Math.abs(p[1] - far[1]) < 1e-6)).toBe(false);
    expect(linePoints(null)).toEqual([]);
  });

  it("covers the buffer with hexagons of the smallest size that stays within the zone limit", () => {
    const pts = linePoints(network());
    const fine = hexZones(pts, 1000, 2000);
    expect(fine.res).toBe(9);
    const coarse = hexZones(pts, 1000, 30);
    expect(coarse.res).toBeLessThan(9);
    expect(coarse.zones.length).toBeLessThanOrEqual(30);
    for (const z of fine.zones.slice(0, 20)) {
      expect(z.ring).toHaveLength(7);
      expect(zoneKm2(z)).toBeCloseTo(0.1053, 2);
    }
    // Every line point is inside some hexagon.
    for (const p of pts.slice(0, 10)) {
      expect(fine.zones.some((z) => zoneKm2(z) > 0 && insideRing(p, z.ring))).toBe(true);
    }
    expect(new Set(fine.zones.map((z) => z.id)).size).toBe(fine.zones.length);
    expect(hexZones([], 1000, 100)).toEqual({ zones: [], res: null });
  });

  it("keeps the planner's values on automatic zones by id, and own zones as they are", () => {
    const auto = [square("a", 0, 0, 500), square("b", 500, 0, 500)];
    let doc: DemandDoc = withZoneValues(null, "b", { population: 1234 });
    expect(activeZones(doc, auto)[1]!.values).toEqual({ population: 1234 });
    doc = withZoneValues(doc, "b", {});
    expect(doc.autoValues).toEqual({});
    const own: DemandDoc = { source: "own", zones: [square("o", 0, 0, 100)] };
    expect(activeZones(own, auto).map((z) => z.id)).toEqual(["o"]);
    expect(activeZones(withZoneValues(own, "o", { workers: 5 }), auto)[0]!.values).toEqual({ workers: 5 });
  });

  it("finds a point inside an L-shaped zone and thins long outlines", () => {
    const L = {
      id: "L",
      name: "L",
      ring: [at(0, 0), at(1000, 0), at(1000, 100), at(100, 100), at(100, 1000), at(0, 1000), at(0, 0)],
      values: {},
    };
    expect(insideRing(zoneCentre(L), L.ring)).toBe(true);
    const long = Array.from({ length: 1000 }, (_, i) => at(Math.cos(i / 159) * 500, Math.sin(i / 159) * 500));
    const thin = thinRing(long, 50);
    expect(thin).toHaveLength(50);
    expect(thin[0]).toEqual(thin.at(-1));
  });
});

function insideRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("own zones from GeoJSON", () => {
  const poly = (x: number) => ({ type: "Polygon", coordinates: [square("s", x, 0, 400).ring] });
  it("reads polygons with their values under common names, and writes them back", () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { ZONE_ID: "A1", Name: "Harbour", POP: "1200", Jobs: 300 },
          geometry: poly(0),
        },
        {
          type: "Feature",
          properties: { id: "A1", students: 40, cbd: "yes" },
          geometry: { type: "MultiPolygon", coordinates: [poly(500).coordinates, poly(2000).coordinates] },
        },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: C } },
      ],
    });
    const { zones, notes } = zonesFromGeoJson(text);
    expect(zones.map((z) => z.id)).toEqual(["A1", "A1-2"]);
    expect(zones[0]!.name).toBe("Harbour");
    expect(zones[0]!.values).toEqual({ population: 1200, other_jobs: 300 });
    expect(zones[1]!.values).toEqual({ pupils: 40, cbd: true });
    expect(notes).toEqual(["1 features were not polygons and were skipped."]);
    const back = zonesFromGeoJson(zonesToGeoJson(zones)).zones;
    expect(back.map((z) => [z.id, z.values])).toEqual(zones.map((z) => [z.id, z.values]));
  });

  it("refuses files that are not polygon GeoJSON", () => {
    expect(() => zonesFromGeoJson("nope")).toThrow(/not GeoJSON/);
    expect(() => zonesFromGeoJson(JSON.stringify({ type: "FeatureCollection", features: [] }))).toThrow(
      /no GeoJSON/,
    );
    expect(() =>
      zonesFromGeoJson(
        JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: C } }),
      ),
    ).toThrow(/no polygon/);
  });
});

describe("demand run input", () => {
  it("turns the published lines into patterns with running times and headways by period", () => {
    const t = transitOf(network(), null);
    expect(t.stops.map((s) => s.id).sort()).toEqual(["b1", "b2", "t1", "t2", "t3"]);
    const tram = t.lines.find((l) => l.id === "rail:T1")!;
    expect(tram.patterns).toHaveLength(1);
    expect(tram.patterns[0]!.run_s).toEqual([180, 180]);
    // The evening runs to 23:00 but the tram stops at 22:00: 18 trams in 4 hours.
    expect(tram.patterns[0]!.headway_s).toEqual({ am: 600, md: 600, pm: 600, ev: 800 });
    const bus = t.lines.find((l) => l.id === "street:0")!;
    // Two trips with the same stops: one pattern, mean running time 330 s; both leave in the morning peak.
    expect(bus.patterns[0]!.run_s).toEqual([330]);
    const [a0, a1] = periodWindows(null).am;
    expect(bus.patterns[0]!.headway_s).toEqual({ am: (a1 - a0) / 2, md: null, pm: null, ev: null });
    expect(t.catchment_m.tram).toBeGreaterThan(0);
    expect(t.catchment_m["*"]).toBeGreaterThan(0);
    expect(transitOf(null, null)).toEqual({ stops: [], lines: [], catchment_m: {} });
  });

  it("estimates zone values and keeps the planner's own", () => {
    const zones = [square("a", 0, 0, 1000), square("b", 1000, 0, 1000, { population: 500, cbd: true })];
    const office: BuildingIn = { id: "o", ring: square("x", 100, 100, 50).ring, levels: 4, use: "office" };
    const shop: BuildingIn = { id: "s", ring: square("y", 1200, 100, 20).ring, levels: 1, use: "retail" };
    const places: PlaceIn[] = [
      { id: "p1", kind: "school", lonlat: at(300, 300) },
      { id: "p2", kind: "hospital", lonlat: at(1500, 500) },
    ];
    const est = estimateZones({
      zones,
      worldpop: { a: 2000, b: 9999 },
      buildings: [office, shop],
      places,
      covered: () => true,
      country: COUNTRY,
      regions: [],
      prefs: null,
    });
    const [a, b] = est.zones;
    expect(a!.population).toBe(2000);
    expect(a!.workers).toBeCloseTo(2000 * 0.6 * 0.85, 0);
    expect(a!.children).toBe(300);
    expect(a!.other_jobs).toBeGreaterThan(0);
    expect(a!.retail_jobs).toBe(0);
    expect(a!.schools).toBe(1);
    expect(a!.cbd).toBeNull();
    expect(b!.population).toBe(500);
    expect(b!.retail_jobs).toBeGreaterThan(0);
    expect(b!.hospitals).toBe(1);
    expect(b!.cbd).toBe(true);
    expect(b!.area_km2).toBeCloseTo(1, 1);
    expect(est.sources.a!.population).toBe("worldpop");
    expect(est.sources.b!.population).toBe("own");
    expect(est.notes).toEqual([]);

    const away = estimateZones({
      zones,
      worldpop: {},
      buildings: [],
      places: [],
      covered: (z) => z.id === "b",
      country: { gdpPerCapita: null, employmentRatio15: null, under15: null },
      regions: [],
      prefs: null,
    });
    expect(away.zones[0]!.population).toBe(0);
    expect(inEnglish(away.notes).join(" ")).toMatch(/1 zones are beyond/);
    expect(inEnglish(away.notes).join(" ")).toMatch(/45 %/);

    const { bundle, summary } = makeBundle(est.zones, transitOf(network(), null), {
      currency: "EUR",
      gdp_per_capita: 50_000,
      ppp_per_usd: 0.8,
    });
    expect(bundle.version).toBe(1);
    expect(summary).toEqual({ zones: 2, stops: 5, lines: 2 });
  });

  it("loads WorldPop in batches and buildings tile by tile, counting what fails", async () => {
    const zones = Array.from({ length: 450 }, (_, i) =>
      square(`z${i}`, (i % 30) * 100, Math.floor(i / 30) * 100, 100),
    );
    const population = vi.fn(async (areas: { id: string }[]) => ({
      year: 2020,
      populations: Object.fromEntries(areas.map((a) => [a.id, 10])),
      failed: 0,
      reasons: [],
      source: { name: "", licence: "", url: "" },
    }));
    let calls = 0;
    const api = {
      population,
      buildingTile: async () => {
        if (calls++ === 0) throw new Error("down");
        return [{ id: "b", ring: square("q", 10, 10, 10).ring, use: "office" }];
      },
      placeTile: async () => [],
    } as unknown as BenefitsApi;
    const progress: number[] = [];
    const d = await loadZoneData(api, zones, (f) => progress.push(f));
    expect(population).toHaveBeenCalledTimes(2);
    expect(Object.keys(d.worldpop)).toHaveLength(450);
    expect(d.popYear).toBe(2020);
    const tiles = zoneTiles(zones).length;
    expect(d.failed).toBe(1);
    expect(d.loaded.size).toBe(tiles - 1);
    expect(d.buildings).toHaveLength(1);
    expect(progress.at(-1)).toBe(1);
  });
});

function result(): DemandResult {
  return {
    version: 1,
    uncalibrated: true,
    attribution: "Demand model computed with AequilibraE",
    currency: "EUR",
    notes: ["A note."],
    zones_count: 2,
    period_hours: { am: 2, md: 7, pm: 3, ev: 4 },
    totals: {
      trips: 1000,
      by_mode: { car: 500, transit: 250, walk: 200, cycle: 50 },
      by_period: { am: { car: 100, transit: 60, walk: 30, cycle: 10 } },
      by_purpose: { hbw: { car: 200, transit: 100, walk: 50, cycle: 20 } },
      car_km: 4.2,
      walk_min: 9,
      cycle_min: 12,
    },
    convergence: {},
    zones: [],
    desire_lines: [{ from: "a", to: "b", car: 10, transit: 42, walk: 1, cycle: 0 }],
    road: { columns: [], links: [[0, 0, 100, 0.95]], rgap: {} },
    transit: {
      lines: [
        {
          id: "rail:T1",
          name: "T1",
          mode: "tram",
          patterns: [
            {
              stops: ["t1", "t2"],
              boardings: { day: [120, 0], am: [40, 0] },
              alightings: { day: [0, 120] },
              load: { day: [120], am: [40] },
            },
          ],
        },
      ],
      stops: { t1: { name: "West", boardings: 120, alightings: 0 } },
    },
    catchment: {
      cycle_lane_km: 3.2,
      cycle_track_km: 1.5,
      pedestrian_km: 0.8,
      bike_parkings: 14,
      shared_bike_stations: 6,
      stops_with_steps: 2,
      stops_step_free: 3,
      shared_bike_trips: 410,
      shared_bike_to_transit: 55,
      shared_bike_from_transit: 48,
      bike_and_ride: 230,
      transit_by_bike_owners: 900,
    },
    files: ["od.omx"],
  };
}

function fakeRuns(): DemandRunsApi & { started: unknown[] } {
  const started: unknown[] = [];
  const base = {
    id: "r1",
    kind: "demand" as const,
    network: { kind: "demand" as const, zones: 2, stops: 5, lines: 2 },
    error: null,
    cancelRequested: false,
    createdBy: null,
    createdAt: "2026-11-16T08:00:00Z",
    startedAt: null,
    finishedAt: "2026-11-16T08:01:00Z",
  };
  const done: DemandRunDetail = { ...base, status: "done", progress: null, result: result() };
  return {
    started,
    list: async () => [],
    get: async () => done,
    start: async (bundle, values, summary, gbfsUrl, observed) => {
      started.push({ bundle, values, summary, gbfsUrl, observed });
      return done;
    },
    cancel: async () => done,
    remove: async () => undefined,
    fileUrl: (id, name) => `/files/${id}/${name}`,
  };
}

function fakeBenefits(): BenefitsApi {
  return {
    indicators: async () => ({
      iso3: "NLD",
      gdpPerCapita: { year: 2023, value: 50_000 },
      employmentRatio: { year: 2023, value: 60 },
      under15Share: { year: 2023, value: 15 },
      population: null,
      source: { name: "World Bank", licence: "CC BY 4.0", url: "" },
    }),
    population: async (areas) => ({
      year: 2020,
      populations: Object.fromEntries(areas.map((a) => [a.id, 100])),
      failed: 0,
      reasons: [],
      source: { name: "WorldPop", licence: "CC BY 4.0", url: "" },
    }),
    buildingTile: async () => [],
    placeTile: async () => [],
    osmAreas: async () => [],
  };
}

describe("Demand model section", () => {
  it("shows the zones, estimates their values, runs the model and shows the results", async () => {
    const runs = fakeRuns();
    const onDoc = vi.fn();
    render(
      <DemandSection
        timetable={network()}
        regions={[]}
        preferences={{ values: { "demand.zone_max_count": 40 } }}
        doc={null}
        onDoc={onDoc}
        costs={{ currency: "EUR", country: "NLD", rate: 1, ppp: 0.8 }}
        runs={runs}
        canRun
        api={fakeBenefits()}
      />,
    );
    expect(screen.getByTestId("zone-source").textContent).toMatch(/automatic hexagons/);
    fireEvent.click(screen.getByRole("button", { name: "Estimate zone values" }));
    await waitFor(() => expect(screen.getAllByText(/WorldPop 2020/).length).toBeGreaterThan(0));
    const run = screen.getByRole("button", { name: "Run the demand model" });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(run);
    });
    expect(runs.started).toHaveLength(1);
    const sent = runs.started[0] as {
      bundle: { zones: { population: number }[]; economy: unknown };
      values: Record<string, number>;
    };
    expect(sent.bundle.zones.length).toBeGreaterThan(0);
    expect(sent.bundle.zones.length).toBeLessThanOrEqual(40);
    expect(sent.bundle.zones[0]!.population).toBe(100);
    expect(sent.bundle.economy).toEqual({ currency: "EUR", gdp_per_capita: 50_000, ppp_per_usd: 0.8 });
    expect(sent.values["demand.zone_max_count"]).toBe(40);
    expect(await screen.findByText("Uncalibrated")).toBeTruthy();
    expect(screen.getByText("T1")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download trip tables/ }).getAttribute("href")).toBe(
      "/files/r1/od.omx",
    );
    expect(screen.getByText(/1 reach 90 %/)).toBeTruthy();
  });

  it("asks for a published line before it can run, and lets the planner type a zone value", async () => {
    const onDoc = vi.fn();
    const { rerender } = render(
      <DemandSection
        timetable={null}
        regions={[]}
        preferences={null}
        doc={null}
        onDoc={onDoc}
        costs={null}
        runs={fakeRuns()}
        canRun
        api={fakeBenefits()}
      />,
    );
    expect(screen.getByText(/Publish a line first/)).toBeTruthy();
    const own: DemandDoc = { source: "own", zones: [square("o1", 0, 0, 500)] };
    rerender(
      <DemandSection
        timetable={network()}
        regions={[]}
        preferences={null}
        doc={own}
        onDoc={onDoc}
        costs={null}
        runs={fakeRuns()}
        canRun
        api={fakeBenefits()}
      />,
    );
    expect(screen.getByTestId("zone-source").textContent).toBe("Your 1 zones");
    const cell = screen.getByLabelText("People in zone Zone o1");
    fireEvent.change(cell, { target: { value: "750" } });
    fireEvent.blur(cell);
    expect(onDoc).toHaveBeenLastCalledWith({
      source: "own",
      zones: [{ ...own.zones![0]!, values: { population: 750 } }],
    });
    // Zone names, deleting and the automatic-or-own choice are in GIS → Demand zones only.
    expect(screen.queryByRole("button", { name: "Delete zone Zone o1" })).toBeNull();
    expect(screen.queryByLabelText("Name of zone o1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use automatic hexagons" })).toBeNull();
  });
});

describe("Demand zones in the GIS tab", () => {
  it("counts the zones and makes automatic hexagons the planner's own", async () => {
    const { DemandZoneEditor } = await import("../src/features/demand/ZoneEditor");
    const onDoc = vi.fn();
    render(
      <DemandZoneEditor
        map={null}
        panel={null}
        timetable={network()}
        preferences={{ values: { "demand.zone_max_count": 40 } }}
        doc={null}
        onDoc={onDoc}
      />,
    );
    expect(screen.getByTestId("zone-count").textContent).toMatch(/automatic hexagons within 2000 m/);
    fireEvent.click(screen.getByRole("button", { name: "Make these zones my own" }));
    const doc = onDoc.mock.calls[0]![0] as DemandDoc;
    expect(doc.source).toBe("own");
    expect(doc.zones!.length).toBeGreaterThan(0);
  });

  it("draws a new zone of the planner's own", async () => {
    const { DemandZoneEditor } = await import("../src/features/demand/ZoneEditor");
    const onDoc = vi.fn();
    const handlers: Record<string, (e: unknown) => void> = {};
    const map = {
      isStyleLoaded: () => true,
      getSource: () => ({ setData: () => undefined }),
      addSource: () => undefined,
      getLayer: () => undefined,
      addLayer: () => undefined,
      removeLayer: () => undefined,
      removeSource: () => undefined,
      getStyle: () => ({}),
      on: (ev: string, f: (e: unknown) => void) => {
        handlers[ev] = f;
      },
      off: () => undefined,
      once: () => undefined,
      queryRenderedFeatures: () => [],
      getCanvas: () => ({ style: {} }),
    };
    render(
      <DemandZoneEditor
        map={map as never}
        panel={null}
        timetable={network()}
        preferences={null}
        doc={{ source: "own", zones: [] }}
        onDoc={onDoc}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draw a zone" }));
    for (const p of [at(0, 0), at(500, 0), at(500, 500)])
      act(() => handlers.click!({ lngLat: { lng: p[0], lat: p[1] }, point: { x: 0, y: 0 } }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const doc = onDoc.mock.calls[0]![0] as DemandDoc;
    expect(doc.zones).toHaveLength(1);
    expect(doc.zones![0]!.ring).toHaveLength(4);
  });
});

describe("street tiles of a demand run", () => {
  it("takes each zone centre's tile and the eight around it, as the server does", () => {
    expect(demandTiles([C, at(10, 10)])).toHaveLength(9);
    expect(demandTiles([C, at(20_000, 0), [NaN, 1]])).toHaveLength(18);
  });
});

describe("catchment effects in the demand run input", () => {
  it("gives stops the step-free access of the drawn stop next to them, or none", () => {
    const transit = transitOf(network(), null);
    const [first, second] = transit.stops;
    const t = withStepFree(transit, [
      { lonlat: first!.lonlat, stepFree: false },
      { lonlat: [second!.lonlat[0] + 0.01, second!.lonlat[1]], stepFree: true }, // about 700 m away
    ]);
    expect(t.stops[0]!.step_free).toBe(false);
    expect(t.stops[1]!.step_free).toBeNull();
    expect(withStepFree(transit, [])).toBe(transit);
  });

  it("sends the street setups that change lanes, bus lanes or bike lanes", () => {
    const transit = transitOf(network(), null);
    const economy = { currency: "EUR", gdp_per_capita: 1, ppp_per_usd: 1 };
    const { bundle } = makeBundle([], transit, economy, [
      { way: 1, bike_lane: true, separated: true },
      { way: 2 },
      { way: 3, traffic_lanes: 2, bus_lane: false },
    ]);
    expect(bundle.street_setups).toEqual([
      { way: 1, traffic_lanes: null, bus_lane: null, bike_lane: true, separated: true },
      { way: 3, traffic_lanes: 2, bus_lane: false, bike_lane: null, separated: null },
    ]);
    expect(makeBundle([], transit, economy).bundle.street_setups).toBeUndefined();
  });

  it("saves the GBFS feed, sends it with the run and shows what the catchment did", async () => {
    const runs = fakeRuns();
    const onDoc = vi.fn();
    const doc: DemandDoc = { source: "auto", gbfsUrl: "https://bikes.example/gbfs.json" };
    const { rerender } = render(
      <DemandSection
        timetable={network()}
        regions={[]}
        preferences={{ values: { "demand.zone_max_count": 40 } }}
        doc={null}
        onDoc={onDoc}
        costs={{ currency: "EUR", country: "NLD", rate: 1, ppp: 0.8 }}
        runs={runs}
        canRun
        api={fakeBenefits()}
      />,
    );
    const field = screen.getByLabelText("Shared-bike feed (GBFS)");
    fireEvent.blur(field, { target: { value: "http://insecure.example/gbfs.json" } });
    expect(screen.getByRole("alert").textContent).toMatch(/https address/);
    expect(onDoc).not.toHaveBeenCalled();
    fireEvent.blur(field, { target: { value: " https://bikes.example/gbfs.json " } });
    expect(onDoc).toHaveBeenCalledWith(doc);
    rerender(
      <DemandSection
        timetable={network()}
        regions={[]}
        preferences={{ values: { "demand.zone_max_count": 40 } }}
        doc={doc}
        onDoc={onDoc}
        costs={{ currency: "EUR", country: "NLD", rate: 1, ppp: 0.8 }}
        runs={runs}
        canRun
        api={fakeBenefits()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Estimate zone values" }));
    const run = screen.getByRole("button", { name: "Run the demand model" });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(run);
    });
    expect((runs.started[0] as { gbfsUrl?: string }).gbfsUrl).toBe("https://bikes.example/gbfs.json");
    expect(await screen.findByText("Catchment, a weekday")).toBeTruthy();
    expect(screen.getByText("230 riders cycle to a stop and park")).toBeTruthy();
    expect(screen.getByText(/2 recorded without step-free access/)).toBeTruthy();
  });
});

describe("demand model ridership in the project", () => {
  const row = (
    id: string,
    scope: "line" | "mode" | "total",
    mode: string | null,
    daily: [number, number, number],
  ) =>
    ({
      id,
      scope,
      name: id,
      mode,
      color: "#000",
      values: { ridership_daily: daily, ridership_annual: [daily[0] * 300, daily[1] * 300, daily[2] * 300] },
      access: {},
    }) as unknown as Estimate["rows"][number];

  it("sums boardings per line, per line and stop, and per stop", () => {
    const r = demandRidership("r1", "2026-11-16T08:01:00Z", result());
    expect(r.lines).toEqual({ "rail:T1": 120 });
    expect(r.stations).toEqual({ "rail:T1": { West: 120 } });
    expect(r.stops).toEqual({ West: 120 });
    expect(demandStopBoardings(["west", "East"], r, () => 2)).toEqual({ west: 60 });
  });

  it("puts the model's boardings in the benefit estimate, with the formula's spread, and adds up modes", () => {
    const est: Estimate = {
      rows: [
        row("rail:T1", "line", "tram", [50, 100, 200]),
        row("street:0", "line", "bus", [10, 20, 40]),
        row("mode:tram", "mode", "tram", [50, 100, 200]),
        row("total", "total", null, [60, 120, 240]),
      ],
      notes: [],
      draws: 200,
      stations: { "rail:T1": { West: 100 }, "street:0": { A: 20 } },
    };
    const r = demandRidership("r1", "2026-11-16T08:01:00Z", result());
    const out = withDemandRidership(est, r, { "benefit.ridership.days_per_year.tram": 250 });
    const get = (id: string) => out.rows.find((x) => x.id === id)!.values;
    expect(get("rail:T1").ridership_daily).toEqual([60, 120, 240]);
    expect(get("rail:T1").ridership_annual).toEqual([15_000, 30_000, 60_000]);
    expect(get("street:0").ridership_daily).toEqual([10, 20, 40]);
    expect(get("mode:tram").ridership_daily).toEqual([60, 120, 240]);
    expect(get("total").ridership_daily).toEqual([70, 140, 280]);
    expect(out.stations["rail:T1"]).toEqual({ West: 120 });
    expect(out.stations["street:0"]).toEqual({ A: 20 });
    expect(inEnglish(out.notes).at(-1)).toMatch(/demand model run .* \(uncalibrated\)/);
    // A run without any of the estimate's lines leaves it as it is.
    expect(withDemandRidership(est, { ...r, lines: { other: 5 } }, undefined)).toBe(est);
  });

  it("lets the planner use a run for the project's ridership and go back", async () => {
    const runs = fakeRuns();
    const onDoc = vi.fn();
    const props = {
      timetable: network(),
      regions: [],
      preferences: { values: { "demand.zone_max_count": 40 } },
      onDoc,
      costs: { currency: "EUR", country: "NLD", rate: 1, ppp: 0.8 },
      runs,
      canRun: true,
      api: fakeBenefits(),
    };
    const { rerender } = render(<DemandSection {...props} doc={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Estimate zone values" }));
    const run = screen.getByRole("button", { name: "Run the demand model" });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(run);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Use this run for ridership" }));
    expect(onDoc).toHaveBeenLastCalledWith({ source: "auto", ridershipRun: "r1" });
    rerender(<DemandSection {...props} doc={{ source: "auto", ridershipRun: "r1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Go back to the formula estimate" }));
    expect(onDoc).toHaveBeenLastCalledWith({ source: "auto" });
  });
});

describe("demand model calibration", () => {
  it("reads counts from CSV with or without a header, and lists the rows it cannot use", () => {
    const text =
      '\uFEFFkind,id,value\nline,T1,1200\nstop,"Main St, north",340\nbus,X,5\nline,,4\nstop;West;12\n';
    const { counts, errors } = parseCountsCsv(text);
    expect(counts).toEqual([
      { kind: "line", id: "T1", value: 1200 },
      { kind: "stop", id: "Main St, north", value: 340 },
      { kind: "stop", id: "West", value: 12 },
    ]);
    expect(errors[0]).toMatch(/Rows 4, 5 were left out/);
    expect(parseCountsCsv("line,T1,10").counts).toHaveLength(1);
  });

  it("sends the shares only when all four are given, with the trip length and the counts", () => {
    expect(observedForRun(undefined)).toBeUndefined();
    expect(observedForRun({ shares: { car: 50, transit: 20 } })).toBeUndefined();
    expect(
      observedForRun({
        shares: { car: 50, transit: 20, walk: 20, cycle: 10 },
        meanCarKm: 8,
        counts: [{ kind: "line", id: "T1", value: 900 }],
      }),
    ).toEqual({
      mode_shares: { car: 50, transit: 20, walk: 20, cycle: 10 },
      mean_car_km: 8,
      counts: [{ kind: "line", id: "T1", value: 900 }],
    });
  });

  it("saves the observed data, sends it with the run and adds an uploaded CSV to the counts", async () => {
    const runs = fakeRuns();
    const onDoc = vi.fn();
    const props = {
      timetable: network(),
      regions: [],
      preferences: { values: { "demand.zone_max_count": 40 } },
      onDoc,
      costs: { currency: "EUR", country: "NLD", rate: 1, ppp: 0.8 },
      runs,
      canRun: true,
      api: fakeBenefits(),
    };
    const { rerender } = render(<DemandSection {...props} doc={null} />);
    fireEvent.blur(screen.getByLabelText("Car, % of trips"), { target: { value: "45" } });
    expect(onDoc).toHaveBeenLastCalledWith({ source: "auto", observed: { shares: { car: 45 } } });
    const doc: DemandDoc = {
      source: "auto",
      observed: {
        shares: { car: 45, transit: 25, walk: 20, cycle: 10 },
        meanCarKm: 7.5,
        counts: [{ kind: "line", id: "T1", value: 900 }],
      },
    };
    rerender(<DemandSection {...props} doc={doc} />);
    expect((screen.getByLabelText("Count 1: id or name") as HTMLInputElement).value).toBe("T1");
    const file = new File(["kind,id,value\nstop,West,120\n"], "counts.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "kind,id,value\nstop,West,120\n" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Upload counts (CSV)"), { target: { files: [file] } });
    });
    await waitFor(() =>
      expect(onDoc).toHaveBeenLastCalledWith({
        ...doc,
        observed: {
          ...doc.observed,
          counts: [
            { kind: "line", id: "T1", value: 900 },
            { kind: "stop", id: "West", value: 120 },
          ],
        },
      }),
    );
    expect(screen.getByText("1 counts read from counts.csv.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Estimate zone values" }));
    const run = screen.getByRole("button", { name: "Run the demand model" });
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(run);
    });
    expect((runs.started[0] as { observed?: unknown }).observed).toEqual({
      mode_shares: { car: 45, transit: 25, walk: 20, cycle: 10 },
      mean_car_km: 7.5,
      counts: [{ kind: "line", id: "T1", value: 900 }],
    });
  });

  it("shows how the run fits, the counts with the largest GEH, and saves the fitted values", () => {
    const c: Calibration = {
      mode_shares: {
        car: { observed: 0.45, modelled: 0.46 },
        transit: { observed: 0.25, modelled: 0.24 },
        walk: { observed: 0.2, modelled: 0.2 },
        cycle: { observed: 0.1, modelled: 0.1 },
      },
      mean_car_km: { observed: 7.5, modelled: 7.4 },
      counts: [
        { kind: "line", id: "T1", observed: 900, modelled: 1300, geh: 2.8 },
        { kind: "stop", id: "Nowhere", observed: 50, modelled: null, geh: null },
      ],
      matched: 1,
      rmse_pct: 44.4,
      geh_under_5_share: 1,
      rounds: [
        { round: 1, gap: 0.3, rmse_pct: 60, shares: { car: 0.5, transit: 0.2, walk: 0.2, cycle: 0.1 } },
        { round: 2, gap: 0.04, rmse_pct: 44.4, shares: { car: 0.46, transit: 0.24, walk: 0.2, cycle: 0.1 } },
      ],
      fitted: { "demand.mode.asc.transit": 0.4321 },
    };
    const onPreferences = vi.fn();
    render(
      <CalibrationResult
        c={c}
        preferences={{ values: { "demand.zone_max_count": 40 } }}
        onPreferences={onPreferences}
      />,
    );
    expect(screen.getByText(/2 rounds; the largest gap left is 4\.0 %/)).toBeTruthy();
    expect(screen.getByText(/%RMSE 44\.4, 100 % with a GEH under 5/)).toBeTruthy();
    expect(screen.getByText("Line T1")).toBeTruthy();
    expect(screen.getByText(/1 counts name no line or stop of the network: Nowhere/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save fitted values to Project preferences" }));
    expect(onPreferences).toHaveBeenCalledWith({
      values: { "demand.zone_max_count": 40, "demand.mode.asc.transit": 0.4321 },
    });
    expect(screen.getByRole("button", { name: "Saved to Project preferences" })).toBeTruthy();
  });
});

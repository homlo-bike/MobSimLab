import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("../src/features/noise/mapLayer", () => ({
  drawNoise: vi.fn(),
  removeNoise: vi.fn(),
  LEGEND: [
    { from_db: 50, color: "#e2f2bf" },
    { from_db: 55, color: "#f3c683" },
    { from_db: 60, color: "#e87e4d" },
  ],
}));

import {
  DIFFERENCE,
  differenceClass,
  differenceLevels,
  differencePixels,
  exposureRows,
} from "../src/features/noise/difference";
import { engineRunner } from "../src/features/noise/engine";
import { classPolygons, contoursGeoJson, csv, traceRings } from "../src/features/noise/export";
import { coverPoints, designSources, hoursText } from "../src/features/noise/inputs";
import { NoiseMap } from "../src/features/noise/NoiseMap";
import { countRunLine, coveredHours, simulatedStreetSources } from "../src/features/noise/simulated";
import {
  byHour,
  cutPolyline,
  legEntryTimes,
  polylineLength,
  timetabledRailSources,
  timetabledStreetSources,
  trackStretches,
} from "../src/features/noise/timetabled";
import type { NoiseEngine, NoiseInput, NoiseView } from "../src/features/noise/types";
import type { Network, RailEngineLoader, RailView } from "../src/features/railways/types";
import type { RoadRun, RoadRunsApi } from "../src/features/road-sim/api";
import type { Replay, RoadLine } from "../src/features/road-sim/types";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import type { LineView } from "../src/features/street-lines/types";
import type { ScenariosDoc } from "../src/features/tables/scenarioModel";

/** A two-stop shuttle 286 m east, out and back: leg 0 east, leg 1 west. */
function view(): LineView {
  const points = (["end_stop", "stop"] as const).map((kind, seq) => ({
    id: seq + 1,
    seq,
    kind,
    name: `P${seq + 1}`,
    lonlat: [7 + seq * 0.004, 50] as [number, number],
    status: "ok" as const,
    message: null,
    bearing_deg: 90,
    bay: null,
  }));
  return {
    points,
    legs: points.map((p, i) => ({
      index: i,
      from: p.id,
      to: points[(i + 1) % 2]!.id,
      coords: [p.lonlat, points[(i + 1) % 2]!.lonlat],
      length_m: 286,
      time_s: 40,
      direct_m: 286,
      status: "ok" as const,
      message: null,
      ways: [1],
      crossing_wait_s: 0,
      level_crossings: [],
    })),
    directions: [],
    station_groups: [],
    depot: null,
    depot_trips: [],
    issues: [],
    level_crossings: [],
    crossing_wait_s: 0,
    length_m: 572,
    time_s: 80,
  } as LineView;
}

function doc(name = "Route 7", headwayMin = 10): StreetLinesDoc {
  return {
    lines: [
      {
        name,
        profile: {
          mode: "bus",
          height_m: 3.1,
          weight_t: 19,
          length_m: 12,
          max_speed_kmh: 80,
          battery_range_m: 0,
          doors_both_sides: false,
        },
        timing: { headwayMin, dwellS: 20 },
        points: [],
        depot: null,
        depotStops: {},
        view: view(),
      },
    ],
  } as unknown as StreetLinesDoc;
}

const noRail: RailEngineLoader = () => Promise.reject(new Error("no railway in this test"));

describe("timetabled noise input", () => {
  it("counts a street line's departures of the day on each leg by clock hour", () => {
    const [out, back] = timetabledStreetSources(doc().lines);
    expect(out!.id).toBe("street-0-leg-0");
    expect(out!.label).toBe("Route 7");
    // 05:00–07:00 every 20 min, 07:00–09:00 every 10 min, the last at 24:20.
    expect(out!.hourly![5]).toBe(3);
    expect(out!.hourly![7]).toBe(6);
    expect(out!.hourly![12]).toBe(3);
    expect(out!.hourly![0]).toBe(2);
    expect(out!.hourly![2]).toBe(0);
    expect(back!.hourly!.reduce((a, b) => a + b, 0)).toBe(out!.hourly!.reduce((a, b) => a + b, 0));
    expect(out!.stops_m).toEqual([0, expect.closeTo(286, 0)]);
  });

  it("enters each leg after the legs, dwells and layovers before it", () => {
    const line = {
      legs: [
        { coords: [], time_s: 100 },
        { coords: [], time_s: 50 },
        { coords: [], time_s: 70 },
      ],
      points: [{ kind: "end_stop" }, { kind: "stop" }, { kind: "end_stop" }],
      dwell_s: 20,
      layover_s: 300,
      departures: [3590],
    } as unknown as RoadLine;
    expect(legEntryTimes(line)).toEqual([[3590], [3710], [4060]]);
    expect(byHour([3590, 3710, 90_000])[0]).toBe(1);
    expect(byHour([3590, 3710, 90_000])[1]).toBe(2);
  });

  it("adds the lines of a double track, fills gaps through stations and merges equal stretches", () => {
    const h = (n: number) => Array.from({ length: 24 }, (_, i) => (i === 8 ? n : 0));
    const s = trackStretches([
      { index: 0, from_m: 0, to_m: 400, hourly: h(4) },
      { index: 0, from_m: 500, to_m: 900, hourly: h(4) },
      { index: 1, from_m: 0, to_m: 900, hourly: h(4) },
    ]);
    expect(s).toEqual([{ from_m: 0, to_m: 900, hourly: h(8) }]);
    // A line that turns back at 400 m on one track only.
    const t = trackStretches([
      { index: 0, from_m: 0, to_m: 900, hourly: h(4) },
      { index: 1, from_m: 0, to_m: 400, hourly: h(2) },
    ]);
    expect(t).toEqual([
      { from_m: 0, to_m: 400, hourly: h(6) },
      { from_m: 400, to_m: 900, hourly: h(4) },
    ]);
  });

  it("cuts a polyline between two chainages measured on the engine's length", () => {
    const line: [number, number][] = [
      [7, 50],
      [7.01, 50],
    ];
    const len = polylineLength(line);
    const cut = cutPolyline(line, 250, 500, 1000);
    expect(polylineLength(cut)).toBeCloseTo(len / 4, 3);
    expect(cut[0]![0]).toBeCloseTo(7.0025, 6);
    expect(cutPolyline(line, 600, 600, 1000)).toEqual([]);
  });

  it("puts each service line's trains on the stretches of track it runs on", () => {
    const doc = {
      mode: "metro",
      stations: [],
      tracks: [{ id: 3, use: "running" }],
      lines: [{ id: "M1", name: "M1", vehicle: "none", units: 2 }],
    } as unknown as Network;
    const rv = {
      tracks: [
        {
          id: 3,
          length_m: 1000,
          tracks: 2,
          mode: "metro",
          levels: [{ from_m: 0, to_m: 300, level: "underground" }],
          centre: [
            [7, 50],
            [7.014, 50],
          ],
          speed: {
            max_kmh: 80,
            time_s: 60,
            profile: [
              [0, 0, 40],
              [1000, 0, 80],
            ],
          },
        },
      ],
      switches: [],
      modes: {},
      params: { design_speed_kmh: 80 },
      train_length_m: 50,
    } as unknown as RailView;
    const hours = Array.from({ length: 24 }, (_, i) => (i >= 6 && i < 23 ? 6 : 0));
    const topology = {
      sections: [
        { id: "t3.0.0", source: { kind: "track", ref: 3, index: 0, chainage_m: [0, 600] } },
        { id: "t3.1.0", source: { kind: "track", ref: 3, index: 1, chainage_m: [0, 600] } },
        { id: "s1.0", source: { kind: "station", ref: 1, index: 0, chainage_m: null } },
      ],
    };
    const lines = timetabledRailSources(
      doc,
      rv,
      [
        { section: "t3.0.0", line: "M1", hours },
        { section: "t3.1.0", line: "M1", hours },
        { section: "s1.0", line: "M1", hours },
      ],
      topology as never,
    );
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    expect(l.hourly![8]).toBe(12);
    // The catalogue has no such train: the design's train length times two units.
    expect(l.vehicle_length_m).toBe(100);
    expect(polylineLength(l.points)).toBeCloseTo(polylineLength(rv.tracks[0]!.centre) * 0.6, 0);
    expect(l.speed![0]).toEqual([0, 40]);
    expect(l.speed!.at(-1)![0]).toBeCloseTo(600, 6);
    expect(l.ranges).toEqual([{ from_m: 0, to_m: 300, kind: "underground" }]);
  });

  it("writes clock hours as ranges", () => {
    expect(hoursText([7, 8, 9, 16, 17])).toBe("07:00–10:00, 16:00–18:00");
    expect(hoursText([23, 0])).toBe("00:00–01:00, 23:00–24:00");
  });
});

/** A replay of one bus going east along leg 0 at 30 km/h from 07:00 every 10 s for 60 s, then standing. */
function replay(): Replay {
  const s: number[] = [];
  for (let i = 0; i < 8; i++) {
    const lon = 7 + Math.min(i, 6) * 0.00055;
    s.push(Math.round(lon * 1e5), 50 * 1e5, 90, i < 7 ? 30 : 0, -1);
  }
  return {
    version: 1,
    begin: 7 * 3600 - 600,
    frame_s: 10,
    frames: 60 * 6 * 3,
    lines: [{ index: 0, name: "Route 7", color: "#000", mode: "bus" }],
    vehicles: [
      { id: "v1", line: 0, number: 1, slot_out: null, slot_in: null, f0: 60, s },
      // Westbound along the same street: leg 1.
      {
        id: "v2",
        line: 0,
        number: 2,
        slot_out: null,
        slot_in: null,
        f0: 400,
        s: [700440, 5000000, 270, 20, -1, 700380, 5000000, 270, 20, -1],
      },
    ],
    events: [],
  };
}

function runLine(): RoadLine {
  const v = view();
  return {
    index: 0,
    name: "Route 7",
    mode: "bus",
    color: "#000",
    vehicle: {
      length_m: 18,
      width_m: 2.55,
      max_speed_kmh: 80,
      weight_t: 28,
      energy: "battery",
      battery_kwh: 400,
      hvac_kw: 10,
    },
    dwell_s: 20,
    layover_s: 300,
    points: v.points.map((p) => ({ name: p.name, kind: p.kind, lonlat: p.lonlat })),
    legs: v.legs.map((l) => ({ coords: l.coords, time_s: l.time_s })),
    departures: [7 * 3600],
    pull_out: null,
    pull_in: null,
    depot: null,
  } as RoadLine;
}

describe("simulated noise input", () => {
  it("covers the full clock hours inside both the run's period and its replay", () => {
    const r = replay();
    expect(coveredHours(r, { from_s: 7 * 3600, to_s: 9 * 3600 })).toEqual([7, 8]);
    expect(coveredHours(r, { from_s: 7 * 3600 + 60, to_s: 9 * 3600 })).toEqual([8]);
  });

  it("counts vehicles entering each leg by hour, in their direction, with their moving speed", () => {
    const c = countRunLine(runLine(), replay(), [7, 8]);
    expect(c.hourly[0]![7]).toBe(1);
    expect(c.hourly[1]![7]).toBe(1);
    expect(c.speed[0]).toBeCloseTo(30, 6);
    expect(c.speed[1]).toBeCloseTo(20, 6);
    // Hours not counted stay empty.
    expect(countRunLine(runLine(), replay(), [8]).hourly[0]![7]).toBe(0);
  });

  it("uses the run in the hours it covers and the timetable in the others", () => {
    const run = {
      scenario: { lines: [runLine()] } as never,
      replay: replay(),
      params: { from_s: 25200, to_s: 32400 },
    };
    const sim = simulatedStreetSources(run, doc().lines);
    expect(sim.hours).toEqual([7, 8]);
    const out = sim.lines[0]!;
    expect(out.id).toBe("run-0-leg-0");
    expect(out.hourly![7]).toBe(1);
    expect(out.hourly![8]).toBe(0);
    // 12:00 from the timetable: every 20 minutes.
    expect(out.hourly![12]).toBe(3);
    expect(out.speed_kmh).toBeCloseTo(30, 6);
    expect(out.electric).toBe(true);
    expect(out.vehicle_length_m).toBe(18);
    expect(sim.noTimetable).toEqual([]);
    expect(simulatedStreetSources(run, []).noTimetable).toEqual(["Route 7"]);
  });

  it("says where the flows came from", async () => {
    const run = {
      name: "Monday",
      scenario: { lines: [runLine()] } as never,
      replay: replay(),
      params: { from_s: 25200, to_s: 32400 },
    };
    const got = await designSources({ streetLines: doc(), railway: null }, "simulated", noRail, run);
    expect(got.lines).toHaveLength(2);
    expect(got.notes[0]).toContain("Monday");
    expect(got.notes[0]).toContain("07:00–09:00");
  });
});

describe("difference map", () => {
  it("shows the change where either scenario reaches the lowest band", () => {
    const d = differenceLevels(
      [60, 40, Number.NaN, 58, -Infinity, 56],
      [55, 45, 70, -Infinity, -Infinity, 56],
      50,
    );
    expect(d[0]).toBe(5);
    expect(Number.isNaN(d[1]!)).toBe(true);
    expect(Number.isNaN(d[2]!)).toBe(true);
    expect(d[3]).toBe(Infinity);
    expect(Number.isNaN(d[4]!)).toBe(true);
    expect(d[5]).toBe(0);
  });

  it("puts each change in its class and leaves small changes undrawn", () => {
    expect(DIFFERENCE.length).toBeGreaterThan(4);
    const at = (v: number) => DIFFERENCE[differenceClass(v)];
    expect(at(-Infinity)!.from_db).toBeNull();
    expect(at(0.5)!.color).toBeNull();
    expect(at(Infinity)!.from_db).toBe(10);
    expect(at(4)!.from_db).toBe(3);
    expect(differenceClass(Number.NaN)).toBe(-1);
    // Rows from the south become pixels from the north.
    const px = differencePixels([12, Number.NaN, 0, -12], 2, 2, 200);
    expect([...px.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(px[4 + 3]).toBe(200);
    expect(px[8 + 3]).toBe(200);
    expect(px[12 + 3]).toBe(0);
  });

  it("lines up both scenarios' exposure per band", () => {
    const e = (b: number[], p: number[] | null) =>
      ({
        count: 3,
        reached: 3,
        lden: { from_db: [55, 60], buildings: b, people: p ?? [0, 0] },
        lnight: { from_db: [50, 55], buildings: [0, 0], people: [0, 0] },
        people: p ? { source: "grid", total: 9, reached: 9, unplaced: 0 } : null,
      }) as never;
    expect(exposureRows(e([2, 1], [20, 5]), e([1, 0], [8, 0]), "lden")).toEqual([
      { from_db: 55, buildings: [2, 1], people: [20, 8] },
      { from_db: 60, buildings: [1, 0], people: [5, 0] },
    ]);
    expect(exposureRows(e([2, 1], null), e([1, 0], [8, 0]), "lden")[0]!.people).toBeNull();
  });
});

describe("noise map export", () => {
  it("traces a band with a hole and keeps cells touching at a corner apart", () => {
    // 4×4: a ring of class 1 round a centre of class 0, and a lone cell touching it diagonally is not possible
    // inside, so a second grid tests the corner.
    const ring = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1];
    const rings = traceRings(ring, 4, 4, 1);
    expect(rings).toHaveLength(2);
    const polys = classPolygons(
      ring,
      {
        width: 4,
        height: 4,
        corners: [
          [0, 4],
          [4, 4],
          [4, 0],
          [0, 0],
        ],
      },
      1,
    );
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(2);
    expect(polys[0]![0]).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ]);
    // Two cells touching at one corner: two polygons.
    const diag = [1, 0, 0, 1];
    expect(traceRings(diag, 2, 2, 1)).toHaveLength(2);
    expect(
      classPolygons(
        diag,
        {
          width: 2,
          height: 2,
          corners: [
            [0, 2],
            [2, 2],
            [2, 0],
            [0, 0],
          ],
        },
        1,
      ),
    ).toHaveLength(2);
  });

  it("writes contours as GeoJSON in longitude and latitude with their band", () => {
    const fc = contoursGeoJson(
      {
        values: [56, 61, 40, Number.NaN],
        width: 2,
        height: 2,
        corners: [
          [7, 50.002],
          [7.002, 50.002],
          [7.002, 50],
          [7, 50],
        ],
      },
      [
        { test: (v) => v >= 55 && v < 60, properties: { from_db: 55, to_db: 60 } },
        { test: (v) => v >= 60, properties: { from_db: 60, to_db: null } },
      ],
      { indicator: "L_den", scenario: "Tram" },
    );
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]!.properties).toEqual({
      indicator: "L_den",
      scenario: "Tram",
      from_db: 55,
      to_db: 60,
    });
    expect(fc.features[0]!.geometry.coordinates[0]![0]).toEqual([
      [7, 50],
      [7.001, 50],
      [7.001, 50.001],
      [7, 50.001],
      [7, 50],
    ]);
  });

  it("quotes CSV fields that need it", () => {
    expect(
      csv(
        ["a", "b"],
        [
          ["x, y", 'say "hi"'],
          [1, null],
        ],
      ),
    ).toBe('a,b\r\n"x, y","say ""hi"""\r\n1,\r\n');
  });

  it("samples the compared lines every 10 m for the shared grid", () => {
    const pts = coverPoints([
      {
        points: [
          [7, 50],
          [7.0014, 50],
        ],
      } as never,
    ]);
    expect(pts.length).toBe(12);
  });
});

const VIEW: NoiseView = {
  lden: { threshold_db: 55, typical_m: [10, 12, 14], max_m: 15, max_at: null, probes: 20 },
  lnight: { threshold_db: 50, typical_m: [4, 5, 6], max_m: 6, max_at: null, probes: 20 },
  checks: [],
  image: {
    width: 2,
    height: 1,
    cell_m: 10,
    coordinates: [
      [7, 50.0001],
      [7.0003, 50.0001],
      [7.0003, 50],
      [7, 50],
    ],
  },
  input_level: "timetabled",
  buildings: {
    count: 2,
    reached: 2,
    lden: { from_db: [55, 60, 65, 70, 75], buildings: [1, 1, 0, 0, 0], people: [12, 340, 0, 0, 0] },
    lnight: { from_db: [50, 55, 60, 65, 70], buildings: [2, 0, 0, 0, 0], people: [352, 0, 0, 0, 0] },
    people: null,
  },
  building_levels: [
    [58.2, 51],
    [61, 52.4],
  ],
};

describe("noise map panel: inputs, comparison and export", () => {
  function setup(extra: { scenarios?: ScenariosDoc; roadRuns?: RoadRunsApi } = {}) {
    let calls = 0;
    const estimate = vi.fn((input: NoiseInput) => {
      calls++;
      const v = { ...VIEW, input_level: input.input_level ?? "planned" };
      return calls % 2 === 1
        ? v
        : {
            ...v,
            buildings: { ...VIEW.buildings!, lden: { ...VIEW.buildings!.lden, buildings: [0, 1, 0, 0, 0] } },
          };
    });
    let n = 0;
    const engine: NoiseEngine = {
      estimate,
      image: vi.fn(() => new Uint8Array(8)),
      levels: vi.fn(() => {
        n++;
        // The first scenario is 6 dB louder in the west cell.
        return new Float32Array(n <= 2 ? [64, 50] : [58, 50]);
      }),
      dispose: vi.fn(),
    };
    const map = {
      getSource: vi.fn(() => undefined),
      addSource: vi.fn(),
      getLayer: vi.fn(() => undefined),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      setPaintProperty: vi.fn(),
    } as unknown as MapLibreMap;
    render(
      <NoiseMap
        map={map}
        streetLines={doc()}
        railway={null}
        runNoise={engineRunner(async () => engine)}
        loadRail={noRail}
        fetchTile={vi.fn(async () => [])}
        fetchTerrain={vi.fn(async (pts: [number, number][]) => pts.map(() => 100))}
        fetchPeople={vi.fn()}
        {...extra}
      />,
    );
    return { estimate };
  }

  it("computes from the timetable and says so", async () => {
    const { estimate } = setup();
    fireEvent.click(screen.getByLabelText("Timetabled: the trips of the day"));
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    const input = estimate.mock.calls[0]![0];
    expect(input.input_level).toBe("timetabled");
    expect(input.lines[0]!.hourly![7]).toBe(6);
    expect(input.grid_cover).toBeUndefined();
    expect(await screen.findByText("Current design · Timetabled: the trips of the day")).toBeTruthy();
  });

  it("compares two scenarios on one grid and shows the change", async () => {
    const scenarios = {
      scenarios: [
        {
          id: "s1",
          name: "Every 5 min",
          savedAt: "2026-11-16T10:00:00Z",
          railway: null,
          streetLines: doc("Route 7", 5),
        },
      ],
    };
    const { estimate } = setup({ scenarios });
    fireEvent.change(screen.getByLabelText("Scenario"), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText("Compare to"), { target: { value: "current" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(2));
    const [a, b] = estimate.mock.calls.map((c) => c[0]);
    expect(a!.grid_cover).toEqual(b!.grid_cover);
    expect(a!.origin).toEqual(b!.origin);
    expect(a!.grid_cover!.length).toBeGreaterThan(50);
    expect(a!.lines[0]!.flows.day).toBe(12);
    expect(b!.lines[0]!.flows.day).toBe(6);
    expect(
      await screen.findByText("Every 5 min compared to Current design · Planned: headways and sample flows"),
    ).toBeTruthy();
    const table = screen.getByRole("table", { name: "Change by noise band" });
    expect(table.textContent).toContain("Every 5 min");
    expect(table.textContent).toContain("+1");
    expect(screen.getByLabelText("Noise map legend").textContent).toContain("+5 to +10");
    expect(screen.getByRole("button", { name: "Export contours (GeoJSON)" })).toBeTruthy();
  });

  it("asks for a road run for the simulated input and loads its scenario and replay", async () => {
    const runs: RoadRunsApi = {
      list: vi.fn(async () => [
        {
          id: "r1",
          kind: "road",
          status: "done",
          network: { kind: "road", lines: [], depots: 0, tiles: 1 },
          params: { from_s: 25200, to_s: 32400 },
          error: null,
          cancelRequested: false,
          createdBy: null,
          createdAt: "2026-11-16T09:00:00Z",
          startedAt: null,
          finishedAt: "2026-11-16T09:10:00Z",
        } as RoadRun,
      ]),
      get: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
      rerun: vi.fn(),
      remove: vi.fn(),
      replay: vi.fn(async () => replay()),
      scenario: vi.fn(async () => ({ lines: [runLine()] }) as never),
    };
    const { estimate } = setup({ roadRuns: runs });
    fireEvent.click(screen.getByLabelText("Simulated: a saved road run"));
    const button = screen.getByRole("button", { name: "Compute noise map" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const picker = await screen.findByLabelText("Road run");
    await waitFor(() => expect(picker.querySelectorAll("option")).toHaveLength(2));
    fireEvent.change(picker, { target: { value: "r1" } });
    fireEvent.click(button);
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(runs.scenario).toHaveBeenCalledWith("r1");
    const input = estimate.mock.calls[0]![0];
    expect(input.input_level).toBe("simulated");
    expect(input.lines[0]!.id).toBe("run-0-leg-0");
    expect(await screen.findByText(/Buses from the road run of .* for 07:00–09:00/)).toBeTruthy();
  });
});

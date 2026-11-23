import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DepotEngine, SavedDepot } from "../src/features/depots/types";
import { projectRoadRuns, type RoadRunDetail, type RoadRunsApi } from "../src/features/road-sim/api";
import {
  replayGeoJson,
  replaySpan,
  serviceAt,
  vehiclesAt,
  vehicleState,
} from "../src/features/road-sim/replay";
import { DEFAULT_VEHICLE_VISUALS, vehicleVisualsFrom } from "../src/workspace/preferences";
import { RoadSimulation } from "../src/features/road-sim/RoadSimulation";
import { buildScenario, lineDepartures } from "../src/features/road-sim/scenario";
import type { Replay, RoadResult } from "../src/features/road-sim/types";
import { DEFAULT_TIMING } from "../src/features/street-lines/modes";
import type { SavedStreetLine } from "../src/features/street-lines/saved";
import type { LegView, LineView, PointView } from "../src/features/street-lines/types";

// The depot layout WebAssembly module is not needed: the tests pass their own engine.
vi.mock("../src/features/depots/engine", () => ({ loadDepotEngine: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const H = 3600;

/** A bus line B – C – D – A: the first point is a plain stop, so the circuit starts at C, the first end stop. */
function bus(over: Partial<SavedStreetLine> = {}, routed = true): SavedStreetLine {
  const kinds = ["stop", "end_stop", "stop", "end_stop"] as const;
  const names = ["B", "C", "D", "A"];
  const points: PointView[] = kinds.map((kind, i) => ({
    id: i + 10,
    seq: i,
    kind,
    name: names[i]!,
    lonlat: [8.5 + i * 0.01, 47.37],
    status: "ok",
    message: null,
    bearing_deg: null,
    bay: null,
  }));
  const legs: LegView[] = points.map((p, i) => ({
    index: i,
    from: p.id,
    to: points[(i + 1) % 4]!.id,
    coords: routed ? [p.lonlat, points[(i + 1) % 4]!.lonlat] : [],
    length_m: 800,
    time_s: 120 + i,
    direct_m: null,
    status: "ok",
    message: null,
    ways: [],
    crossing_wait_s: 0,
    level_crossings: [],
    traffic_delay_s: 0,
  }));
  const view: LineView = {
    points,
    legs,
    directions: [],
    station_groups: [],
    depot: null,
    depot_trips: [
      { kind: "pull_out", stop: 11, coords: [[8.49, 47.36], points[1]!.lonlat], length_m: 900, time_s: 150 },
    ] as unknown as LineView["depot_trips"],
    issues: [],
    length_m: 3200,
    time_s: 480,
    level_crossings: [],
    crossing_wait_s: 0,
    traffic_delay_s: 0,
  };
  return {
    name: "Bus 1",
    profile: {
      mode: "bus",
      height_m: 3.1,
      weight_t: 19,
      length_m: 12,
      max_speed_kmh: 80,
      battery_range_m: 0,
      doors_both_sides: false,
    },
    rules: {
      traffic_side: "left",
      detour_warn_m: 500,
      detour_warn_ratio: 0.25,
      grouping_distance_m: 150,
      max_snap_m: 150,
    },
    timing: { ...DEFAULT_TIMING, headwayMin: 10, dwellS: 25, layoverMin: 4 },
    points: points.map((p) => ({ lonlat: p.lonlat, kind: p.kind, name: p.name })),
    depot: null,
    depotStops: {},
    view,
    ...over,
  } as SavedStreetLine;
}

const DEPOT: SavedDepot = {
  id: "d1",
  name: "North",
  modes: ["bus"],
  boundary: [
    [8.48, 47.35],
    [8.49, 47.35],
    [8.49, 47.36],
  ],
  gates: [],
  zones: [],
  layout: {
    lanes: [
      {
        id: "L1",
        zone: "z1",
        kind: "parking",
        entry: [8.481, 47.355],
        exit: [8.482, 47.355],
        width_m: 3.5,
        aisle_in: null,
        aisle_out: null,
        slots: [
          {
            id: "L1-s1",
            center: [8.4815, 47.355],
            heading_deg: 90,
            length_m: 12,
            width_m: 3.5,
            charger: false,
          },
        ],
      },
    ],
    aisles: [],
  },
};

function fakeEngine() {
  const analyse = vi.fn(() => ({
    lanes: [],
    network: { nodes: [], edges: [] },
    reach: [],
    capacity: { assignments: [{ line: "street:0", vehicle: 0, lane: "L1", slot: "L1-s1", charger: false }] },
    issues: [],
  }));
  return { analyse } as unknown as Pick<DepotEngine, "analyse"> & { analyse: typeof analyse };
}

describe("road scenario", () => {
  it("starts the circuit at the first end stop and keeps the line's dwell and depot run", () => {
    const { scenario, skipped } = buildScenario({
      lines: [bus()],
      depots: [],
      setups: [],
      prefs: undefined,
      from: 7 * H,
      to: 9 * H,
      warmup: 1800,
      engine: null,
    });
    expect(skipped).toEqual([]);
    const l = scenario.lines[0]!;
    expect(l.points.map((p) => p.name)).toEqual(["C", "D", "A", "B"]);
    expect(l.legs.map((x) => x.time_s)).toEqual([121, 122, 123, 120]);
    expect(l.dwell_s).toBe(25);
    expect(l.layover_s).toBe(240);
    expect(l.pull_out).toMatchObject({ at: 0, time_s: 150 });
    expect(l.departures.every((d) => d >= 6.5 * H && d < 9 * H)).toBe(true);
    expect(l.departures.length).toBeGreaterThan(0);
    expect(scenario.driving_side).toBe("left");
    expect(scenario.traffic.off_peak_share).toBeGreaterThan(0);
  });

  it("leaves out lines that are not routed or have no service, and names lines without a depot", () => {
    const built = buildScenario({
      lines: [bus({}, false), bus({ name: "Night", timing: { ...DEFAULT_TIMING, headwayMin: 0 } }), bus()],
      depots: [],
      setups: [],
      prefs: undefined,
      from: 7 * H,
      to: 9 * H,
      warmup: 0,
      engine: null,
    });
    expect(built.skipped.map((s) => s.problem)).toEqual(["notRouted", "noService"]);
    expect(built.scenario.lines.map((l) => l.index)).toEqual([2]);
    expect(built.noDepot.map((n) => n.index)).toEqual([2]);
  });

  it("adds a laid-out depot its lines use, with the engine's slot for each vehicle", () => {
    const engine = fakeEngine();
    const { scenario, noDepot } = buildScenario({
      lines: [bus({ depotId: "d1" } as Partial<SavedStreetLine>)],
      depots: [DEPOT, { ...DEPOT, id: "d2", layout: null }],
      setups: [{ way: 42, cars_morning_peak: 900 } as never],
      prefs: undefined,
      from: 7 * H,
      to: 9 * H,
      warmup: 0,
      engine,
    });
    expect(noDepot).toEqual([]);
    expect(scenario.lines[0]!.depot).toBe("d1");
    expect(scenario.depots.map((d) => d.id)).toEqual(["d1"]);
    expect(scenario.depots[0]!.assignments[0]!.slot).toBe("L1-s1");
    expect(engine.analyse).toHaveBeenCalledTimes(1);
    expect(scenario.streets[0]).toMatchObject({ way: 42, cars_morning_peak: 900, cars_evening_peak: null });
  });

  it("gives no departures without a headway", () => {
    expect(lineDepartures(bus({ timing: { ...DEFAULT_TIMING, headwayMin: 0 } }), 0, 24 * H)).toEqual([]);
  });
});

const REPLAY: Replay = {
  version: 1,
  begin: 7 * H,
  frame_s: 10,
  frames: 4,
  lines: [{ index: 0, name: "Bus 1", color: "#123456", mode: "bus" }],
  vehicles: [
    {
      id: "L0v0",
      line: 0,
      number: 1,
      slot_out: [8.4, 47.3],
      slot_in: [8.41, 47.31],
      f0: 1,
      s: [850000, 4737000, 350, 30, 80, 850100, 4737000, 10, 40, 79],
    },
  ],
  events: [],
};

describe("road replay", () => {
  it("covers its frames", () => {
    expect(replaySpan(REPLAY)).toEqual([7 * H, 7 * H + 30]);
  });

  it("parks a vehicle at its slot before it leaves and after it is back", () => {
    expect(vehiclesAt(REPLAY, 7 * H)[0]).toMatchObject({ lonlat: [8.4, 47.3], parked: true });
    expect(vehiclesAt(REPLAY, 7 * H + 30)[0]).toMatchObject({ lonlat: [8.41, 47.31], parked: true });
  });

  it("interpolates between frames, the heading the short way round", () => {
    const v = vehiclesAt(REPLAY, 7 * H + 15)[0]!;
    expect(v.parked).toBe(false);
    expect(v.lonlat[0]).toBeCloseTo(8.5005, 6);
    expect(v.heading).toBeCloseTo(0, 6);
    expect(v.speed_kmh).toBeCloseTo(35, 6);
    expect(v.charge).toBe(80);
  });

  it("keeps the line's colour on the street in a replay without stop times, and greys parked vehicles", () => {
    const at = (t: number) => replayGeoJson(REPLAY, t, DEFAULT_VEHICLE_VISUALS).features[0]!.properties;
    expect(at(7 * H + 15)).toMatchObject({ color: "#123456", state: "line" });
    expect(at(7 * H)).toMatchObject({ color: DEFAULT_VEHICLE_VISUALS.colors.parked, state: "parked" });
  });
});

describe("vehicle punctuality", () => {
  // Planned departure, arrival, departure, kind: the first stop at 07:05, one along at 07:10, back at 07:20.
  const ST = [
    7 * H + 300,
    7 * H + 240,
    7 * H + 300,
    1,
    7 * H + 600,
    7 * H + 650,
    7 * H + 670,
    0,
    7 * H + 1200,
    7 * H + 1300,
    7 * H + 1320,
    2,
  ];
  const state = (t: number, visuals = DEFAULT_VEHICLE_VISUALS) =>
    vehicleState(
      {
        id: "v",
        line: 0,
        number: 1,
        lonlat: [0, 0],
        heading: 0,
        speed_kmh: 0,
        charge: null,
        parked: false,
        service: serviceAt(ST, t),
      },
      visuals,
    );

  it("is out of service until it reaches its first stop and after it leaves its last one", () => {
    expect(serviceAt(ST, 7 * H + 100)).toEqual({ in_service: false, delay_s: 0 });
    expect(state(7 * H + 100)).toBe("out_of_service");
    expect(state(7 * H + 240)).toBe("on_time");
    expect(state(7 * H + 1310)).not.toBe("out_of_service");
    expect(state(7 * H + 1320)).toBe("out_of_service");
    expect(serviceAt(undefined, 7 * H)).toBeNull();
  });

  it("is as late as its last departure, or the time since the next one was planned if that is more", () => {
    expect(serviceAt(ST, 7 * H + 500)!.delay_s).toBe(0);
    expect(serviceAt(ST, 7 * H + 660)!.delay_s).toBe(60);
    expect(serviceAt(ST, 7 * H + 700)!.delay_s).toBe(70);
    expect(serviceAt(ST, 7 * H + 1290)!.delay_s).toBe(90);
  });

  it("is green on time or early, yellow up to the late limit and red beyond, by the project's minutes", () => {
    expect(state(7 * H + 400)).toBe("on_time");
    expect(state(7 * H + 700)).toBe("late");
    const strict = vehicleVisualsFrom({ values: {}, visuals: { on_time_min: 0.5, late_min: 1 } });
    expect(state(7 * H + 620, strict)).toBe("on_time");
    expect(state(7 * H + 660, strict)).toBe("late");
    expect(state(7 * H + 700, strict)).toBe("very_late");
  });
});

describe("projectRoadRuns", () => {
  it("lists only road runs and asks for the replay of one", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/replay")
        ? new Response(JSON.stringify(REPLAY), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(
            JSON.stringify({
              runs: [
                { id: "a", kind: "capacity" },
                { id: "b", kind: "road" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
    );
    vi.stubGlobal("fetch", fetch);
    const api = projectRoadRuns("p1", "csrf");
    expect((await api.list()).map((r) => r.id)).toEqual(["b"]);
    expect((await api.replay("b")).frames).toBe(4);
    expect(String((fetch.mock.calls[1] as unknown[])[0])).toBe("/api/projects/p1/simulation-runs/b/replay");
  });
});

const RESULT: RoadResult = {
  notes: [],
  lines: [
    {
      index: 0,
      name: "Bus 1",
      mode: "bus",
      color: "#123456",
      problem: null,
      notes: [],
      trips: 12,
      trips_run: 11,
      planned_run_s: 1800,
      run_cycle_s: 1920,
      speed_kmh: 17.4,
      punctuality: 0.82,
      mean_delay_s: 70,
      p95_delay_s: 240,
      bunched_share: 0.1,
      lost_traffic_s: 95,
      lost_signals_s: 130,
      back_in_depot: 3,
      energy_use: null,
    },
  ],
  events: [{ kind: "gridlock", t: 7.5 * H, vehicle: "L0v2", line: 0, lonlat: null }],
  run: {
    begin: 6.5 * H,
    end: 9 * H,
    from_s: 7 * H,
    to_s: 9 * H,
    teleports: 0,
    collisions: 6,
    background_inserted: 1379,
    vehicles: 3,
    back_in_depot: 3,
    gridlocks: 1,
    wall_s: 30,
    speedup: 300,
    seed: 1,
    step_s: 0.5,
    complete: true,
  },
  network: { edges: 400, km: 52, signals: 18, warnings: 0 },
  traffic: { cars: 1379, target_car_km: 9000, sampled_car_km: 8800 },
} as unknown as RoadResult;

function run(over: Partial<RoadRunDetail> = {}): RoadRunDetail {
  return {
    id: "r1",
    kind: "road",
    status: "done",
    network: {
      kind: "road",
      lines: [{ index: 0, name: "Bus 1", mode: "bus", color: "#123456" }],
      depots: 0,
      tiles: 4,
    },
    params: { from_s: 7 * H, to_s: 9 * H, warmup_s: 1800, seed: 1 },
    error: null,
    cancelRequested: false,
    createdBy: { id: "u1", displayName: "Homlo" },
    createdAt: "2026-11-16T08:00:00Z",
    startedAt: null,
    finishedAt: null,
    progress: null,
    result: RESULT,
    ...over,
  } as RoadRunDetail;
}

function fakeApi(runs: RoadRunDetail[] = []): RoadRunsApi {
  return {
    list: vi.fn(async () => runs),
    get: vi.fn(async (id: string) => runs.find((r) => r.id === id) ?? run()),
    start: vi.fn(async () => run({ id: "new", status: "queued", result: null })),
    cancel: vi.fn(async () => run()),
    rerun: vi.fn(async () => run()),
    remove: vi.fn(async () => undefined),
    replay: vi.fn(async () => REPLAY),
    scenario: vi.fn(async () => {
      throw new Error("not used");
    }),
  } as never;
}

describe("RoadSimulation", () => {
  it("starts a run with the scenario of the project's lines and the chosen period", async () => {
    const api = fakeApi();
    render(
      <RoadSimulation
        api={api}
        canRun
        streetLines={[bus()]}
        loadEngine={async () => fakeEngine() as never}
      />,
    );
    expect(screen.getByText("Street lines: 1 · Depots: 0")).toBeTruthy();
    expect(
      screen.getByText("Bus 1 has no laid-out depot: its vehicles start and end on the street."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Midday/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run on the server and save" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    const [params, scenario] = vi.mocked(api.start).mock.calls[0]!;
    expect(params).toMatchObject({ from_s: 11 * H, to_s: 13 * H, warmup_s: 1800, seed: 1 });
    expect(scenario.lines).toHaveLength(1);
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("runs only the ticked lines", async () => {
    const api = fakeApi();
    render(
      <RoadSimulation
        api={api}
        canRun
        streetLines={[
          bus({ id: "a" }),
          bus({ id: "b", name: "Bus 2" }),
          bus({ id: "c", name: "Bus 3" }, false),
        ]}
        loadEngine={async () => fakeEngine() as never}
      />,
    );
    // Only the lines that can run are offered, all ticked.
    expect((screen.getByRole("checkbox", { name: "Bus 1" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Bus 2" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Bus 3" })).toBeNull();
    expect(screen.getByText("Street lines: 2 · Depots: 0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByText("Tick at least one street line to run.")).toBeTruthy();
    const run = screen.getByRole("button", { name: "Run on the server and save" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Bus 2" }));
    expect(screen.getByText("Street lines: 1 · Depots: 0")).toBeTruthy();
    expect(
      screen.queryByText("Bus 1 has no laid-out depot: its vehicles start and end on the street."),
    ).toBeNull();
    fireEvent.click(run);
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    const [, scenario] = vi.mocked(api.start).mock.calls[0]!;
    expect(scenario.lines.map((l) => [l.index, l.name])).toEqual([[1, "Bus 2"]]);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Street lines: 2 · Depots: 0")).toBeTruthy();
  });

  it("cannot run without a runnable line, and viewers cannot start one", () => {
    const { unmount } = render(<RoadSimulation api={fakeApi()} canRun streetLines={[bus({}, false)]} />);
    expect(
      (screen.getByRole("button", { name: "Run on the server and save" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Bus 1 is left out: it is not routed yet.")).toBeTruthy();
    unmount();
    render(<RoadSimulation api={fakeApi()} canRun={false} streetLines={[bus()]} />);
    expect(screen.queryByRole("button", { name: "Run on the server and save" })).toBeNull();
    expect(screen.getByText("Only Owners and Editors can start a road run.")).toBeTruthy();
  });

  it("shows a saved run's measures, events and the replay controls", async () => {
    const api = fakeApi([run()]);
    render(<RoadSimulation api={api} canRun streetLines={[bus()]} />);
    fireEvent.click(await screen.findByRole("button", { name: /07:00–09:00 · Bus 1/ }));
    expect(await screen.findByText("Back in the depot: 3 of 3")).toBeTruthy();
    expect(screen.getByText("Background cars: 1379")).toBeTruthy();
    expect(screen.getByText("Collisions: 6")).toBeTruthy();
    expect(screen.getByText("82 %")).toBeTruthy();
    expect(screen.getByText("Bus 1, vehicle 3: stuck for 5 minutes at 07:30")).toBeTruthy();
    // What to improve: the stuck vehicle first (a problem), then the line that keeps badly to time.
    const advice = within(screen.getByRole("region", { name: "What to improve" }));
    const items = advice.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("Bus 1: vehicles stuck for 5 minutes or more: 1");
    expect(items[1]).toContain("Bus 1: only 82 % of departures on time (advice below 85 %)");
    expect(items[1]).toContain("most of it at the traffic lights listed here");
    expect(items[1]).toContain("The circuit took 32 min against 30 min planned");
    expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();
    expect(api.replay).toHaveBeenCalledWith("r1");
    const slider = screen.getByRole("slider", { name: "Time" }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: String(7 * H + 20) } });
    expect(screen.getByText("07:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(slider.value).toBe(String(7 * H));
    expect(screen.getByText("On time (up to 1 min late)")).toBeTruthy();
    expect(screen.getByText("Parked in the depot")).toBeTruthy();
    expect(screen.getByText(/Run it again to see them by punctuality/)).toBeTruthy();
  });

  it("deletes a run after confirming", async () => {
    const api = fakeApi([run()]);
    render(<RoadSimulation api={api} canRun />);
    fireEvent.click(await screen.findByRole("button", { name: /07:00–09:00/ }));
    await screen.findByText("Back in the depot: 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(dialog.querySelector(".btn-danger")!);
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.queryByText("Back in the depot: 3 of 3")).toBeNull());
  });
});

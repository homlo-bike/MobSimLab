import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapacityRun } from "../src/features/capacity/CapacityRun";
import { hourShare, lineLoad, linkRiders, type LoadLine } from "../src/features/capacity/loads";
import { estimatedBoardings, lineBoardings } from "../src/features/capacity/ridership";
import {
  circuit,
  departures,
  runStreetLine,
  STREET_RUN_DEFAULTS,
  streetStops,
  triangular,
} from "../src/features/capacity/streetRun";
import type { Zone } from "../src/features/benefits/model";
import { DEFAULT_TIMING } from "../src/features/street-lines/modes";
import type { SavedStreetLine } from "../src/features/street-lines/saved";
import type { LegView, LineView, PointView } from "../src/features/street-lines/types";

afterEach(cleanup);

const H = 3600;

/** A bus line A – B – C and back by D: four legs of 5 min, 1 min of each in traffic. */
function bus(trafficS = 60, name = "Bus 1"): SavedStreetLine {
  const kinds = ["end_stop", "stop", "end_stop", "stop"] as const;
  const names = ["A", "B", "C", "D"];
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
    coords: [],
    length_m: 2000,
    time_s: 300,
    direct_m: null,
    status: "ok",
    message: null,
    ways: [],
    crossing_wait_s: 0,
    level_crossings: [],
    traffic_delay_s: trafficS,
  }));
  const view: LineView = {
    points,
    legs,
    directions: [
      { direction: 0, stops: [10, 11, 12], legs: [0, 1], length_m: 4000, time_s: 600 },
      { direction: 1, stops: [12, 13, 10], legs: [2, 3], length_m: 4000, time_s: 600 },
    ],
    station_groups: [],
    depot: null,
    depot_trips: [],
    issues: [],
    length_m: 8000,
    time_s: 1200,
    level_crossings: [],
    crossing_wait_s: 0,
    traffic_delay_s: 4 * trafficS,
  };
  return {
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
    rules: {
      traffic_side: "right",
      detour_warn_m: 500,
      detour_warn_ratio: 0.25,
      grouping_distance_m: 150,
      max_snap_m: 150,
    },
    timing: { ...DEFAULT_TIMING, headwayMin: 10, dwellS: 20, layoverMin: 5 },
    points: points.map((p) => ({ lonlat: p.lonlat, kind: p.kind, name: p.name })),
    depot: null,
    depotStops: {},
    view,
  };
}

const params = { ...STREET_RUN_DEFAULTS, from_s: 7 * H, to_s: 9 * H };

describe("street line run", () => {
  it("follows the circuit from the first end stop with dwell and layover", () => {
    const c = circuit(bus())!;
    expect(c.map((s) => s.name)).toEqual(["B", "C", "D", "A"]);
    expect(c[1]!.stop_s).toBe(20 + 300);
    expect(c[0]!.stop_s).toBe(20);
  });

  it("departs every headway, twice as often in the peak", () => {
    const d = departures(bus(), 6 * H, 8 * H);
    expect(d.filter((x) => x.at < 7 * H)).toHaveLength(6);
    expect(d.filter((x) => x.at >= 7 * H)).toHaveLength(12);
    expect(d.at(-1)!.headway).toBe(300);
  });

  it("keeps to time when the layovers absorb the traffic", () => {
    const r = runStreetLine(bus(), 0, params)!;
    // 4 × 300 s running, 4 × 20 s dwell, 2 × 5 min layover.
    expect(r.cycle_s).toBe(1200 + 80 + 600);
    expect(r.vehicles).toBe(Math.ceil(1880 / 300));
    expect(r.headway_s).toBe(300);
    expect(r.per_hour).toBe(12);
    expect(r.stable).toBe(true);
    expect(r.punctuality).toBeGreaterThan(0.9);
  });

  it("piles up delays when traffic takes more than the timetable allows", () => {
    // The timetable expects 10 s of traffic per leg; the trips meet up to 2× that on top of a bigger share.
    const heavy = bus(250);
    const r = runStreetLine(heavy, 0, { ...params, stability_runs: 4 })!;
    const calm = runStreetLine(bus(10), 0, { ...params, stability_runs: 4 })!;
    expect(r.mean_delay_s).toBeGreaterThan(calm.mean_delay_s);
    expect(r.punctuality).toBeLessThan(calm.punctuality);
  });

  it("is the same with the same seed", () => {
    expect(runStreetLine(bus(200), 0, params)).toEqual(runStreetLine(bus(200), 0, params));
  });

  it("draws traffic between the assumption's low and high ends", () => {
    expect(triangular(0, [0.4, 1, 2])).toBeCloseTo(0.4);
    expect(triangular(1, [0.4, 1, 2])).toBeCloseTo(2);
    expect(triangular(0.375, [0.4, 1, 2])).toBeCloseTo(1);
  });

  it("gives the stops by direction", () => {
    expect(streetStops(bus())).toEqual({
      sequences: [
        ["A", "B", "C"],
        ["C", "D", "A"],
      ],
      loop: false,
    });
  });
});

describe("passenger loads", () => {
  const line = (boardings: Record<string, number>, perHour = 10, capacity = 100): LoadLine => ({
    id: "M1",
    name: "M1",
    sequences: [
      ["A", "B", "C"],
      ["C", "B", "A"],
    ],
    loop: false,
    boardings,
    capacity,
    perHour: () => perHour,
  });

  it("gives a peak hour its share and spreads the rest of the day", () => {
    const s = { peakHour: 0.1, peakDirection: 0.6 };
    expect(hourShare(7 * H, s)).toBe(0.1);
    // 05:00–24:30 is 19.5 h, 5 of them peak: the rest share 50 %.
    expect(hourShare(12 * H, s)).toBeCloseTo(0.5 / 14.5);
    expect(hourShare(2 * H, s)).toBe(0);
  });

  it("splits riders by the boardings at the other stops", () => {
    const l = linkRiders(line({}), { A: 100, B: 0, C: 100 });
    // Everyone from A rides to C and back.
    expect(l).toEqual([
      [100, 100],
      [100, 100],
    ]);
  });

  it("finds the busiest link and who is left behind", () => {
    const r = lineLoad(line({ A: 20000, B: 0, C: 20000 }), 7 * H, 9 * H, {
      peakHour: 0.1,
      peakDirection: 0.6,
    });
    // 2000 an hour from each end; the busier direction carries 60 % of 4000.
    expect(r.busiest!.riders).toBeCloseTo(2400);
    expect(r.busiest!.places).toBe(1000);
    expect(r.busiest!.left_behind).toBeCloseTo(1400);
    expect(r.left_behind).toBeCloseTo(2800);
    expect(r.missing).toEqual(["B"]);
  });

  it("takes the planner's number over the estimate, shared among the lines there", () => {
    const b = lineBoardings(["A", "B"], { A: 500, B: 700 }, { b: 3000 }, (n) => (n === "B" ? 3 : 1));
    expect(b).toEqual({ A: 500, B: 1000 });
  });

  it("estimates boardings like the Tables tab", () => {
    const zone = { name: "A", lines: ["x", "y"], pop: 10000, jobs: 0, students: 0 } as unknown as Zone;
    // Bus: 8 % of residents, 2 trips each, the station shared by two lines.
    expect(estimatedBoardings([zone], "bus", ["A", "Z"], undefined, null)).toEqual({ A: 800 });
  });
});

describe("system test panel with street lines and loads", () => {
  it("runs the street lines and their passengers without a railway", async () => {
    const loadRidership = vi.fn(async () => ({
      zones: ["A", "B", "C", "D"].map(
        (name) => ({ name, lines: ["s"], pop: 20000, jobs: 0, students: 0 }) as unknown as Zone,
      ),
      notes: [],
    }));
    const onOwn = vi.fn();
    render(
      <CapacityRun
        streetLines={[bus()]}
        ridership={{ timetable: null, regions: [], prefs: undefined, doc: null, country: null }}
        loadRidership={loadRidership}
        onOwnBoardings={onOwn}
        ownBoardings={{ A: 1000 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
    const result = await screen.findByTestId("street-result");
    const card = within(result).getByRole("article", { name: /Bus 1/ });
    expect(within(card).getByText("Keeps to time")).toBeTruthy();
    await waitFor(() => expect(within(card).getByText("Passengers")).toBeTruthy());
    expect(within(card).getByText(/Busiest point/)).toBeTruthy();
    // The planner's own number for A is shown and can be changed.
    fireEvent.click(screen.getByText("Boardings per station or stop"));
    const a = screen.getByRole("spinbutton", { name: "A" }) as HTMLInputElement;
    expect(a.value).toBe("1000");
    fireEvent.change(a, { target: { value: "2500" } });
    expect(onOwn).toHaveBeenLastCalledWith({ A: 2500 });
    fireEvent.change(a, { target: { value: "" } });
    expect(onOwn).toHaveBeenLastCalledWith({});
    expect(screen.getAllByText("Estimate 3,200").length).toBe(4);
  });
});

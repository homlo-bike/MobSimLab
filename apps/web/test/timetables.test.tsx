import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import { TimetableTables } from "../src/features/timetables/TimetableTables";
import {
  DEFAULT_SERVICE_DAY,
  servicePeriods,
  type StreetLineInput,
} from "../src/features/journey-planner/network";
import type { LineView } from "../src/features/street-lines/types";
import {
  blockSummary,
  fleetRow,
  patternDepartures,
  railBlocks,
  streetBlocks,
  type VehicleBlock,
} from "../src/features/timetables/blocks";

const H = 3600;

afterEach(cleanup);

const pt = (id: number, kind: "stop" | "end_stop" | "via", lon: number) => ({
  id,
  seq: id - 1,
  kind,
  name: `S${id}`,
  lonlat: [lon, 50] as [number, number],
  status: "ok" as const,
  message: null,
  bearing_deg: null,
  bay: null,
});
const leg = (index: number, from: number, to: number, time_s: number) => ({
  index,
  from,
  to,
  coords: [],
  length_m: 100,
  time_s,
  direct_m: null,
  status: "ok" as const,
  message: null,
  ways: [],
  crossing_wait_s: 0,
  level_crossings: [],
});
const depotTrip = (kind: "pull_out" | "pull_in", stop: number) => ({
  kind,
  stop,
  coords: [
    [7, 50],
    [7.01, 50],
  ] as [number, number][],
  length_m: 2500,
  time_s: 300,
  crossing_wait_s: 0,
  status: "ok" as const,
  message: null,
});

/** Two end stops: out S1 → S3 → S4 (140 s with the dwell at S3), back S4 → S1 (100 s). */
function view(depot = false): LineView {
  return {
    points: [pt(1, "end_stop", 7), pt(2, "via", 7.001), pt(3, "stop", 7.002), pt(4, "end_stop", 7.003)],
    legs: [leg(0, 1, 2, 30), leg(1, 2, 3, 40), leg(2, 3, 4, 50), leg(3, 4, 1, 100)],
    directions: [
      { direction: 0, stops: [1, 3, 4], legs: [0, 1, 2], length_m: 3000, time_s: 120 },
      { direction: 1, stops: [4, 1], legs: [3], length_m: 2000, time_s: 100 },
    ],
    station_groups: [],
    depot: depot ? [7.01, 50] : null,
    depot_trips: depot ? [depotTrip("pull_out", 1), depotTrip("pull_in", 1)] : [],
    issues: [],
    length_m: 5000,
    time_s: 220,
    level_crossings: [],
    crossing_wait_s: 0,
  };
}

const line = (depot = false): StreetLineInput => ({
  name: "7",
  mode: "bus",
  color: "#d2392c",
  view: view(depot),
  dwellS: 20,
  headwayMin: 6,
  offPeakHeadwayMin: 12,
  firstMin: 5 * 60,
  lastMin: 23 * 60,
});

/** Every passenger trip of a line, both directions. */
function tripCount(l: StreetLineInput): number {
  const day = { ...DEFAULT_SERVICE_DAY, firstS: l.firstMin! * 60, lastS: l.lastMin! * 60 };
  return 2 * patternDepartures(servicePeriods(day, l.headwayMin * 60, l.offPeakHeadwayMin! * 60)).length;
}

function checkChaining(blocks: VehicleBlock[], layoverS: number) {
  for (const b of blocks) {
    const service = b.runs.filter((r) => r.kind === "service");
    for (let i = 1; i < service.length; i++) {
      const [a, c] = [service[i - 1]!, service[i]!];
      // A closed circuit: out, back, out, …, each after the layover at the stop it arrived at.
      expect(c.direction).toBe(1 - a.direction);
      expect(c.from).toBe(a.to);
      expect(c.departS).toBeGreaterThanOrEqual(a.arriveS + layoverS);
    }
    for (let i = 1; i < b.runs.length; i++)
      expect(b.runs[i]!.departS).toBeGreaterThanOrEqual(b.runs[i - 1]!.arriveS);
  }
}

describe("vehicle blocks", () => {
  it("expands departures like the journey planner", () => {
    expect(
      patternDepartures([{ start_time: 5 * H, end_time: 6 * H, headway_secs: 1200, kind: "off_peak" }]),
    ).toEqual([5 * H, 5 * H + 1200, 5 * H + 2400]);
    // An offset keeps departures on the clock face.
    expect(
      patternDepartures([
        { start_time: 5 * H, end_time: 5 * H + 1800, headway_secs: 600, offset_secs: 120, kind: "peak" },
      ]),
    ).toEqual([5 * H + 120, 5 * H + 720, 5 * H + 1320]);
  });

  it("chains a street line's trips round the circuit with the layover", () => {
    const l = line();
    const blocks = streetBlocks({ line: l, layoverMin: 5, hasDepot: false, maxWaitMin: 20 });
    const trips = blocks.flatMap((b) => b.runs.filter((r) => r.kind === "service").map((r) => r.trip));
    expect(trips).toHaveLength(tripCount(l));
    expect(new Set(trips).size).toBe(trips.length);
    // Trip ids are the journey planner's.
    expect(trips).toContain(`street-7-0@${5 * H}`);
    checkChaining(blocks, 300);
    // Both directions leave on the same clock minutes: 140 s out and 5 min layover miss the 6 min departure
    // back, so a round takes 24 min in the peak: 4 vehicles.
    expect(blocks).toHaveLength(4);
    expect(blocks.map((b) => b.n)).toEqual([1, 2, 3, 4]);
    expect(blocks.every((b) => b.runs.every((r) => r.kind === "service"))).toBe(true);
    const s = blockSummary(blocks[0]!);
    const out = blocks[0]!.runs.filter((r) => r.direction === 0).length;
    // 3 km out, 2 km back.
    expect(s.serviceKm).toBeCloseTo(out * 3 + (s.trips - out) * 2, 6);
  });

  it("sends vehicles to the depot between the peaks and pulls them out again", () => {
    const l = line(true);
    const blocks = streetBlocks({ line: l, layoverMin: 5, hasDepot: true, maxWaitMin: 20 });
    const trips = blocks.flatMap((b) => b.runs.filter((r) => r.kind === "service"));
    expect(trips).toHaveLength(tripCount(l));
    checkChaining(blocks, 300);
    // Pull-outs reach S1 and pull-ins leave it, at the depot run's time.
    for (const b of blocks)
      for (const r of b.runs) {
        if (r.kind === "pull_out") expect([r.from, r.to, r.arriveS - r.departS]).toEqual([null, "S1", 300]);
        if (r.kind === "pull_in") expect([r.from, r.to, r.arriveS - r.departS]).toEqual(["S1", null, 300]);
      }
    // Every block that can ends in the depot, and one comes back out after a pull-in (between the peaks).
    const reused = blocks.some((b) =>
      b.runs.some((r, i) => r.kind === "pull_in" && b.runs[i + 1]?.kind === "pull_out"),
    );
    expect(reused).toBe(true);
    expect(blocks.every((b) => b.runs.at(-1)!.kind === "pull_in" || b.runs.at(-1)!.to === "S4")).toBe(true);
    // A longer allowed wait keeps vehicles at the terminal instead.
    const patient = streetBlocks({ line: l, layoverMin: 5, hasDepot: true, maxWaitMin: 600 });
    const pulls = (bs: VehicleBlock[]) =>
      bs.flatMap((b) => b.runs).filter((r) => r.kind === "pull_in").length;
    expect(pulls(patient)).toBeLessThan(pulls(blocks));
  });

  it("sizes the fleet with the spare share and counts hours and kilometres", () => {
    const run = (kind: "service" | "pull_out" | "pull_in", dep: number, arr: number, km: number) => ({
      kind,
      trip: `${kind}@${dep}`,
      direction: 0,
      from: null,
      to: null,
      departS: dep,
      arriveS: arr,
      km,
    });
    const b: VehicleBlock = {
      n: 1,
      line: "7",
      mode: "bus",
      runs: [
        run("pull_out", 0, 600, 3),
        run("service", 600, 2400, 10),
        run("service", 3000, 4800, 10),
        run("pull_in", 4800, 5400, 3),
      ],
    };
    const blocks = Array.from({ length: 20 }, (_, i) => ({ ...b, n: i + 1 }));
    const f = fleetRow("7", "bus", blocks, 0.15);
    expect(f.fleet).toBe(23);
    expect(f.trips).toBe(40);
    // 1.5 h from pull-out to pull-in each.
    expect(f.vehicleHours).toBeCloseTo(30, 6);
    expect([f.serviceKm, f.emptyKm]).toEqual([400, 120]);
    expect(fleetRow("7", "bus", [], 0.15).fleet).toBe(0);
  });

  it("takes the rail planner's blocks of one line", () => {
    const r = (line: string, kind: "service" | "pull_out", dep: number) => ({
      kind,
      line,
      trip: `${line}-${dep}`,
      direction: 0,
      from: kind === "service" ? "A" : null,
      to: "B",
      depart_s: dep,
      arrive_s: dep + 600,
      km: 5,
    });
    const blocks = railBlocks(
      [
        { vehicle: 4, runs: [r("M1", "pull_out", 7 * H), r("M1", "service", 7 * H + 600)] },
        { vehicle: 2, runs: [r("M1", "service", 6 * H)] },
        { vehicle: 3, runs: [r("M2", "service", 6 * H)] },
      ],
      "M1",
      "M1",
      "metro",
    );
    expect(blocks.map((b) => [b.n, b.runs[0]!.departS])).toEqual([
      [1, 6 * H],
      [2, 7 * H],
    ]);
  });
});

describe("timetables in the Tables tab", () => {
  const doc = {
    lines: [
      {
        name: "7",
        profile: { mode: "bus" },
        timing: {
          headwayMin: 6,
          offPeakHeadwayMin: 12,
          dwellS: 20,
          layoverMin: 5,
          firstMin: 300,
          lastMin: 1380,
        },
        points: [],
        depot: [7.01, 50],
        depotStops: { out: 0, in: 0 },
        view: view(true),
      },
    ],
  } as unknown as StreetLinesDoc;

  it("lists the fleet and the blocks of each line, and saves the project's limits", () => {
    const onPreferences = vi.fn();
    render(
      <TimetableTables
        railway={null}
        streetLines={doc}
        preferences={{ values: {} }}
        onPreferences={onPreferences}
      />,
    );
    const section = screen.getByRole("region", { name: "Vehicle blocks, weekday" });
    const fleet = within(section).getAllByRole("table")[0]!;
    const row = within(fleet).getAllByRole("row")[1]!;
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    const blocks = streetBlocks({ line: line(true), layoverMin: 5, hasDepot: true, maxWaitMin: 20 });
    expect(cells[1]).toBe(String(blocks.length));
    // 15 % spares for buses, rounded up.
    expect(cells[2]).toBe("15%");
    expect(cells[3]).toBe(String(Math.ceil(blocks.length * 1.15 - 1e-9)));
    // A block opens to show its runs, from the depot back to the depot.
    fireEvent.click(within(section).getByRole("button", { name: "7/1" }));
    const runs = within(section).getByRole("table", { name: "Runs of block 7/1" });
    expect(within(runs).getAllByRole("row")[1]!.textContent).toContain("Pull-out");
    // The project's own limits are saved as preference values.
    const wait = within(section).getByRole("textbox", { name: /Longest wait at a terminal/ });
    fireEvent.change(wait, { target: { value: "30" } });
    fireEvent.blur(wait);
    expect(onPreferences).toHaveBeenLastCalledWith({ values: { "timetable.max_terminal_wait_min": 30 } });
    const spare = within(section).getByRole("textbox", { name: /Spare vehicles for Bus/ });
    fireEvent.change(spare, { target: { value: "20" } });
    fireEvent.blur(spare);
    expect(onPreferences).toHaveBeenLastCalledWith({ values: { "mode.spare_share.bus": 0.2 } });
  });

  it("says when there is nothing to schedule", () => {
    render(<TimetableTables railway={null} streetLines={null} preferences={null} />);
    expect(screen.getByText(/No lines yet/)).toBeTruthy();
  });
});

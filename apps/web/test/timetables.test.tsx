import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import { allDays, TimetableTables } from "../src/features/timetables/TimetableTables";
import { dayShares, feedHolidays, projectFeed } from "../src/features/timetables/feed";
import {
  directionGrids,
  printableTimetable,
  routeTrips,
  timetableCsv,
} from "../src/features/timetables/departures";
import {
  dayServiceOf,
  editDay,
  hasOwnDay,
  lineDay,
  railLineFor,
  shownDay,
  streetTimingFor,
  withDay,
} from "../src/features/timetables/dayTypes";
import {
  DEFAULT_SERVICE_DAY,
  prefixTimetable,
  servicePeriods,
  streetLineTimetable,
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

  it("keeps vehicles at the terminal when the depot's pull-out cannot be driven", () => {
    const l = line(true);
    const broken = {
      ...l,
      view: {
        ...l.view,
        depot_trips: l.view.depot_trips.map((t) =>
          t.kind === "pull_out" ? { ...t, status: "error" as const, coords: [] } : t,
        ),
      },
    };
    const without = streetBlocks({ line: l, layoverMin: 5, hasDepot: false, maxWaitMin: 20 });
    const blocks = streetBlocks({ line: broken, layoverMin: 5, hasDepot: true, maxWaitMin: 20 });
    expect(blocks).toHaveLength(without.length);
    expect(blocks.flatMap((b) => b.runs).some((r) => r.kind === "pull_in")).toBe(false);
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

describe("day types", () => {
  const weekday = { firstMin: 300, lastMin: 1410, peakHeadwayMin: 6, offPeakHeadwayMin: 12 };

  it("runs a line as on a weekday until a day type has its own service", () => {
    expect(dayServiceOf(weekday, undefined, "sunday")).toEqual(weekday);
    // Editing Sunday starts its own service from the weekday's.
    const e = editDay(weekday, undefined, "sunday", { peakHeadwayMin: 15 });
    expect(e.weekday).toEqual(weekday);
    expect(e.days).toEqual({ sunday: { ...weekday, peakHeadwayMin: 15 } });
    expect(hasOwnDay(e.days, "sunday")).toBe(true);
    expect(hasOwnDay(e.days, "saturday")).toBe(false);
    expect(dayServiceOf(weekday, e.days, "sunday").peakHeadwayMin).toBe(15);
    // Editing the weekday leaves Sunday's own service alone.
    const w = editDay(weekday, e.days, "weekday", { firstMin: 330 });
    expect(w.weekday.firstMin).toBe(330);
    expect(w.days).toBe(e.days);
    // Back to the weekday's service.
    expect(withDay(e.days, "sunday", null)).toBeUndefined();
    // A day still being typed (last before first) shows as typed but runs as on a weekday.
    const bad = { sunday: { ...weekday, lastMin: 200 } };
    expect(shownDay(weekday, bad, "sunday").lastMin).toBe(200);
    expect(dayServiceOf(weekday, bad, "sunday")).toEqual(weekday);
  });

  it("gives street and rail lines their day type's times", () => {
    const timing = {
      headwayMin: 6,
      offPeakHeadwayMin: 12,
      dwellS: 20,
      layoverMin: 5,
      firstMin: 300,
      lastMin: 1410,
      days: { sunday: { firstMin: 420, lastMin: 1320, peakHeadwayMin: 20, offPeakHeadwayMin: 30 } },
    };
    expect(streetTimingFor(timing, "sunday")).toMatchObject({
      firstMin: 420,
      headwayMin: 20,
      offPeakHeadwayMin: 30,
      dwellS: 20,
    });
    expect(streetTimingFor(timing, "saturday")).toMatchObject({ firstMin: 300, headwayMin: 6 });
    // Fewer trips and vehicles on a Sunday.
    const sunday = streetBlocks({
      line: { ...line(), headwayMin: 20, offPeakHeadwayMin: 30, firstMin: 420, lastMin: 1320 },
      layoverMin: 5,
      hasDepot: false,
      maxWaitMin: 20,
    });
    const week = streetBlocks({ line: line(), layoverMin: 5, hasDepot: false, maxWaitMin: 20 });
    expect(sunday.length).toBeLessThan(week.length);
    const rail = {
      id: "l1",
      name: "M1",
      color: "#000",
      stations: [1, 2],
      vehicle: "x",
      units: 1,
      first_min: 300,
      last_min: 1440,
      peak_headway_min: 4,
      offpeak_headway_min: 8,
      days: { holiday: { firstMin: 360, lastMin: 1380, peakHeadwayMin: 10, offPeakHeadwayMin: 10 } },
    };
    expect(railLineFor(rail, "holiday")).toMatchObject({
      first_min: 360,
      peak_headway_min: 10,
      last_min: 1380,
    });
    expect(railLineFor(rail, "weekday")).toMatchObject({ first_min: 300, peak_headway_min: 4 });
  });

  it("takes the day type's peaks from the calendar and the line's own hours", () => {
    const cal = {
      days: { saturday: { firstMin: 360, lastMin: 1380, peaks: [[600, 840]] as [number, number][] } },
    };
    expect(lineDay(cal, "saturday", weekday)).toEqual({
      firstS: 300 * 60,
      lastS: 1410 * 60,
      peaks: [[36000, 50400]],
    });
    // Without its own peaks a day type has the app's default ones.
    expect(lineDay({}, "sunday", weekday).peaks).toEqual(DEFAULT_SERVICE_DAY.peaks);
  });

  it("shows the blocks of the chosen day type in the Tables tab", () => {
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
            days: { sunday: { firstMin: 420, lastMin: 1320, peakHeadwayMin: 30, offPeakHeadwayMin: 30 } },
          },
          points: [],
          depot: null,
          depotStops: {},
          view: view(),
        },
      ],
    } as unknown as StreetLinesDoc;
    render(<TimetableTables railway={null} streetLines={doc} preferences={null} />);
    const trips = () =>
      Number(
        within(screen.getAllByRole("table")[0]!).getAllByRole("row")[1]!.querySelectorAll("td")[4]!
          .textContent,
      );
    const week = trips();
    fireEvent.change(screen.getByRole("combobox", { name: "Day type" }), { target: { value: "sunday" } });
    expect(screen.getByRole("region", { name: "Vehicle blocks, sunday" })).toBeTruthy();
    expect(trips()).toBeLessThan(week);
    // Saturday runs as on a weekday.
    fireEvent.change(screen.getByRole("combobox", { name: "Day type" }), { target: { value: "saturday" } });
    expect(trips()).toBe(week);
  });
});

describe("departure timetables and downloads", () => {
  const tt = () => streetLineTimetable(line(), undefined, "weekday")!;

  it("lists every trip at every stop and a grid per direction", () => {
    const trips = routeTrips(tt(), "street-7");
    expect(trips.length).toBe(tripCount(line()));
    const first = trips[0]!;
    expect(first.id).toBe(`street-7-0@${5 * H}`);
    // 70 s to S3, 20 s there, 50 s on to S4.
    expect(first.stops.map((s) => [s.name, s.arriveS - 5 * H, s.departS - 5 * H])).toEqual([
      ["S1", 0, 0],
      ["S3", 70, 90],
      ["S4", 140, 160],
    ]);
    const grids = directionGrids(trips);
    expect(grids.map((g) => g.stops.map((s) => s.name))).toEqual([
      ["S1", "S3", "S4"],
      ["S4", "S1"],
    ]);
    // The last stop shows the arrival.
    expect(grids[0]!.trips[0]!.times).toEqual([5 * H, 5 * H + 90, 5 * H + 140]);
  });

  it("writes every stop time with its block as CSV and a page per line and day type", () => {
    const trips = routeTrips(tt(), "street-7");
    const blocks = streetBlocks({ line: line(), layoverMin: 5, hasDepot: false, maxWaitMin: 20 });
    const csv = timetableCsv([{ line: '7, "night"', mode: "bus", day: "sunday", trips, blocks }]);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("line,mode,day_type,direction,trip_id,block,stop_sequence,stop,arrival,departure");
    expect(rows[1]).toBe(
      `"7, ""night""",bus,sunday,0,street-7-0@${5 * H},"7, ""night""/1",1,S1,05:00:00,05:00:00`,
    );
    expect(rows).toHaveLength(1 + trips.reduce((n, t) => n + t.stops.length, 0));
    const html = printableTimetable(
      [
        { line: "7", mode: "bus", day: "weekday", trips, blocks },
        { line: "7", mode: "bus", day: "sunday", trips: [], blocks: [] },
      ],
      { weekday: "Weekday", saturday: "Saturday", sunday: "Sunday", holiday: "Public holiday" },
      "Study <1>",
    );
    expect(html.match(/<article>/g)).toHaveLength(1);
    expect(html).toContain("<title>Study &lt;1&gt;</title>");
    expect(html).toContain("S1 → S4");
    // Departures by hour: 05 every 12 min off peak, minutes from the first stop.
    expect(html).toContain("<tr><th>05</th><td>00 12 24 36 48</td></tr>");
    expect(html).toContain('<tr><td>S3</td><td class="n">2</td></tr>');
  });

  it("puts every day type in one GTFS timetable with its service id", () => {
    const lines = (["weekday", "saturday", "sunday", "holiday"] as const).map((d) => [
      d,
      [
        {
          key: "street:0",
          name: "7",
          color: "#000",
          mode: "bus",
          units: 1,
          trips: [],
          blocks: [],
          timetable: prefixTimetable(streetLineTimetable(line(), undefined, d)!, "s0:"),
        },
      ],
    ]);
    const all = allDays(Object.fromEntries(lines), {})!;
    expect(new Set(all.frequency_patterns.map((p) => p.service_id))).toEqual(
      new Set(["weekday", "saturday", "sunday", "holiday"]),
    );
    expect(new Set(all.frequency_patterns.map((p) => p.pattern_id)).size).toBe(8);
    expect(all.frequency_patterns.map((p) => p.pattern_id)).toContain("s0:street-7-0~sunday");
    expect(all.stops).toHaveLength(3);
    expect(all.routes).toHaveLength(1);
  });

  it("builds the project's lines of every day type for the journey planner's GTFS download", async () => {
    const street = {
      name: "7",
      profile: { mode: "bus" },
      timing: {
        headwayMin: 6,
        offPeakHeadwayMin: 12,
        dwellS: 20,
        layoverMin: 5,
        firstMin: 300,
        lastMin: 1380,
        days: { sunday: { firstMin: 420, lastMin: 1320, peakHeadwayMin: 30, offPeakHeadwayMin: 30 } },
      },
      points: [],
      depot: null,
      depotStops: {},
      view: view(),
    } as unknown as StreetLinesDoc["lines"][number];
    const ferry = {
      id: "ferry",
      name: "F1",
      mode: "ferry",
      color: "#0af",
      stops: [
        { name: "Pier", lonlat: [7, 50] as [number, number] },
        { name: "Island", lonlat: [7.02, 50] as [number, number] },
      ],
      directions: [
        [
          { stop: 0, run_s: 0, dwell_s: 0 },
          { stop: 1, run_s: 600, dwell_s: 0 },
        ],
      ],
      headwayS: 1800,
    };
    const loadRail = vi.fn();
    const all = (await projectFeed({
      railway: null,
      streetLines: [street],
      pluginLines: [ferry],
      cal: {},
      loadRail,
    }))!;
    // No railway, no rail engine.
    expect(loadRail).not.toHaveBeenCalled();
    const ofDay = (d: string, route: string) =>
      all.frequency_patterns.filter((p) => p.service_id === d && p.route_id === route);
    for (const d of ["weekday", "saturday", "sunday", "holiday"]) {
      expect(ofDay(d, "s0:street-7")).toHaveLength(2);
      expect(ofDay(d, "plugin:ferry")).toHaveLength(1);
    }
    // Sunday runs the line's own times: its first departure at 07:00, Saturday as on a weekday at 05:00.
    const first = (d: string) =>
      Math.min(...ofDay(d, "s0:street-7").flatMap((p) => p.periods.map((x) => x.start_time)));
    expect(first("sunday")).toBe(7 * H);
    expect(first("saturday")).toBe(first("weekday"));
    expect(all.frequency_patterns.map((p) => p.pattern_id)).toContain("s0:street-7-0~sunday");
    expect(all.stops.filter((x) => x.stop_id.startsWith("plugin:ferry"))).toHaveLength(2);
  });

  it("lists the calendar's public holidays of every year the feed covers", () => {
    const cal = { added: [{ date: "2026-12-25" }, { date: "2027-01-01" }] } as never;
    const h = feedHolidays(cal, new Date("2026-11-16"), new Date("2027-11-16"));
    expect(h).toContain("20261225");
    expect(h).toContain("20270101");
  });

  it("compares each line's trips on every day type with its weekday", () => {
    const street = {
      name: "7",
      profile: { mode: "bus" },
      timing: {
        headwayMin: 10,
        offPeakHeadwayMin: 10,
        dwellS: 20,
        layoverMin: 5,
        firstMin: 360,
        lastMin: 1320,
        days: { sunday: { firstMin: 360, lastMin: 1320, peakHeadwayMin: 20, offPeakHeadwayMin: 20 } },
      },
      points: [],
      depot: null,
      depotStops: {},
      view: view(),
    } as unknown as StreetLinesDoc["lines"][number];
    const railway = { lines: [{ id: "M1" }] } as never;
    const report = (trips: number) => ({ lines: [{ id: "M1", trips }] }) as never;
    const s = dayShares(railway, [street], {}, { weekday: report(200), saturday: report(150) });
    expect(s["rail:M1"]).toEqual({ weekday: 1, saturday: 0.75, sunday: 0, holiday: 0 });
    expect(s["street:0"]!.saturday).toBe(1);
    expect(s["street:0"]!.sunday).toBeCloseTo(0.5, 1);
  });
});

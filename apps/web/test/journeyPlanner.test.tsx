import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("maplibre-gl", () => ({
  Marker: class {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    on() {
      return this;
    }
    getLngLat() {
      return { lng: 0, lat: 0 };
    }
    remove() {}
  },
}));
vi.mock("../src/features/journey-planner/mapLayers", () => ({
  ensureLayers: vi.fn(),
  removeLayers: vi.fn(),
  drawNetwork: vi.fn(),
  drawJourney: vi.fn(),
}));

import { clock, duration, parseClock } from "../src/features/journey-planner/format";
import { JourneyPlanner } from "../src/features/journey-planner/JourneyPlanner";
import {
  DEFAULT_SERVICE_DAY,
  exampleNetwork,
  parseRailTimetable,
  servicePeriods,
  streetLineTimetable,
} from "../src/features/journey-planner/network";
import type { Journey, PlannerEngine, PlannerLoader, Timetable } from "../src/features/journey-planner/types";
import type { LineView } from "../src/features/street-lines/types";

const H = 3600;

describe("journey planner helpers", () => {
  it("formats and parses clock times and durations", () => {
    expect(clock(8 * H + 5 * 60)).toBe("08:05");
    expect(clock(24 * H + 15 * 60)).toBe("00:15");
    expect(parseClock("7:30")).toBe(7 * H + 30 * 60);
    expect(parseClock("25:00")).toBeNull();
    expect(duration(40)).toBe("40 s");
    expect(duration(12 * 60)).toBe("12 min");
    expect(duration(65 * 60)).toBe("1 h 05 min");
  });

  it("splits the service day into off-peak, peak and no service", () => {
    const p = servicePeriods(DEFAULT_SERVICE_DAY, 300, 600);
    expect(p.map((x) => [x.kind, x.start_time / H])).toEqual([
      ["off_peak", 5],
      ["peak", 7],
      ["off_peak", 9],
      ["peak", 16],
      ["off_peak", 19],
    ]);
    expect(p[1]!.headway_secs).toBe(300);
    expect(p[4]!.end_time).toBe(24.5 * H + 1);
  });

  it("builds the example city with both directions and a timed connection", () => {
    const tt = exampleNetwork([10, 50]);
    expect(tt.routes.map((r) => r.route_id)).toEqual(["M1", "T2", "3", "R5"]);
    expect(tt.frequency_patterns).toHaveLength(8);
    expect(new Set(tt.stops.map((s) => s.stop_id)).size).toBe(tt.stops.length);
    expect(tt.transfers.some((t) => t.transfer_type === 1)).toBe(true);
    const central = tt.stops.filter((s) => s.parent_station === "central");
    expect(central.map((s) => s.platform_code).sort()).toEqual(["3", "M", "T"]);
  });

  it("turns a street line into one pattern per direction", () => {
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
    const view: LineView = {
      points: [pt(1, "end_stop", 7), pt(2, "via", 7.001), pt(3, "stop", 7.002), pt(4, "end_stop", 7.003)],
      legs: [leg(0, 1, 2, 30), leg(1, 2, 3, 40), leg(2, 3, 4, 50), leg(3, 4, 1, 100)],
      directions: [
        { direction: 0, stops: [1, 3, 4], legs: [0, 1, 2], length_m: 300, time_s: 120 },
        { direction: 1, stops: [4, 1], legs: [3], length_m: 100, time_s: 100 },
      ],
      station_groups: [],
      depot: null,
      depot_trips: [],
      issues: [],
      length_m: 400,
      time_s: 220,
      level_crossings: [],
      crossing_wait_s: 0,
    };
    const tt = streetLineTimetable({
      name: "7",
      mode: "bus",
      color: "#d2392c",
      view,
      dwellS: 20,
      headwayMin: 12,
    })!;
    expect(tt.stops).toHaveLength(3);
    const [d0, d1] = tt.frequency_patterns;
    expect(d0!.stops.map((s) => [s.stop_id, s.run_time])).toEqual([
      ["street-7:1", 0],
      ["street-7:3", 70],
      ["street-7:4", 50],
    ]);
    expect(d1!.stops.map((s) => s.run_time)).toEqual([0, 100]);
    expect(d0!.periods.find((p) => p.kind === "peak")!.headway_secs).toBe(360);
    expect(tt.routes[0]!.route_color).toBe("d2392c");
  });
});

function journey(time_s: number): Journey {
  const b = {
    walk_s: 300,
    wait_s: 120,
    in_vehicle_s: 600,
    transfer_walk_s: 60,
    transfer_wait_s: 180,
    early_arrival_s: 0,
  };
  const total = 1260;
  const place = (name: string) => ({ name, lon: 10, lat: 50 });
  return {
    query_s: time_s,
    depart_s: time_s,
    leave_s: time_s + 120,
    arrive_s: time_s + total,
    total_s: total,
    door_to_door_s: total - 120,
    rides: 2,
    transfers: 1,
    walk_m: 500,
    breakdown: b,
    legs: [
      {
        type: "walk",
        kind: "access",
        from: place("A"),
        to: place("Market"),
        start_s: time_s,
        end_s: time_s + 150,
        distance_m: 250,
      },
      { type: "wait", kind: "initial", at: place("Market"), start_s: time_s + 150, end_s: time_s + 270 },
      {
        type: "ride",
        route_id: "M1",
        route_short_name: "M1",
        mode: "metro",
        route_color: "1d4ed8",
        trip_id: "m1",
        from: place("Market"),
        to: place("Central"),
        start_s: time_s + 270,
        end_s: time_s + 570,
        intermediate_stops: 0,
        guaranteed: false,
      },
      {
        type: "walk",
        kind: "transfer",
        from: place("Central"),
        to: { ...place("Central"), platform_code: "T" },
        start_s: time_s + 570,
        end_s: time_s + 630,
        distance_m: 52,
      },
      { type: "wait", kind: "transfer", at: place("Central"), start_s: time_s + 630, end_s: time_s + 810 },
      {
        type: "ride",
        route_id: "T2",
        route_short_name: "T2",
        mode: "tram",
        trip_id: "t2",
        from: place("Central"),
        to: place("Hilltop"),
        start_s: time_s + 810,
        end_s: time_s + 1110,
        intermediate_stops: 2,
        guaranteed: true,
      },
      {
        type: "walk",
        kind: "egress",
        from: place("Hilltop"),
        to: place("B"),
        start_s: time_s + 1110,
        end_s: time_s + 1260,
        distance_m: 250,
      },
    ],
  };
}

function fakeLoader() {
  const calls: { timetable: Timetable }[] = [];
  const plan = vi.fn((q: { time_s: number }) => ({ query: q, journeys: [journey(q.time_s)] }));
  const loader: PlannerLoader = async (timetable) => {
    calls.push({ timetable });
    const e: PlannerEngine = {
      summary: () => ({
        stops: timetable.stops.length,
        routes: timetable.routes.length,
        trips: 100,
        raptor_routes: 8,
        footpaths: 10,
        first_departure_s: 5 * H,
        last_arrival_s: 25 * H,
        warnings: [],
      }),
      plan: plan as unknown as PlannerEngine["plan"],
      profile: (q) =>
        Array.from({ length: (q.end_s - q.start_s) / q.step_s + 1 }, (_, i) => ({
          time_s: q.start_s + i * q.step_s,
          journey: journey(q.start_s + i * q.step_s),
        })),
      dispose: () => {},
    };
    return e;
  };
  return { loader, calls, plan };
}

const RAIL_JSON = JSON.stringify({
  stops: [
    {
      stop_id: "p1.0.l",
      stop_name: "Central",
      stop_lat: 50.0,
      stop_lon: 10.0,
      parent_station: "group:central",
    },
    {
      stop_id: "p2.0.l",
      stop_name: "Airport",
      stop_lat: 50.05,
      stop_lon: 10.1,
      parent_station: "group:airport",
    },
  ],
  routes: [{ route_id: "S1", route_short_name: "S1", mode: "regional_rail" }],
  trips: [
    {
      trip_id: "S1-0-000",
      route_id: "S1",
      stop_times: [
        { stop_id: "p1.0.l", stop_sequence: 1, arrival_time: 21600, departure_time: 21600, drop_off_type: 1 },
        { stop_id: "p2.0.l", stop_sequence: 2, arrival_time: 22200, departure_time: 22200, pickup_type: 1 },
      ],
    },
  ],
});

describe("rail timetables", () => {
  it("reads a published rail timetable and keeps its ids apart from street lines", () => {
    const r = parseRailTimetable(RAIL_JSON);
    if ("error" in r) throw new Error(r.error);
    const tt = r.timetable;
    expect(tt.stops.map((s) => s.stop_id)).toEqual(["rail:p1.0.l", "rail:p2.0.l"]);
    expect(tt.stops[0]!.parent_station).toBe("rail:group:central");
    expect(tt.stops[0]!.stop_name).toBe("Central");
    expect(tt.routes[0]!.route_id).toBe("rail:S1");
    expect(tt.routes[0]!.route_short_name).toBe("S1");
    expect(tt.trips[0]!.route_id).toBe("rail:S1");
    expect(tt.trips[0]!.stop_times.map((s) => s.stop_id)).toEqual(["rail:p1.0.l", "rail:p2.0.l"]);
  });

  it("rejects files that are not timetables", () => {
    expect(parseRailTimetable("nope")).toEqual({ error: "The file is not JSON." });
    expect(parseRailTimetable("[]")).toEqual({ error: "The file is not a published timetable." });
    expect(parseRailTimetable(JSON.stringify({ stops: [] }))).toEqual({
      error: "The timetable has no stops or no trips.",
    });
  });
});

describe("JourneyPlanner panel", () => {
  it("places the example city, plans A to B and shows the time split and the day profile", async () => {
    const { loader, calls, plan } = fakeLoader();
    render(<JourneyPlanner map={null} loadPlanner={loader} />);
    expect(screen.getByText(/No timetable yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place example network here" }));
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("21 min"));
    expect(calls[0]!.timetable.routes).toHaveLength(4);
    expect(screen.getByTestId("network-summary").textContent).toContain("4 lines");
    expect(
      screen.getByText("Leave at 08:02 and you won't wait at the stop: 19 min door to door."),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Itinerary" }).textContent).toContain(
      "Change to platform T · 1 min walk, 3 min wait",
    );
    expect(screen.getByText("(timed connection)")).toBeTruthy();
    expect(screen.getByText("On board")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^A: Near / })).toBeTruthy();

    // Arrive-by asks the engine with that mode.
    fireEvent.click(screen.getByRole("radio", { name: "Arrive by" }));
    await waitFor(() =>
      expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "arrive_by", time_s: 8 * H })),
    );

    // Clicking a bar of the profile asks that time.
    fireEvent.click(screen.getByTestId(`profile-bar-${10 * H}`));
    expect((screen.getByLabelText("Time of day") as HTMLInputElement).value).toBe("10:00");
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getAllByRole("row").length).toBeGreaterThan(100);
  });

  it("adds a rail timetable file to the network the planner routes on", async () => {
    const { loader, calls } = fakeLoader();
    render(<JourneyPlanner map={null} loadPlanner={loader} />);
    const input = screen.getByLabelText("Rail timetable file");
    fireEvent.change(input, {
      target: { files: [new File([RAIL_JSON], "rail-timetable.json", { type: "application/json" })] },
    });
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.timetable.trips.map((t) => t.trip_id)).toEqual(["rail:S1-0-000"]);
    expect(screen.getByTestId("rail-timetable").textContent).toContain("S1 · 1 trips");

    // With the example city too, both are routed on together.
    fireEvent.click(screen.getByRole("button", { name: "Place example network here" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]!.timetable.routes.map((r) => r.route_id)).toEqual(["M1", "T2", "3", "R5", "rail:S1"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove rail timetable" }));
    await waitFor(() => expect(calls.length).toBe(3));
    expect(calls[2]!.timetable.routes).toHaveLength(4);
  });

  it("says why a rail timetable file was not added", async () => {
    const { loader } = fakeLoader();
    render(<JourneyPlanner map={null} loadPlanner={loader} />);
    fireEvent.change(screen.getByLabelText("Rail timetable file"), {
      target: { files: [new File(["{}"], "empty.json")] },
    });
    await waitFor(() =>
      expect(screen.getByText("empty.json: The timetable has no stops or no trips.")).toBeTruthy(),
    );
  });
});

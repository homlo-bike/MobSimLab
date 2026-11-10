import { describe, expect, it } from "vitest";
import { inWindow, timeDistance, windowRange } from "../src/features/railways/timeDistance";
import type { ServicePublication } from "../src/features/railways/types";

const st = (stop_id: string, seq: number, arr: number, dep = arr) => ({
  stop_id,
  stop_sequence: seq,
  arrival_time: arr,
  departure_time: dep,
});

/** Line A runs North (0 km) – Mid (2 km) – South (5 km); line B shares Mid and South only. */
function publication(): ServicePublication {
  return {
    timetable: {
      stops: [
        { stop_id: "n1", stop_name: "North", stop_lat: 0, stop_lon: 0, parent_station: "group:n" },
        { stop_id: "m1", stop_name: "Mid", stop_lat: 0, stop_lon: 0, parent_station: "group:m" },
        { stop_id: "m2", stop_name: "Mid", stop_lat: 0, stop_lon: 0, parent_station: "group:m" },
        { stop_id: "s1", stop_name: "South", stop_lat: 0, stop_lon: 0, parent_station: "group:s" },
        { stop_id: "x1", stop_name: "East", stop_lat: 0, stop_lon: 0, parent_station: "group:x" },
      ],
      routes: [
        { route_id: "A", route_short_name: "A", mode: "metro", route_color: "1d4ed8" },
        { route_id: "B", route_short_name: "B", mode: "metro", route_color: "b91c1c" },
      ],
      trips: [
        {
          trip_id: "A-0-001",
          route_id: "A",
          direction_id: 0,
          stop_times: [st("n1", 1, 25200), st("m1", 2, 25320, 25350), st("s1", 3, 25500)],
        },
        {
          trip_id: "A-1-001",
          route_id: "A",
          direction_id: 1,
          stop_times: [st("s1", 1, 26000), st("m2", 2, 26150, 26180), st("n1", 3, 26300)],
        },
        {
          trip_id: "A-0-002",
          route_id: "A",
          direction_id: 0,
          stop_times: [st("n1", 1, 50000), st("s1", 2, 50300)],
        },
        // B: East → Mid → South: only Mid–South is on line A's stations.
        {
          trip_id: "B-0-001",
          route_id: "B",
          direction_id: 0,
          stop_times: [st("x1", 1, 25000), st("m1", 2, 25400), st("s1", 3, 25600)],
        },
        // B calling at one of A's stations only is not drawn.
        {
          trip_id: "B-0-002",
          route_id: "B",
          direction_id: 0,
          stop_times: [st("x1", 1, 27000), st("m1", 2, 27400)],
        },
      ],
      transfers: [],
      frequency_patterns: [],
    },
    lines: [
      {
        id: "A",
        trips: 3,
        outbound_s: 300,
        return_s: 300,
        trains: 1,
        issues: [],
        stations: [
          { station_id: "group:n", name: "North", km: 0 },
          { station_id: "group:m", name: "Mid", km: 2 },
          { station_id: "group:s", name: "South", km: 5 },
        ],
        shifted: [{ trip: "A-1-001", by_s: 120 }],
        unplaced: [{ trip: "A-0-003", reason: "no conflict-free slot within 600 s", blocked_by: "B-0-009" }],
      },
    ],
    notes: [],
  };
}

describe("time-distance graph", () => {
  it("places each call at its station's distance, arrival and departure", () => {
    const g = timeDistance(publication(), "A")!;
    expect(g.stations.map((s) => s.name)).toEqual(["North", "Mid", "South"]);
    const out = g.trains.find((t) => t.trip === "A-0-001")!;
    expect(out.own).toBe(true);
    expect(out.color).toBe("#1d4ed8");
    expect(out.segments).toEqual([
      [
        [25200, 0],
        [25320, 2],
        [25350, 2],
        [25500, 5],
      ],
    ]);
    // The return uses the other Mid platform: the same station, the same distance.
    const back = g.trains.find((t) => t.trip === "A-1-001")!;
    expect(back.direction).toBe(1);
    expect(back.segments[0]!.map((p) => p[1])).toEqual([5, 2, 2, 0]);
  });

  it("draws other lines only between two of the line's stations", () => {
    const g = timeDistance(publication(), "A")!;
    const b = g.trains.filter((t) => !t.own);
    expect(b.map((t) => t.trip)).toEqual(["B-0-001"]);
    expect(b[0]!.segments).toEqual([
      [
        [25400, 2],
        [25600, 5],
      ],
    ]);
  });

  it("marks and lists the planner's conflicts", () => {
    const g = timeDistance(publication(), "A")!;
    expect(g.trains.find((t) => t.trip === "A-1-001")!.shifted_s).toBe(120);
    expect(g.trains.find((t) => t.trip === "A-0-001")!.shifted_s).toBe(0);
    expect(g.shifted).toEqual([{ trip: "A-1-001", by_s: 120, depart_s: 26000 }]);
    expect(g.unplaced[0]!.blocked_by).toBe("B-0-009");
  });

  it("picks the time window", () => {
    const g = timeDistance(publication(), "A")!;
    expect(windowRange(g, "morning")).toEqual([6.5 * 3600, 9.5 * 3600]);
    // The whole day: whole hours round the line's own trains.
    expect(windowRange(g, "day")).toEqual([7 * 3600, 14 * 3600]);
    const late = g.trains.find((t) => t.trip === "A-0-002")!;
    expect(inWindow(late, 6.5 * 3600, 9.5 * 3600)).toBe(false);
    expect(inWindow(late, 13 * 3600, 14 * 3600)).toBe(true);
  });

  it("gives nothing for an unknown line or one without distances", () => {
    expect(timeDistance(publication(), "Z")).toBeNull();
    const p = publication();
    p.lines[0]!.stations = [];
    expect(timeDistance(p, "A")).toBeNull();
  });
});

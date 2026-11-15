import type { ServicePublication, StationKm } from "./types";

/** One point of a train's path in the graph: time (s after midnight) and distance from the first terminal (km). */
export type TdPoint = [number, number];

/** A train of the graph. */
export interface TdTrain {
  trip: string;
  /** 0 = from the first terminal, 1 = back. */
  direction: number;
  /** The line's own train, or another line's train on the same stations. */
  own: boolean;
  /** Line colour, "#rrggbb". */
  color: string;
  /** Arrival and departure at each station it calls at; runs of calls on the line's stations only. */
  segments: TdPoint[][];
  /** How far the planner moved its departure, s; 0 when it runs at its clock-face time. */
  shifted_s: number;
}

/** What the graph of one line draws. */
export interface TdGraph {
  stations: StationKm[];
  trains: TdTrain[];
  shifted: { trip: string; by_s: number; depart_s: number | null }[];
  unplaced: { trip: string; reason: string; blocked_by: string | null }[];
}

/** Time windows of the graph, s after midnight; the peaks match the planner's default peaks. */
export const WINDOWS = {
  morning: [6.5 * 3600, 9.5 * 3600],
  midday: [11 * 3600, 13 * 3600],
  evening: [15.5 * 3600, 19.5 * 3600],
  day: null,
} as const;
export type WindowKey = keyof typeof WINDOWS;

/**
 * Purpose: the time-distance graph of one published line: its stations by distance along the track, its
 * trains, the trains of other lines while they call at two or more of its stations in a row, and the
 * planner's conflicts (departures moved to keep clear of other trains, trips that could not run).
 * Inputs: the publication from the railway tool and the line id.
 * Output: the graph, or null when the line has no report or fewer than two stations with a distance.
 */
export function timeDistance(pub: ServicePublication, lineId: string): TdGraph | null {
  const report = pub.lines.find((l) => l.id === lineId);
  if (!report || report.stations.length < 2) return null;
  const km = new Map(report.stations.map((s) => [s.station_id, s.km]));
  const parent = new Map(pub.timetable.stops.map((s) => [s.stop_id, s.parent_station ?? s.stop_id]));
  const color = new Map(pub.timetable.routes.map((r) => [r.route_id, `#${r.route_color ?? "64748b"}`]));
  const moved = new Map(report.shifted.map((s) => [s.trip, s.by_s]));

  const trains: TdTrain[] = [];
  for (const trip of pub.timetable.trips) {
    const own = trip.route_id === lineId;
    const segments: TdPoint[][] = [];
    let run: TdPoint[] = [];
    for (const st of [...trip.stop_times].sort((a, b) => a.stop_sequence - b.stop_sequence)) {
      const at = km.get(parent.get(st.stop_id) ?? "");
      if (at === undefined) {
        if (run.length >= 2) segments.push(run);
        run = [];
        continue;
      }
      run.push([st.arrival_time, at]);
      if (st.departure_time !== st.arrival_time) run.push([st.departure_time, at]);
    }
    if (run.length >= 2) segments.push(run);
    // Another line's train counts only where it runs between two of this line's stations.
    const used = own ? segments : segments.filter((s) => new Set(s.map((p) => p[1])).size >= 2);
    if (!used.length) continue;
    trains.push({
      trip: trip.trip_id,
      direction: trip.direction_id ?? 0,
      own,
      color: color.get(trip.route_id) ?? "#64748b",
      segments: used,
      shifted_s: own ? (moved.get(trip.trip_id) ?? 0) : 0,
    });
  }
  const departs = new Map(
    pub.timetable.trips
      .filter((t) => t.route_id === lineId)
      .map((t) => [t.trip_id, t.stop_times[0]?.departure_time ?? null]),
  );
  return {
    stations: report.stations,
    trains,
    shifted: report.shifted.map((s) => ({ ...s, depart_s: departs.get(s.trip) ?? null })),
    unplaced: report.unplaced,
  };
}

/** Purpose: whether any part of a train runs inside the window `[from, to]`. */
export function inWindow(train: TdTrain, from: number, to: number): boolean {
  return train.segments.some((s) => s[0]![0] <= to && s[s.length - 1]![0] >= from);
}

/** Purpose: the time window of the graph: a fixed one, or the whole day the line's trains run. */
export function windowRange(graph: TdGraph, key: WindowKey): [number, number] {
  const w = WINDOWS[key];
  if (w) return [w[0], w[1]];
  const own = graph.trains.filter((t) => t.own).flatMap((t) => t.segments.flat().map((p) => p[0]));
  if (!own.length) return [6 * 3600, 22 * 3600];
  return [Math.floor(Math.min(...own) / 3600) * 3600, Math.ceil(Math.max(...own) / 3600) * 3600];
}

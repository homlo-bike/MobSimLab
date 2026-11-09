import type { LineView, Mode } from "../street-lines/types";
import type { FrequencyPattern, LonLat, Period, Stop, Timetable } from "./types";

const H = 3600;
const M = 60;

/** Service periods shared by the example lines and street lines (ADR-0032 §2: peak, off-peak, no service). */
export interface ServiceDay {
  /** First departure, seconds after midnight. */
  firstS: number;
  /** Last departure, seconds after midnight (may pass 24:00). */
  lastS: number;
  /** Peak windows `[from, to)`. */
  peaks: [number, number][];
}

export const DEFAULT_SERVICE_DAY: ServiceDay = {
  firstS: 5 * H,
  lastS: 24 * H + 30 * M,
  peaks: [
    [7 * H, 9 * H],
    [16 * H, 19 * H],
  ],
};

/**
 * Purpose: periods for one line: peak headway in the peak windows, off-peak headway in the rest of the
 * service day, nothing outside it. Departures stay on the clock face (offset from midnight).
 */
export function servicePeriods(day: ServiceDay, peakS: number, offPeakS: number, offsetS = 0): Period[] {
  const out: Period[] = [];
  let t = day.firstS;
  const peaks = [...day.peaks].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of peaks) {
    const from = Math.max(a, day.firstS);
    const to = Math.min(b, day.lastS);
    if (to <= from) continue;
    if (from > t)
      out.push({
        start_time: t,
        end_time: from,
        headway_secs: offPeakS,
        offset_secs: offsetS,
        kind: "off_peak",
      });
    out.push({ start_time: from, end_time: to, headway_secs: peakS, offset_secs: offsetS, kind: "peak" });
    t = to;
  }
  if (day.lastS > t)
    out.push({
      start_time: t,
      end_time: day.lastS + 1,
      headway_secs: offPeakS,
      offset_secs: offsetS,
      kind: "off_peak",
    });
  return out;
}

/** Purpose: metres east/north of `center` to `[lon, lat]`. */
export function offset(center: LonLat, x: number, y: number): LonLat {
  const k = 111_320;
  return [center[0] + x / (k * Math.cos((center[1] * Math.PI) / 180)), center[1] + y / k];
}

/** A street line from the street line tool, as the planner needs it. */
export interface StreetLineInput {
  name: string;
  mode: Mode;
  color: string;
  view: LineView;
  dwellS: number;
  headwayMin: number;
}

/**
 * Purpose: one frequency pattern per direction of a street line: stop order and running times from the
 * routed legs, dwell from the line's timing, the line's headway off-peak and half of it in the peak.
 * Output: a timetable with only this line, or `null` when the line has fewer than two stops.
 */
export function streetLineTimetable(
  line: StreetLineInput,
  day: ServiceDay = DEFAULT_SERVICE_DAY,
): Timetable | null {
  const v = line.view;
  const pts = new Map(v.points.map((p) => [p.id, p]));
  const isStop = (id: number) => pts.get(id)?.kind !== "via";
  const id = `street-${line.name}`;
  const stops: Stop[] = v.points
    .filter((p) => p.kind !== "via")
    .map((p) => ({
      stop_id: `${id}:${p.id}`,
      stop_name: p.name || `Stop ${p.seq + 1}`,
      stop_lon: p.lonlat[0],
      stop_lat: p.lonlat[1],
    }));
  if (stops.length < 2) return null;
  const headway = Math.max(1, Math.round(line.headwayMin * 60));
  const peak = Math.max(60, Math.round(headway / 2));
  const dirs = v.directions.length
    ? v.directions
    : [{ direction: 0, stops: [], legs: v.legs.map((l) => l.index), length_m: v.length_m, time_s: v.time_s }];
  const patterns: FrequencyPattern[] = [];
  for (const d of dirs) {
    const seq: { stop_id: string; run_time: number; dwell_time: number }[] = [];
    let run = 0;
    for (const li of d.legs) {
      const leg = v.legs[li];
      if (!leg) continue;
      if (!seq.length && isStop(leg.from))
        seq.push({ stop_id: `${id}:${leg.from}`, run_time: 0, dwell_time: 0 });
      run += leg.time_s;
      if (isStop(leg.to) && seq.length) {
        seq.push({ stop_id: `${id}:${leg.to}`, run_time: Math.round(run), dwell_time: line.dwellS });
        run = 0;
      }
    }
    if (seq.length >= 2)
      patterns.push({
        pattern_id: `${id}-${d.direction}`,
        route_id: id,
        direction_id: d.direction,
        service_id: "weekday",
        stops: seq,
        periods: servicePeriods(day, peak, headway),
      });
  }
  if (!patterns.length) return null;
  return {
    stops,
    routes: [
      {
        route_id: id,
        route_short_name: line.name,
        mode: line.mode,
        route_color: line.color.replace("#", ""),
      },
    ],
    trips: [],
    transfers: [],
    frequency_patterns: patterns,
  };
}

/** Purpose: one timetable from several (ids are assumed distinct). */
export function mergeTimetables(parts: Timetable[]): Timetable {
  return {
    stops: parts.flatMap((p) => p.stops),
    routes: parts.flatMap((p) => p.routes),
    trips: parts.flatMap((p) => p.trips),
    transfers: parts.flatMap((p) => p.transfers),
    frequency_patterns: parts.flatMap((p) => p.frequency_patterns),
  };
}

/**
 * Purpose: a timetable with `prefix` before every id (stops, parent stations, routes, trips, patterns),
 * so timetables from different sources cannot collide. Names and station groups stay as they are.
 */
export function prefixTimetable(r: Partial<Timetable>, prefix: string): Timetable {
  const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const p = (id: string) => `${prefix}${id}`;
  return {
    stops: list(r.stops).map((s) => ({
      ...s,
      stop_id: p(s.stop_id),
      ...(s.parent_station ? { parent_station: p(s.parent_station) } : {}),
    })),
    routes: list(r.routes).map((x) => ({ ...x, route_id: p(x.route_id) })),
    trips: list(r.trips).map((t) => ({
      ...t,
      trip_id: p(t.trip_id),
      route_id: p(t.route_id),
      stop_times: list(t.stop_times).map((st) => ({ ...st, stop_id: p(st.stop_id) })),
    })),
    transfers: list(r.transfers).map((x) => ({
      ...x,
      from_stop_id: p(x.from_stop_id),
      to_stop_id: p(x.to_stop_id),
    })),
    frequency_patterns: list(r.frequency_patterns).map((f) => ({
      ...f,
      pattern_id: p(f.pattern_id),
      route_id: p(f.route_id),
      stops: list(f.stops).map((s) => ({ ...s, stop_id: p(s.stop_id) })),
    })),
  };
}

/** A cable car or ferry line from a plugin tool (ADR-0037), as the planner needs it. */
export interface PluginLineInput {
  /** Unique per line, such as `cable-car` or `ferry`. */
  id: string;
  name: string;
  /** Plugin mode id (`cable_car`, `aerial_tramway`, `ferry`). */
  mode: string;
  color: string;
  stops: { name: string; lonlat: [number, number] }[];
  /** One stopping pattern per direction: index into `stops`, running time from the previous stop, dwell. */
  directions: { stop: number; run_s: number; dwell_s: number }[][];
  /** Time between departures, seconds (all day; continuous gondolas use at least 60 s, ADR-0037 §5). */
  headwayS: number;
}

/**
 * Purpose: frequency patterns of a plugin line, one per direction, at the line's headway for the whole
 * service day. Ids get the `plugin:<id>:` prefix.
 * Output: a timetable with only this line, or `null` when it has fewer than two stops.
 */
export function pluginLineTimetable(
  line: PluginLineInput,
  day: ServiceDay = DEFAULT_SERVICE_DAY,
): Timetable | null {
  if (line.stops.length < 2) return null;
  const id = `plugin:${line.id}`;
  const headway = Math.max(60, Math.round(line.headwayS));
  const patterns: FrequencyPattern[] = line.directions
    .filter((d) => d.length >= 2)
    .map((d, i) => ({
      pattern_id: `${id}-${i}`,
      route_id: id,
      direction_id: i,
      service_id: "weekday",
      stops: d.map((s, k) => ({
        stop_id: `${id}:${s.stop}`,
        run_time: k === 0 ? 0 : Math.round(s.run_s),
        dwell_time: Math.round(s.dwell_s),
      })),
      periods: servicePeriods(day, headway, headway),
    }));
  if (!patterns.length) return null;
  return {
    stops: line.stops.map((s, i) => ({
      stop_id: `${id}:${i}`,
      stop_name: s.name || `Stop ${i + 1}`,
      stop_lon: s.lonlat[0],
      stop_lat: s.lonlat[1],
    })),
    routes: [
      {
        route_id: id,
        route_short_name: line.name,
        mode: line.mode,
        route_color: line.color.replace("#", ""),
      },
    ],
    trips: [],
    transfers: [],
    frequency_patterns: patterns,
  };
}

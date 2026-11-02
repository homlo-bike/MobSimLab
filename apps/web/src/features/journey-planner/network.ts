import type { LineView, Mode } from "../street-lines/types";
import type { FrequencyPattern, LonLat, Period, Route, Stop, Timetable, Transfer } from "./types";

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

interface LineSpec {
  id: string;
  mode: string;
  color: string;
  stops: { id: string; name: string; x: number; y: number; parent?: string; platform?: string }[];
  runS: number[];
  dwellS: number;
  peakS: number;
  offPeakS: number;
  offsetS: number;
  day: ServiceDay;
}

/** Purpose: both directions of a line as frequency patterns. */
function patterns(l: LineSpec): FrequencyPattern[] {
  const ids = l.stops.map((s) => s.id);
  const fwd = ids.map((stop_id, i) => ({
    stop_id,
    run_time: i === 0 ? 0 : l.runS[i - 1]!,
    dwell_time: i === 0 ? 0 : l.dwellS,
  }));
  const rev = [...ids].reverse().map((stop_id, i) => ({
    stop_id,
    run_time: i === 0 ? 0 : l.runS[ids.length - 1 - i]!,
    dwell_time: i === 0 ? 0 : l.dwellS,
  }));
  return [fwd, rev].map((stops, d) => ({
    pattern_id: `${l.id}-${d}`,
    route_id: l.id,
    direction_id: d,
    service_id: "weekday",
    stops,
    periods: servicePeriods(l.day, l.peakS, l.offPeakS, l.offsetS),
  }));
}

/**
 * Purpose: a made-up city around `center` to try the planner before real timetables exist: metro M1
 * (west–east), tram T2 (south–north), bus 3 (parallel to the metro, 1.2 km north) and regional train R5,
 * with a timed connection from R5 to M1 at Central. Stations are fictional.
 */
export function exampleNetwork(center: LonLat, day: ServiceDay = DEFAULT_SERVICE_DAY): Timetable {
  const metroNames = ["Lakeside", "Old Town", "Market", "Central", "University", "Stadium", "East Gate"];
  const tramNames = ["South Park", "Hospital", "Riverside", "Central", "Museum", "North Square", "Hilltop"];
  const busNames = ["Mill Lane", "Orchard", "Library", "North Square", "Brewery", "Canal", "Harbour Road"];
  const lines: LineSpec[] = [
    {
      id: "M1",
      mode: "metro",
      color: "1d4ed8",
      stops: metroNames.map((name, i) => ({
        id: i === 3 ? "central-m" : `m1-${i}`,
        name,
        x: (i - 3) * 900,
        y: 0,
        parent: i === 3 ? "central" : undefined,
        platform: i === 3 ? "M" : undefined,
      })),
      runS: Array<number>(6).fill(80),
      dwellS: 30,
      peakS: 4 * M,
      offPeakS: 8 * M,
      offsetS: 0,
      day,
    },
    {
      id: "T2",
      mode: "tram",
      color: "b91c1c",
      stops: tramNames.map((name, i) => ({
        id: i === 3 ? "central-t" : i === 5 ? "north-sq-t" : `t2-${i}`,
        name,
        x: i === 3 ? 40 : 0,
        y: (i - 3) * 500,
        parent: i === 3 ? "central" : i === 5 ? "north-sq" : undefined,
        platform: i === 3 ? "T" : undefined,
      })),
      runS: Array<number>(6).fill(75),
      dwellS: 20,
      peakS: 6 * M,
      offPeakS: 12 * M,
      offsetS: 2 * M,
      day,
    },
    {
      id: "3",
      mode: "bus",
      color: "c2410c",
      stops: busNames.map((name, i) => ({
        id: i === 3 ? "north-sq-b" : `b3-${i}`,
        name,
        x: (i - 3) * 800,
        y: i === 3 ? 1030 : 1200,
        parent: i === 3 ? "north-sq" : undefined,
      })),
      runS: Array<number>(6).fill(110),
      dwellS: 20,
      peakS: 10 * M,
      offPeakS: 20 * M,
      offsetS: 5 * M,
      day: { ...day, firstS: Math.max(day.firstS, 6 * H), lastS: Math.min(day.lastS, 22 * H) },
    },
    {
      id: "R5",
      mode: "regional_rail",
      color: "15803d",
      stops: [
        { id: "r5-0", name: "Westfield", x: -7000, y: -2500 },
        { id: "central-r", name: "Central", x: 0, y: -90, parent: "central", platform: "3" },
        { id: "r5-2", name: "Airport", x: 9000, y: 3500 },
      ],
      runS: [420, 540],
      dwellS: 60,
      peakS: 15 * M,
      offPeakS: 30 * M,
      offsetS: 9 * M,
      day: {
        ...day,
        firstS: Math.max(day.firstS, 5 * H + 30 * M),
        lastS: Math.min(day.lastS, 23 * H + 30 * M),
      },
    },
  ];
  const stops: Stop[] = [];
  for (const l of lines)
    for (const s of l.stops) {
      if (stops.some((x) => x.stop_id === s.id)) continue;
      const [lon, lat] = offset(center, s.x, s.y);
      stops.push({
        stop_id: s.id,
        stop_name: s.name,
        stop_lon: lon,
        stop_lat: lat,
        ...(s.parent ? { parent_station: s.parent } : {}),
        ...(s.platform ? { platform_code: s.platform } : {}),
      });
    }
  const routes: Route[] = lines.map((l) => ({
    route_id: l.id,
    route_short_name: l.id,
    mode: l.mode,
    route_color: l.color,
  }));
  // The Swiss-style node connection: R5 arriving at Central meets the metro.
  const transfers: Transfer[] = [
    {
      from_stop_id: "central-r",
      to_stop_id: "central-m",
      transfer_type: 1,
      min_transfer_time: 120,
      max_wait_s: 120,
    },
    {
      from_stop_id: "central-m",
      to_stop_id: "central-r",
      transfer_type: 1,
      min_transfer_time: 120,
      max_wait_s: 120,
    },
  ];
  return { stops, routes, trips: [], transfers, frequency_patterns: lines.flatMap(patterns) };
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
 * Purpose: read a published rail timetable (JSON text, `contracts/published-timetable.schema.json`), such as
 * the railway operations planner writes with `cargo run -p rail-plan --example publish_journeys`. Every id
 * gets the `rail:` prefix so it cannot collide with street lines or the example city; stop names and station
 * groups stay, so the planner joins the trains to street stops of the same station.
 * Output: the timetable, or an error message for text that is not a usable timetable.
 */
export function parseRailTimetable(text: string): { timetable: Timetable } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "The file is not JSON." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { error: "The file is not a published timetable." };
  const r = raw as Partial<Timetable>;
  const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const stops = list(r.stops);
  const trips = list(r.trips);
  const patterns = list(r.frequency_patterns);
  if (!stops.length || (!trips.length && !patterns.length))
    return { error: "The timetable has no stops or no trips." };
  const bad = stops.find(
    (s) => typeof s?.stop_id !== "string" || !Number.isFinite(s.stop_lat) || !Number.isFinite(s.stop_lon),
  );
  if (bad) return { error: "Every stop needs a stop_id, stop_lat and stop_lon." };
  const p = (id: string) => `rail:${id}`;
  return {
    timetable: {
      stops: stops.map((s) => ({
        ...s,
        stop_id: p(s.stop_id),
        ...(s.parent_station ? { parent_station: p(s.parent_station) } : {}),
      })),
      routes: list(r.routes).map((x) => ({ ...x, route_id: p(x.route_id) })),
      trips: trips.map((t) => ({
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
      frequency_patterns: patterns.map((f) => ({
        ...f,
        pattern_id: p(f.pattern_id),
        route_id: p(f.route_id),
        stops: list(f.stops).map((s) => ({ ...s, stop_id: p(s.stop_id) })),
      })),
    },
  };
}

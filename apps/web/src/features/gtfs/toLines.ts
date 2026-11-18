import { addStation, addSwitch, emptyNetwork, nextId } from "../railways/doc";
import { LINE_COLORS, suggestTrain } from "../railways/serviceLines";
import type { Network, RailMode, RailView, ServiceLine, Station, Track } from "../railways/types";
import type { Mode as StreetMode, RoutingRules, VehicleProfile } from "../street-lines/types";
import type { SavedStreetLine, StreetLinesDoc } from "../street-lines/saved";
import type { Route, Stop, Timetable } from "../journey-planner/types";
import type { GtfsFeed } from "./types";

/** Modes that become street lines (street line tool) and service lines (railway tool). */
export const STREET_MODES: readonly StreetMode[] = ["bus", "brt", "trolleybus", "intercity_bus"];
export const RAIL_MODES: readonly RailMode[] = [
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "long_distance_rail",
  "high_speed_rail",
];

export type LineKind = "street" | "rail";

/** Purpose: which tool an imported route can become a line in; null when none (ferry, cable car…). */
export function kindOf(mode: string): LineKind | null {
  if ((STREET_MODES as readonly string[]).includes(mode)) return "street";
  if ((RAIL_MODES as readonly string[]).includes(mode)) return "rail";
  return null;
}

/** A route's busiest stop sequence and its departures over the day. */
export interface MainPattern {
  route: Route;
  stops: Stop[];
  /** Departures from the first stop, s after midnight, sorted. */
  departures: number[];
  /** Mean dwell at intermediate stops, s. */
  dwellS: number;
}

/** Purpose: the stop sequence most departures of a route run, from its trips and frequency patterns. */
export function mainPattern(tt: Timetable, routeId: string): MainPattern | null {
  const route = tt.routes.find((r) => r.route_id === routeId);
  if (!route) return null;
  const byKey = new Map<string, { stops: string[]; deps: number[]; dwell: number[] }>();
  const add = (stops: string[], deps: number[], dwell: number[]) => {
    if (stops.length < 2) return;
    const key = stops.join("|");
    const e = byKey.get(key) ?? { stops, deps: [], dwell: [] };
    e.deps.push(...deps);
    e.dwell.push(...dwell);
    byKey.set(key, e);
  };
  for (const trip of tt.trips) {
    if (trip.route_id !== routeId) continue;
    const st = [...trip.stop_times].sort((a, b) => a.stop_sequence - b.stop_sequence);
    add(
      st.map((s) => s.stop_id),
      st[0] ? [st[0].departure_time] : [],
      st.slice(1, -1).map((s) => s.departure_time - s.arrival_time),
    );
  }
  for (const p of tt.frequency_patterns ?? []) {
    if (p.route_id !== routeId) continue;
    const deps: number[] = [];
    for (const per of p.periods)
      for (
        let t = per.start_time + (per.offset_secs ?? 0);
        t < per.end_time;
        t += Math.max(60, per.headway_secs)
      )
        deps.push(t);
    add(
      p.stops.map((s) => s.stop_id),
      deps,
      p.stops.slice(1, -1).map((s) => s.dwell_time),
    );
  }
  let best: { stops: string[]; deps: number[]; dwell: number[] } | null = null;
  for (const e of byKey.values()) if (!best || e.deps.length > best.deps.length) best = e;
  if (!best) return null;
  const stopById = new Map(tt.stops.map((s) => [s.stop_id, s]));
  const stops = best.stops.map((id) => stopById.get(id)).filter((s): s is Stop => !!s);
  if (stops.length < 2) return null;
  const dwellS = best.dwell.length ? best.dwell.reduce((a, b) => a + b, 0) / best.dwell.length : 20;
  return { route, stops, departures: [...best.deps].sort((a, b) => a - b), dwellS };
}

/** Purpose: the routes of a feed that can become lines, busiest first. */
export function convertibleRoutes(feed: GtfsFeed): { route: Route; kind: LineKind; departures: number }[] {
  const done = new Set(feed.converted ?? []);
  const count = new Map<string, number>();
  for (const t of feed.timetable.trips) count.set(t.route_id, (count.get(t.route_id) ?? 0) + 1);
  for (const p of feed.timetable.frequency_patterns ?? [])
    for (const per of p.periods)
      count.set(
        p.route_id,
        (count.get(p.route_id) ?? 0) +
          Math.ceil((per.end_time - per.start_time) / Math.max(60, per.headway_secs)),
      );
  return feed.timetable.routes
    .flatMap((route) => {
      const kind = kindOf(route.mode);
      return kind && !done.has(route.route_id)
        ? [{ route, kind, departures: count.get(route.route_id) ?? 0 }]
        : [];
    })
    .sort(
      (a, b) =>
        b.departures - a.departures || a.route.route_short_name.localeCompare(b.route.route_short_name),
    );
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Purpose: the headways of a day of departures: the shortest median gap over the hours (peak) and the
 * median gap of all (off-peak), in whole minutes, with the first and last departure.
 */
export function headways(departures: readonly number[]): {
  peakMin: number;
  offPeakMin: number;
  firstMin: number;
  lastMin: number;
} {
  const d = [...departures].sort((a, b) => a - b);
  const gaps = d.slice(1).map((t, i) => t - d[i]!);
  const byHour = new Map<number, number[]>();
  d.slice(1).forEach((t, i) => {
    const h = Math.floor(t / 3600);
    byHour.set(h, [...(byHour.get(h) ?? []), gaps[i]!]);
  });
  const hourly = [...byHour.values()].filter((g) => g.length >= 2).map((g) => median(g)!);
  const all = median(gaps) ?? 3600;
  const peak = hourly.length ? Math.min(...hourly) : all;
  const min = (s: number) => Math.max(1, Math.round(s / 60));
  return {
    peakMin: min(peak),
    offPeakMin: Math.max(min(peak), min(all)),
    firstMin: Math.round((d[0] ?? 5 * 3600) / 60),
    lastMin: Math.round((d[d.length - 1] ?? 24 * 3600) / 60),
  };
}

/**
 * Purpose: an imported bus route as a street line: its stops in order (the ends as end stops), named as
 * in the feed, with the feed's peak headway. The route is empty until the street line tool routes it
 * along the streets when it opens.
 */
export function toStreetLine(p: MainPattern, profile: VehicleProfile, rules: RoutingRules): SavedStreetLine {
  const h = headways(p.departures);
  const last = p.stops.length - 1;
  return {
    name: p.route.route_short_name || p.route.route_id,
    profile,
    rules,
    timing: {
      headwayMin: h.peakMin,
      offPeakHeadwayMin: h.offPeakMin,
      dwellS: Math.max(5, Math.round(p.dwellS)),
      layoverMin: 5,
      firstMin: h.firstMin,
      lastMin: Math.max(h.lastMin, h.firstMin + 1),
    },
    points: p.stops.map((s, i) => ({
      lonlat: [s.stop_lon, s.stop_lat],
      kind: i === 0 || i === last ? "end_stop" : "stop",
      name: s.stop_name || null,
    })),
    depot: null,
    depotStops: {},
    view: {
      points: [],
      legs: [],
      directions: [],
      station_groups: [],
      depot: null,
      depot_trips: [],
      issues: [],
      length_m: 0,
      time_s: 0,
      level_crossings: [],
      crossing_wait_s: 0,
    },
  };
}

/** Purpose: add a street line to the project's lines. Output: the document and the new line's index. */
export function addStreetLine(doc: StreetLinesDoc | null, line: SavedStreetLine): [StreetLinesDoc, number] {
  const lines = [...(doc?.lines ?? []), line];
  return [{ lines }, lines.length - 1];
}

/** Platform tracks used by a through track: both of a two-track station. */
const BOTH: number[] = [0, 1];

/**
 * Purpose: an imported rail route as a service line of the railway design: a station at each stop (one
 * of the design already within `sameStationM` with the same name is used again), a double track from
 * station to station where the design has none, and the line with the feed's first and last departure
 * and headways. Stations face along the route; where routes branch, the planner adds the switches.
 * Inputs: `toLocal` projects into the design's metres (the railway engine's projection).
 * Output: the design and the new line's id.
 */
export function toRailLine(
  doc: Network | null,
  p: MainPattern,
  mode: RailMode,
  toLocal: (origin: [number, number], lonlat: [number, number]) => [number, number],
  opts: { platformLengthM: number; sameStationM?: number } = { platformLengthM: 100 },
): [Network, string] {
  const first = p.stops[0]!;
  let d: Network = doc ?? emptyNetwork(mode, [first.stop_lon, first.stop_lat]);
  const near = opts.sameStationM ?? 150;
  const local = p.stops.map((s) => toLocal(d.origin, [s.stop_lon, s.stop_lat]));
  // Merge consecutive stops of one station (platforms of a parent station listed one after another).
  const ids: number[] = [];
  local.forEach((xy, i) => {
    const s = p.stops[i]!;
    const prev = local[i - 1] ?? xy;
    const next = local[i + 1] ?? xy;
    const angle = (Math.atan2(next[1] - prev[1], next[0] - prev[0]) * 180) / Math.PI;
    const found = d.stations.find(
      (st) => st.name === s.stop_name && Math.hypot(st.x - xy[0], st.y - xy[1]) <= near,
    );
    if (found) {
      if (ids[ids.length - 1] !== found.id) ids.push(found.id);
      return;
    }
    const tram = mode === "tram" || mode === "light_rail";
    const [nd, id] = addStation(d, xy, {
      level: "street",
      sides: tram ? 2 : 0,
      islands: tram ? 0 : 1,
      platformLength: opts.platformLengthM,
      name: s.stop_name || undefined,
    });
    d = {
      ...nd,
      stations: nd.stations.map(
        (st): Station =>
          st.id === id
            ? { ...st, rotation_deg: ((angle % 360) + 360) % 360, ...(mode !== d.mode ? { mode } : {}) }
            : st,
      ),
    };
    ids.push(id);
  });
  // Tracks between consecutive stations, unless the design already joins them.
  const joined = (a: number, b: number) =>
    d.tracks.some(
      (t) =>
        t.start.type === "station" &&
        t.end?.type === "station" &&
        ((t.start.station === a && t.end.station === b) || (t.start.station === b && t.end.station === a)),
    );
  for (let i = 1; i < ids.length; i++) {
    const [a, b] = [ids[i - 1]!, ids[i]!];
    if (joined(a, b)) continue;
    const track: Track = {
      id: nextId(d),
      name: "",
      start: { type: "station", station: a, end: 1, tracks: BOTH },
      end: { type: "station", station: b, end: 0, tracks: BOTH },
      points: [],
      tracks: 2,
      level: "street",
      power: "auto",
      use: "running",
      bed: "auto",
      lead_start_m: 30,
      lead_end_m: 30,
      ...(mode !== d.mode ? { mode } : {}),
    };
    d = { ...d, tracks: [...d.tracks, track] };
  }
  const h = headways(p.departures);
  const lines = d.lines ?? [];
  const taken = new Set(lines.map((l) => l.id));
  let n = lines.length + 1;
  while (taken.has(`line${n}`)) n++;
  const colour = p.route.route_color ? `#${p.route.route_color.replace(/^#/, "").toLowerCase()}` : null;
  const line: ServiceLine = {
    id: `line${n}`,
    name: p.route.route_short_name || p.route.route_id,
    color: colour && /^#[0-9a-f]{6}$/.test(colour) ? colour : LINE_COLORS[lines.length % LINE_COLORS.length]!,
    stations: ids,
    vehicle: suggestTrain(mode, opts.platformLengthM)?.id ?? "",
    units: 1,
    first_min: h.firstMin,
    last_min: Math.max(h.lastMin, h.firstMin + 1),
    peak_headway_min: h.peakMin,
    offpeak_headway_min: h.offPeakMin,
    dwell_s: Math.max(10, Math.round(p.dwellS)),
  };
  return [{ ...d, lines: [...lines, line] }, line.id];
}

/** Purpose: the feed's timetable without the routes the planner turned into lines of their own. */
export function feedTimetable(feed: GtfsFeed): Timetable {
  const done = new Set(feed.converted ?? []);
  if (!done.size) return feed.timetable;
  const tt = feed.timetable;
  return {
    ...tt,
    routes: tt.routes.filter((r) => !done.has(r.route_id)),
    trips: tt.trips.filter((t) => !done.has(t.route_id)),
    frequency_patterns: (tt.frequency_patterns ?? []).filter((p) => !done.has(p.route_id)),
  };
}

/**
 * Purpose: a crossover near each terminus of a line, so trains can change track to turn back, unless the
 * track there has a switch already. Placed on the straight track next to the end station.
 * Inputs: `build` builds the design (the railway engine) for the track lengths and the turnout catalogue.
 */
export function addTerminalCrossovers(
  doc: Network,
  lineId: string,
  build: (d: Network) => Pick<RailView, "tracks" | "modes" | "turnouts" | "params">,
): Network {
  const line = (doc.lines ?? []).find((l) => l.id === lineId);
  if (!line || line.stations.length < 2) return doc;
  const view = build(doc);
  let d = doc;
  for (const station of [line.stations[0]!, line.stations[line.stations.length - 1]!]) {
    const track = d.tracks.find(
      (t) =>
        t.tracks === 2 &&
        ((t.start.type === "station" && t.start.station === station) ||
          (t.end?.type === "station" && t.end.station === station)),
    );
    if (!track || d.switches.some((s) => s.track === track.id)) continue;
    const tv = view.tracks.find((t) => t.id === track.id);
    const cat = view.modes[tv?.mode ?? d.mode] ?? { params: view.params, turnouts: view.turnouts };
    const element = cat.params.default_turnout;
    const t = cat.turnouts.find((x) => x.id === element);
    if (!tv || !t) continue;
    const len = 2 * (t.length_a_m ?? 0) + cat.params.track_centre_m * (t.crossing_ratio_n ?? 0);
    const gap = 25;
    if (tv.length_m < len + 2 * gap) continue;
    const atStart = track.start.type === "station" && track.start.station === station;
    [d] = addSwitch(d, {
      kind: "crossover",
      track: track.id,
      s: atStart ? gap : tv.length_m - gap - len,
      element,
      side: 1,
    });
  }
  return d;
}

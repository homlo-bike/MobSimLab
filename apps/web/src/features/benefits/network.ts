/**
 * Stations and lines of the published network for the benefit tables (ADR-0040): stops of one station
 * (same parent station, or the same name within 600 m, as the journey planner) form one zone.
 */
import type { LonLat, Timetable } from "../journey-planner/types";

export interface Station {
  id: string;
  name: string;
  at: LonLat;
  stopIds: string[];
  /** Route ids that call here. */
  lines: string[];
  modes: string[];
}

export interface NetLine {
  id: string;
  name: string;
  mode: string;
  color: string;
  /** Station ids in order of first call. */
  stations: string[];
}

export interface Net {
  stations: Station[];
  lines: NetLine[];
}

const SAME_NAME_M = 600;

/** Purpose: metres between two points (equirectangular; fine within a city). */
export function metres(a: LonLat, b: LonLat): number {
  const kx = 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110_574);
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Purpose: the stations and lines of a timetable. */
export function networkOf(tt: Timetable): Net {
  const stops = tt.stops;
  const idx = new Map(stops.map((s, i) => [s.stop_id, i]));
  const parent = stops.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const join = (a: number, b: number) => {
    const [x, y] = [find(a), find(b)];
    if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
  };
  const byParent = new Map<string, number>();
  stops.forEach((s, i) => {
    if (!s.parent_station) return;
    const j = byParent.get(s.parent_station);
    if (j === undefined) byParent.set(s.parent_station, i);
    else join(i, j);
  });
  for (let i = 0; i < stops.length; i++)
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i]!;
      const b = stops[j]!;
      if (
        a.stop_name &&
        norm(a.stop_name) === norm(b.stop_name) &&
        metres([a.stop_lon, a.stop_lat], [b.stop_lon, b.stop_lat]) <= SAME_NAME_M
      )
        join(i, j);
    }
  // Route of each stop, and the call order of each route.
  const routeStops = new Map<string, string[]>();
  const add = (route: string, stop: string) => {
    const l = routeStops.get(route) ?? [];
    if (!l.includes(stop)) l.push(stop);
    routeStops.set(route, l);
  };
  for (const t of tt.trips) for (const st of t.stop_times) add(t.route_id, st.stop_id);
  for (const p of tt.frequency_patterns ?? []) for (const s of p.stops) add(p.route_id, s.stop_id);

  const groups = new Map<number, number[]>();
  stops.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const stationOfStop = new Map<string, string>();
  const stations: Station[] = [];
  for (const [root, members] of groups) {
    const id = `st${root}`;
    const ss = members.map((i) => stops[i]!);
    for (const s of ss) stationOfStop.set(s.stop_id, id);
    stations.push({
      id,
      name: ss[0]!.stop_name || id,
      at: [
        ss.reduce((a, s) => a + s.stop_lon, 0) / ss.length,
        ss.reduce((a, s) => a + s.stop_lat, 0) / ss.length,
      ],
      stopIds: ss.map((s) => s.stop_id),
      lines: [],
      modes: [],
    });
  }
  const byId = new Map(stations.map((s) => [s.id, s]));
  const lines: NetLine[] = [];
  for (const r of tt.routes) {
    const order: string[] = [];
    for (const sid of routeStops.get(r.route_id) ?? []) {
      if (!idx.has(sid)) continue;
      const st = stationOfStop.get(sid)!;
      if (!order.includes(st)) order.push(st);
      const s = byId.get(st)!;
      if (!s.lines.includes(r.route_id)) s.lines.push(r.route_id);
      if (!s.modes.includes(r.mode)) s.modes.push(r.mode);
    }
    if (order.length)
      lines.push({
        id: r.route_id,
        name: r.route_short_name || r.route_id,
        mode: r.mode,
        color: r.route_color ? `#${r.route_color.replace("#", "")}` : "#475569",
        stations: order,
      });
  }
  return { stations: stations.filter((s) => s.lines.length), lines };
}

/** Purpose: the timetable without some routes (and the trips and patterns of those routes). */
export function withoutRoutes(tt: Timetable, routes: Set<string>): Timetable {
  return {
    ...tt,
    routes: tt.routes.filter((r) => !routes.has(r.route_id)),
    trips: tt.trips.filter((t) => !routes.has(t.route_id)),
    frequency_patterns: (tt.frequency_patterns ?? []).filter((p) => !routes.has(p.route_id)),
  };
}

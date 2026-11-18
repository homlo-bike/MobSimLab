/**
 * The project's stops and lines as the GIS tab's walk coverage and stop spacing see them, and the rules
 * they are measured against (assumption library values, exported by tools/assumptions/check.py --render).
 */
import data from "./defaults.generated.json";
import { paramNumber } from "../../workspace/preferences";
import type { Network, RailView } from "../railways/types";
import { streetLineColor, type StreetLinesDoc } from "../street-lines/saved";
import type { DemandPoint, LonLat, StopPoint, WalkSettings } from "./types";

interface ModeValues {
  catchment_m: number;
  stop_spacing_m: [number, number, number];
  colour?: string;
}

const LIB = data as unknown as {
  modes: Record<string, ModeValues>;
  walk_speed_kmh: number;
  crossing_delay_s: number;
  walk_rule_minutes: number;
};

/** Assumption ids a project can set in its preferences document. */
export const PREF = {
  minutes: "analysis.walk_rule_minutes",
  speed: "demand.walk_speed_kmh",
  crossing: "walk.crossing_delay_s",
} as const;

/** The walk rule's minutes from the library (`analysis.walk_rule_minutes`, central 15). */
export const LIBRARY_MINUTES = LIB.walk_rule_minutes;

/** Shortest and longest walk limit the panel accepts, minutes. */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 30;

/** Most zoom-14 walk tiles one analysis loads (about 12 km × 12 km at 50° N), as the agent tools. */
export const MAX_WALK_TILES = 64;

/** Size of the cells the people of the population grid are gathered in, m (also the gap size): the library's. */
export const GAP_CELL_M = paramNumber("analysis.gap_cell_m", undefined);

/** Purpose: the gap cell size a project uses (`analysis.gap_cell_m`): its own where set, else the library's. */
export function gapCellM(prefs: Record<string, number> | undefined): number {
  return Math.max(50, paramNumber("analysis.gap_cell_m", prefs));
}

const TILE_ZOOM = 14;

function prefNumber(prefs: Record<string, number> | undefined, id: string, lo: number, hi: number) {
  const v = prefs?.[id];
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

/** Purpose: the walk rule's minutes: the project's value where it set one, else the library's. */
export function ruleMinutes(prefs?: Record<string, number>): number {
  return prefNumber(prefs, PREF.minutes, MIN_MINUTES, MAX_MINUTES) ?? LIBRARY_MINUTES;
}

/** Purpose: how people walk: the project's walking speed and crossing wait where set, else the library's. */
export function walkSettings(prefs: Record<string, number> | undefined, stepFree: boolean): WalkSettings {
  return {
    walk_speed_kmh: prefNumber(prefs, PREF.speed, 1, 10) ?? LIB.walk_speed_kmh,
    crossing_delay_s: prefNumber(prefs, PREF.crossing, 0, 300) ?? LIB.crossing_delay_s,
    step_free: stepFree,
    max_snap_m: 250,
  };
}

/** Purpose: the stop spacing guidance of a mode, m (`mode.stop_spacing_m`: low, central, high), or null. */
export function spacingGuidance(mode: string): [number, number, number] | null {
  return LIB.modes[mode]?.stop_spacing_m ?? null;
}

/** A stop or station of the project. */
export interface ProjectStop {
  id: string;
  name: string;
  lonlat: LonLat;
}

/** One direction of a line: its stops in order and the path it runs along (null: straight between stops). */
export interface LineDirection {
  stops: string[];
  route: LonLat[] | null;
}

/** A line of the project. */
export interface ProjectLine {
  id: string;
  name: string;
  mode: string;
  color: string;
  kind: "street" | "rail";
  directions: LineDirection[];
}

export interface ProjectNetwork {
  stops: ProjectStop[];
  lines: ProjectLine[];
}

/**
 * Purpose: the stops and lines of the saved street lines. Each direction runs along its routed legs; a
 * line with fewer than two stops is left out.
 */
export function streetNetwork(doc: StreetLinesDoc | null): ProjectNetwork {
  const stops: ProjectStop[] = [];
  const lines: ProjectLine[] = [];
  for (const [i, l] of (doc?.lines ?? []).entries()) {
    const v = l.view;
    const pts = new Map(v.points.map((p) => [p.id, p]));
    const own = v.points.filter((p) => p.kind !== "via");
    if (own.length < 2) continue;
    const id = (p: number) => `s${i}:${p}`;
    for (const p of own) stops.push({ id: id(p.id), name: p.name || `${p.seq + 1}`, lonlat: p.lonlat });
    const directions: LineDirection[] = v.directions.length
      ? v.directions.map((d) => ({
          stops: d.stops.filter((s) => pts.get(s) && pts.get(s)!.kind !== "via").map(id),
          route: d.legs.flatMap((k, j) => {
            const c = v.legs[k]?.coords ?? [];
            return j === 0 ? c : c.slice(1);
          }),
        }))
      : [{ stops: own.map((p) => id(p.id)), route: null }];
    lines.push({
      id: `street-${i}`,
      name: l.name || `${i + 1}`,
      mode: l.profile.mode,
      color: streetLineColor(l),
      kind: "street",
      directions: directions.map((d) => ({ ...d, route: d.route && d.route.length >= 2 ? d.route : null })),
    });
  }
  return { stops, lines };
}

/**
 * Purpose: the stations of the railway as built, and its service lines. Service lines are measured in a
 * straight line between stations: the track path between them is not part of the build yet.
 */
export function railNetwork(net: Network | null, view: RailView | null): ProjectNetwork {
  if (!net || !view) return { stops: [], lines: [] };
  const id = (s: number) => `r:${s}`;
  const stops = view.stations.map((s) => ({ id: id(s.id), name: s.name || `${s.id}`, lonlat: s.lonlat }));
  const known = new Set(view.stations.map((s) => s.id));
  const lines = (net.lines ?? []).flatMap((l): ProjectLine[] => {
    const st = l.stations.filter((s) => known.has(s));
    if (st.length < 2) return [];
    return [
      {
        id: `rail-${l.id}`,
        name: l.name || l.id,
        mode: net.mode,
        color: l.color,
        kind: "rail",
        directions: [{ stops: st.map(id), route: null }],
      },
    ];
  });
  return { stops, lines };
}

/** Purpose: one network from several, stops listed once. */
export function mergeNetworks(...nets: ProjectNetwork[]): ProjectNetwork {
  const seen = new Set<string>();
  const stops = nets.flatMap((n) => n.stops).filter((s) => !seen.has(s.id) && seen.add(s.id));
  return { stops, lines: nets.flatMap((n) => n.lines) };
}

/** Purpose: the stops as the engine takes them. */
export function stopPoints(stops: ProjectStop[]): StopPoint[] {
  return stops.map((s) => ({ id: s.id, lon: s.lonlat[0], lat: s.lonlat[1] }));
}

/** Purpose: the box round the stops plus `reachM` on every side `[west, south, east, north]`, or null. */
export function studyArea(stops: ProjectStop[], reachM: number): [number, number, number, number] | null {
  if (!stops.length) return null;
  const lons = stops.map((s) => s.lonlat[0]);
  const lats = stops.map((s) => s.lonlat[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = reachM / 111_195;
  const dLon = dLat / Math.max(0.1, Math.cos((lat0 * Math.PI) / 180));
  return [
    Math.min(...lons) - dLon,
    Math.min(...lats) - dLat,
    Math.max(...lons) + dLon,
    Math.max(...lats) + dLat,
  ];
}

/** Purpose: the zoom-14 tiles over a box, the middle ones first. */
export function walkTiles(bbox: [number, number, number, number]): [number, number][] {
  const n = 2 ** TILE_ZOOM;
  const tx = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const ty = (lat: number) => {
    const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  };
  const out: [number, number][] = [];
  for (let x = tx(bbox[0]); x <= tx(bbox[2]); x++)
    for (let y = ty(bbox[3]); y <= ty(bbox[1]); y++) out.push([x, y]);
  const [cx, cy] = [(tx(bbox[0]) + tx(bbox[2])) / 2, (ty(bbox[3]) + ty(bbox[1])) / 2];
  return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
}

/** People per cell (WorldPop through the population API): south-west corner, cell size in degrees. */
export interface PeopleGrid {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  people: number[];
}

/**
 * Purpose: the people of the grid inside `area`, gathered in cells of about `cellM` metres, each at the
 * people-weighted middle of its cell. Gathering keeps the request small and makes each gap a block, not a
 * single 100 m grid cell.
 */
export function peopleDemand(
  grid: PeopleGrid,
  area: [number, number, number, number],
  cellM = GAP_CELL_M,
): DemandPoint[] {
  const lat0 = (area[1] + area[3]) / 2;
  const dLat = cellM / 111_195;
  const dLon = dLat / Math.max(0.1, Math.cos((lat0 * Math.PI) / 180));
  const cells = new Map<string, { w: number; lon: number; lat: number }>();
  for (let j = 0; j < grid.ny; j++) {
    const lat = grid.y0 + (j + 0.5) * grid.dy;
    if (lat < area[1] || lat > area[3]) continue;
    for (let i = 0; i < grid.nx; i++) {
      const w = grid.people[j * grid.nx + i] ?? 0;
      if (!(w > 0)) continue;
      const lon = grid.x0 + (i + 0.5) * grid.dx;
      if (lon < area[0] || lon > area[2]) continue;
      const key = `${Math.floor((lon - area[0]) / dLon)}/${Math.floor((lat - area[1]) / dLat)}`;
      const c = cells.get(key) ?? { w: 0, lon: 0, lat: 0 };
      c.w += w;
      c.lon += lon * w;
      c.lat += lat * w;
      cells.set(key, c);
    }
  }
  return [...cells.values()].map((c) => ({ lon: c.lon / c.w, lat: c.lat / c.w, weight: c.w }));
}

/** Map colours of the walk minutes, by 5-minute band (green, yellow, orange, red, dark red, purple). */
export const BAND_COLORS = ["#16a34a", "#eab308", "#f97316", "#dc2626", "#9f1239", "#6b21a8"] as const;

/** A street line as the project saves it (drawing kind "street-lines"). */
import type { StreetLineInput } from "../journey-planner/network";
import { inputKey } from "../../projects/inputKey";
import { fullTiming, MODES, type Timing } from "./modes";
import { distanceM } from "../../map/geo";
import { tileX, tileY } from "./tiles";
import type { LineView, LonLat, PointKind, RoutingRules, VehicleProfile } from "./types";

/** One point as the planner placed it; `name` only when the planner named it (otherwise the street's name). */
export interface SavedPoint {
  lonlat: LonLat;
  kind: PointKind;
  name: string | null;
  /** Facilities of a stop (`stations/features.tsx`), shown in the Schematic tab; absent when none. */
  features?: string[];
}

/** One street line: what the planner drew and set, plus the route last computed from it. */
export interface SavedStreetLine {
  /** Stable id, so comments stay on the line when lines before it are deleted; absent on lines saved before ids. */
  id?: string;
  name: string;
  /** The line's own colour (#rrggbb) on the map, the schematic and in the legends; absent: its mode's colour. */
  color?: string | null;
  profile: VehicleProfile;
  /** The catalogue vehicle (vehicles.ts id); null or absent for the mode's typical vehicle. */
  vehicle?: string | null;
  rules: RoutingRules;
  timing: Timing;
  points: SavedPoint[];
  /** A depot point of lines drawn before shared depots; null when the line uses `depotId`. */
  depot: LonLat | null;
  /** The shared road depot (drawing kind `depots`) the line pulls out of and in to; its gates start and end the depot runs. */
  depotId?: string | null;
  /** The terminals the depot runs serve, as indexes into `points`. */
  depotStops: { out?: number; in?: number };
  /**
   * The route as the tool last worked it out, saved with the project: the journey planner, Tables and the tool
   * itself show it as it is. The tool routes the points again only when the planner changes the line, when
   * `routedWith` no longer matches what the route depends on and the planner recalculates it, or for a line
   * saved before routes had a fingerprint.
   */
  view: LineView;
  /** Fingerprint of what `view` was routed from (`routeKey`); absent on lines saved before it was kept. */
  routedWith?: string;
}

/** What a street line's route depends on besides the line itself, as the tool applies it (JSON texts). */
export interface RouteSurroundings {
  /** The street setups of the GIS tab. */
  setups: string;
  /** The project's delays in traffic; "" for the library's. */
  delays: string;
  /** The gates of the shared depot the line uses; "" without one, "gone" for a deleted one. */
  gates: string;
  /** Fingerprint of the railway topology for level crossings; "" without one. */
  crossings: string;
}

/** Purpose: the fingerprint of everything a line's route is worked out from. */
export function routeKey(
  line: Pick<SavedStreetLine, "profile" | "rules" | "points" | "depot">,
  around: RouteSurroundings,
): string {
  return inputKey({
    profile: line.profile,
    rules: line.rules,
    points: line.points.map((p) => [p.lonlat, p.kind]),
    depot: line.depot,
    around,
  });
}

/** The project's street lines; the street line tool edits one at a time. */
export interface StreetLinesDoc {
  lines: SavedStreetLine[];
}

/** Colours given to street lines in turn, so lines of one mode can be told apart. */
export const STREET_LINE_COLORS = [
  "#b91c1c",
  "#1d4ed8",
  "#15803d",
  "#7e22ce",
  "#c2410c",
  "#0e7490",
  "#a16207",
  "#be185d",
  "#4d7c0f",
  "#475569",
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Purpose: a street line's colour: its own, else its mode's. */
export function streetLineColor(line: Pick<SavedStreetLine, "color" | "profile">): string {
  return line.color && HEX.test(line.color)
    ? line.color
    : (MODES[line.profile.mode]?.color ?? MODES.bus.color);
}

/** Purpose: the first line colour no line uses yet (in turn once all are used). */
export function nextLineColor(used: readonly (string | null | undefined)[]): string {
  const taken = new Set(used.filter((c): c is string => !!c).map((c) => c.toLowerCase()));
  return (
    STREET_LINE_COLORS.find((c) => !taken.has(c)) ??
    STREET_LINE_COLORS[used.length % STREET_LINE_COLORS.length]!
  );
}

/** Purpose: the lines with a colour of their own for each line that has none yet, in turn from the unused ones. */
export function withLineColors(lines: readonly SavedStreetLine[]): SavedStreetLine[] {
  const used = lines.map((l) => (l.color && HEX.test(l.color) ? l.color : null));
  return lines.map((l, i) => {
    if (used[i]) return l;
    const color = nextLineColor(used);
    used[i] = color;
    return { ...l, color };
  });
}

/** Purpose: a new street line id. */
export function newLineId(): string {
  return crypto.randomUUID();
}

/** Purpose: the journey planner's view of a saved line, or null if it has fewer than two points. */
export function lineInput(line: SavedStreetLine | undefined): StreetLineInput | null {
  if (!line || line.view.points.length < 2) return null;
  const t = fullTiming(line.timing);
  return {
    name: line.name,
    mode: line.profile.mode,
    color: streetLineColor(line),
    view: line.view,
    dwellS: t.dwellS,
    headwayMin: t.headwayMin,
    offPeakHeadwayMin: t.offPeakHeadwayMin,
    firstMin: t.firstMin,
    lastMin: t.lastMin,
  };
}

/** Purpose: the saved line's bounding box [west, south, east, north], or null without points. */
export function lineBounds(line: SavedStreetLine): [number, number, number, number] | null {
  const pts = [...line.points.map((p) => p.lonlat), ...(line.depot ? [line.depot] : [])];
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Purpose: the street tiles a saved line runs over, as "x/y" keys: under its points, its route and its depot runs,
 * so all of its streets load when it opens, not only those on screen (a long line opens zoomed to its first point).
 * A part of the route that was not found is a straight line between its ends; the tiles along it are taken too,
 * so the streets that may complete it load. At most `max` tiles: the points' first, then the route's, then the
 * depot runs'.
 */
export function lineTiles(line: SavedStreetLine, max = 64): string[] {
  const keys = new Set<string>();
  const add = ([lon, lat]: LonLat) => keys.add(`${tileX(lon)}/${tileY(lat)}`);
  // Every point of a path, and points along each of its segments at most about a third of a tile apart.
  const along = (coords: LonLat[]) =>
    coords.forEach((c, i) => {
      add(c);
      const next = coords[i + 1];
      if (!next) return;
      const steps = Math.ceil(distanceM(c, next) / TILE_STEP_M);
      for (let k = 1; k < steps; k++)
        add([c[0] + ((next[0] - c[0]) * k) / steps, c[1] + ((next[1] - c[1]) * k) / steps]);
    });
  line.points.forEach((p) => add(p.lonlat));
  if (line.depot) add(line.depot);
  for (const leg of line.view?.legs ?? []) along(leg.coords);
  for (const run of line.view?.depot_trips ?? []) along(run.coords);
  return [...keys].slice(0, max);
}

/** Sampling step along a path for `lineTiles`, m: a zoom-14 tile is at most about 2.4 km wide. */
const TILE_STEP_M = 800;

/** The parts of a saved route that were not found, which count 0 m in Tables, costs and the appraisal. */
export interface UnroutedParts {
  /** Legs between two points with no route found. */
  legs: number;
  /** Depot runs with no route found. */
  depotRuns: number;
  /** Straight-line distance between the ends of the legs not found, m: at least what the line leaves out. */
  straightM: number;
}

/** Purpose: what a saved route still leaves out; null when every leg and depot run was found. */
export function unroutedParts(view: LineView): UnroutedParts | null {
  const at = new Map((view.points ?? []).map((p) => [p.id, p.lonlat] as const));
  let legs = 0;
  let straightM = 0;
  for (const leg of view.legs ?? []) {
    if (leg.status !== "error") continue;
    legs++;
    const [a, b] = [at.get(leg.from), at.get(leg.to)];
    if (a && b) straightM += distanceM(a, b);
  }
  const depotRuns = (view.depot_trips ?? []).filter((d) => d.status === "error").length;
  return legs || depotRuns ? { legs, depotRuns, straightM } : null;
}

const same = (a: LonLat | undefined, b: LonLat | undefined) =>
  !!a && !!b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/**
 * Purpose: a line routed again on opening, with every leg that failed now but was routed when it was saved put
 * back as saved (same two points), so streets that have not loaded yet never turn a saved route into dashed
 * straight lines. Totals follow the legs put back; their errors leave the issues.
 */
export function keepRoutedLegs(view: LineView, saved: LineView | null | undefined): LineView {
  if (!saved?.legs.length) return view;
  const at = (v: LineView, id: number) => v.points.find((p) => p.id === id)?.lonlat;
  let dLength = 0;
  let dTime = 0;
  const dropped = new Set<string>();
  const legs = view.legs.map((leg) => {
    if (leg.status !== "error") return leg;
    const [a, b] = [at(view, leg.from), at(view, leg.to)];
    const old = saved.legs.find(
      (s) => s.status !== "error" && same(at(saved, s.from), a) && same(at(saved, s.to), b),
    );
    if (!old) return leg;
    dLength += old.length_m - leg.length_m;
    dTime += old.time_s - leg.time_s;
    if (leg.message) dropped.add(leg.message);
    return { ...old, index: leg.index, from: leg.from, to: leg.to };
  });
  if (!dropped.size && legs.every((l, i) => l === view.legs[i])) return view;
  return {
    ...view,
    legs,
    length_m: view.length_m + dLength,
    time_s: view.time_s + dTime,
    issues: view.issues.filter((m) => !dropped.has(m)),
    ...(view.issue_msgs
      ? { issue_msgs: view.issue_msgs.filter((_, k) => !dropped.has(view.issues[k] ?? "")) }
      : {}),
  };
}

/**
 * Whether `now` routes more of the same points than `before`: more legs found, or as many legs and more depot runs.
 * Streets that load after a line was saved can complete its route; the editor then saves the fuller route,
 * which Tables, costs and the appraisal read. A route with fewer parts found never replaces a saved one.
 * A saved route worked out for other points than the line's (points removed or added without routing it again)
 * is replaced when the route for the line's points leaves out fewer legs, or as many legs and fewer depot runs.
 */
export function routesMore(now: LineView, before: LineView): boolean {
  if (now.points.length !== before.points.length) {
    const missing = (v: LineView) => {
      const p = unroutedParts(v);
      return [p?.legs ?? 0, p?.depotRuns ?? 0];
    };
    const [legs, runs] = missing(now);
    const [legsBefore, runsBefore] = missing(before);
    return legs! < legsBefore! || (legs === legsBefore && runs! < runsBefore!);
  }
  const found = (v: LineView) => [
    v.legs.filter((l) => l.status !== "error").length,
    v.depot_trips.filter((d) => d.status !== "error").length,
  ];
  const [legs, runs] = found(now);
  const [legsBefore, runsBefore] = found(before);
  return legs! > legsBefore! || (legs === legsBefore && runs! > runsBefore!);
}

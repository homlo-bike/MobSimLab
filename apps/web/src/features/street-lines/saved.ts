/** A street line as the project saves it (drawing kind "street-lines"). */
import type { StreetLineInput } from "../journey-planner/network";
import { fullTiming, MODES, type Timing } from "./modes";
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
   * The route as the tool last computed it, so the journey planner can ride the line before the tool opens.
   * The tool routes the points again from the streets when it opens.
   */
  view: LineView;
}

/** The project's street lines; the street line tool edits one at a time. */
export interface StreetLinesDoc {
  lines: SavedStreetLine[];
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
    color: MODES[line.profile.mode]?.color ?? MODES.bus.color,
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
 * Purpose: the street tiles a saved line runs over, as "x/y" keys: under its route and its points, so all of its
 * streets load when it opens, not only those on screen (a long line opens zoomed to its first point).
 * At most `max` tiles, nearest the line's points first.
 */
export function lineTiles(line: SavedStreetLine, max = 64): string[] {
  const keys = new Set<string>();
  const add = ([lon, lat]: LonLat) => keys.add(`${tileX(lon)}/${tileY(lat)}`);
  line.points.forEach((p) => add(p.lonlat));
  if (line.depot) add(line.depot);
  for (const leg of line.view?.legs ?? []) leg.coords.forEach(add);
  return [...keys].slice(0, max);
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
  };
}

/**
 * Whether `now` routes more of the same points than `before`: more legs found, or as many legs and more depot runs.
 * Streets that load after a line was saved can complete its route; the editor then saves the fuller route,
 * which Tables, costs and the appraisal read. A route with fewer parts found never replaces a saved one.
 */
export function routesMore(now: LineView, before: LineView): boolean {
  if (now.points.length !== before.points.length) return false;
  const found = (v: LineView) => [
    v.legs.filter((l) => l.status !== "error").length,
    v.depot_trips.filter((d) => d.status !== "error").length,
  ];
  const [legs, runs] = found(now);
  const [legsBefore, runsBefore] = found(before);
  return legs! > legsBefore! || (legs === legsBefore && runs! > runsBefore!);
}

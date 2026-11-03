/** A street line as the project saves it (drawing kind "street-lines"). */
import type { StreetLineInput } from "../journey-planner/network";
import { MODES, type Timing } from "./modes";
import type { LineView, LonLat, PointKind, RoutingRules, VehicleProfile } from "./types";

/** One point as the planner placed it; `name` only when the planner named it (otherwise the street's name). */
export interface SavedPoint {
  lonlat: LonLat;
  kind: PointKind;
  name: string | null;
}

/** One street line: what the planner drew and set, plus the route last computed from it. */
export interface SavedStreetLine {
  name: string;
  profile: VehicleProfile;
  rules: RoutingRules;
  timing: Timing;
  points: SavedPoint[];
  depot: LonLat | null;
  /** The terminals the depot runs serve, as indexes into `points`. */
  depotStops: { out?: number; in?: number };
  /**
   * The route as the tool last computed it, so the journey planner can ride the line before the tool opens.
   * The tool routes the points again from the streets when it opens.
   */
  view: LineView;
}

/** The project's street lines. The street line tool edits one line for now. */
export interface StreetLinesDoc {
  lines: SavedStreetLine[];
}

/** Purpose: the journey planner's view of a saved line, or null if it has fewer than two points. */
export function lineInput(line: SavedStreetLine | undefined): StreetLineInput | null {
  if (!line || line.view.points.length < 2) return null;
  return {
    name: line.name,
    mode: line.profile.mode,
    color: MODES[line.profile.mode]?.color ?? MODES.bus.color,
    view: line.view,
    dwellS: line.timing.dwellS,
    headwayMin: line.timing.headwayMin,
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

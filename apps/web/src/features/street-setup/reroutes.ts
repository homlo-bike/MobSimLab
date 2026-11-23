import type { LineView, LonLat } from "../street-lines/types";
import { layoutOf } from "./sections";
import type { StreetInfo, StreetSetup } from "./types";

/** A saved street line that a change of the street setups would send round a street. */
export interface Reroute {
  /** The line's name. */
  line: string;
  /** The street's name ("" when unnamed). */
  street: string;
  way: number;
}

/**
 * Purpose: which ways buses may drive along a street with its setup, `[forward, backward]` along the way as
 * drawn, by the rules of the street routing (Rust `setup::apply` and `graph::bus_directions`): a custom
 * layout lets buses in only with a lane they may use, in the directions its lanes run; otherwise one-way
 * streets let them drive one way only. A pedestrian street without a bus lane is closed to buses.
 */
export function busDirections(info: StreetInfo, setup: StreetSetup | undefined): [boolean, boolean] {
  if (setup?.sections) {
    const l = layoutOf(setup.sections);
    if (!l.busForward && !l.busBackward) return [false, false];
    return [l.busForward || l.carsForward > 0, l.busBackward || l.carsBackward > 0];
  }
  if (info.class === "pedestrian" && !(setup?.bus_lane ?? info.bus_lane)) return [false, false];
  const oneway = setup?.oneway ?? info.oneway;
  return [true, !oneway];
}

/** Metres per degree of latitude. */
const M_PER_DEG = 111_195;

/** Purpose: where a point lies along a polyline: distance from the line and position along it, m. */
function along(line: readonly LonLat[], p: LonLat): { d: number; s: number } {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const xy = (q: LonLat) => [q[0] * M_PER_DEG * k, q[1] * M_PER_DEG] as const;
  const [px, py] = xy(p);
  let best = { d: Infinity, s: 0 };
  let s0 = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = xy(line[i]!);
    const [bx, by] = xy(line[i + 1]!);
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    const len = Math.sqrt(l2);
    if (d < best.d) best = { d, s: s0 + t * len };
    s0 += len;
  }
  return best;
}

/** A route point this close to a street counts as on it, m. */
const ON_STREET_M = 6;

/**
 * Purpose: the directions a route drives along a street: `[forward, backward]` along the way as drawn, from
 * the route's points on the street. A route with fewer than two points on it counts as both, to be safe.
 */
export function drivenDirections(route: readonly LonLat[], street: readonly LonLat[]): [boolean, boolean] {
  const on = route.map((p) => along(street, p)).filter((a) => a.d <= ON_STREET_M);
  if (on.length < 2) return [true, true];
  let fwd = false;
  let bwd = false;
  for (let i = 0; i + 1 < on.length; i++) {
    const ds = on[i + 1]!.s - on[i]!.s;
    if (ds > 0.5) fwd = true;
    if (ds < -0.5) bwd = true;
  }
  return fwd || bwd ? [fwd, bwd] : [true, true];
}

/**
 * Purpose: the saved street lines a change of the street setups would send round a street: lines driving
 * along a street in a direction the change closes to buses. Streets whose shape has not loaded are skipped.
 */
export function reroutedLines(
  before: readonly StreetSetup[],
  after: readonly StreetSetup[],
  infos: ReadonlyMap<number, StreetInfo>,
  lines: readonly { name: string; view: LineView }[],
): Reroute[] {
  const out: Reroute[] = [];
  const ways = new Set([...before, ...after].map((s) => s.way));
  for (const way of ways) {
    const info = infos.get(way);
    if (!info) continue;
    const [bf, bb] = busDirections(
      info,
      before.find((s) => s.way === way),
    );
    const [af, ab] = busDirections(
      info,
      after.find((s) => s.way === way),
    );
    const lostF = bf && !af;
    const lostB = bb && !ab;
    if (!lostF && !lostB) continue;
    for (const l of lines) {
      const hit = l.view.legs.some((leg) => {
        if (!leg.ways.includes(way)) return false;
        const [f, b] = drivenDirections(leg.coords, info.coords);
        return (lostF && f) || (lostB && b);
      });
      if (hit) out.push({ line: l.name, street: info.name, way });
    }
  }
  return out;
}

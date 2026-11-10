/**
 * Schematic layout in the browser (ADR-0025 fallback, ADR-0040): stations start at their geographic place and
 * are moved until every edge runs at a multiple of 45° (octilinear), edges are not too short, and stations
 * keep apart. Stations the planner dragged stay where they put them. Positions are metres east and north of
 * the diagram's origin, so a dragged station keeps its place when lines are added.
 */
import type { LonLat } from "../street-lines/types";
import type { SchematicNetwork } from "./lines";

export type Pt = [number, number];

/** Purpose: metres east and north of `origin` for a point (equirectangular). */
export function project(origin: LonLat, p: LonLat): Pt {
  const k = 111_320;
  return [(p[0] - origin[0]) * k * Math.cos((origin[1] * Math.PI) / 180), (p[1] - origin[1]) * k];
}

/** Purpose: an origin for a network that stays put when stations move a little: the mean, to 0.01°. */
export function defaultOrigin(net: SchematicNetwork): LonLat {
  if (!net.stations.length) return [0, 0];
  const m = (i: 0 | 1) => net.stations.reduce((a, s) => a + s.lonlat[i], 0) / net.stations.length;
  return [Math.round(m(0) * 100) / 100, Math.round(m(1) * 100) / 100];
}

/** Purpose: the distinct station pairs the lines run between, as `[a, b]` with `a < b`. */
export function edgesOf(net: SchematicNetwork, lines = net.lines): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const l of lines)
    for (let i = 1; i < l.stops.length; i++) {
      const a = Math.min(l.stops[i - 1]!, l.stops[i]!);
      const b = Math.max(l.stops[i - 1]!, l.stops[i]!);
      const k = `${a}-${b}`;
      if (a === b || seen.has(k)) continue;
      seen.add(k);
      out.push([a, b]);
    }
  return out;
}

/** Purpose: the median of a list (0 when empty). */
function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Purpose: the direction (radians) at a multiple of 45° nearest to a vector's direction. */
export function octilinear(dx: number, dy: number): number {
  const step = Math.PI / 4;
  return Math.round(Math.atan2(dy, dx) / step) * step;
}

export interface LayoutResult {
  /** Diagram position of every station, metres from the origin. */
  pos: Pt[];
  /** The typical edge length (median of the geographic edge lengths), metres: the diagram's unit. */
  unit: number;
}

/**
 * Purpose: lay out a network octilinearly.
 * Inputs: the network, the diagram origin, the planner's pinned positions by station key, and whether to
 * straighten edges to 45° steps (off: geographic positions, only spread apart).
 * Output: a position per station and the diagram unit. No side effects; deterministic.
 */
export function layout(
  net: SchematicNetwork,
  origin: LonLat,
  pins: Readonly<Record<string, Pt>> = {},
  straighten = true,
): LayoutResult {
  const geo = net.stations.map((s) => project(origin, s.lonlat));
  const pos: Pt[] = net.stations.map((s, i) => {
    const p = pins[s.key];
    return p ? [p[0], p[1]] : [geo[i]![0], geo[i]![1]];
  });
  const fixed = net.stations.map((s) => s.key in pins);
  const edges = edgesOf(net);
  const unit = Math.max(
    50,
    median(edges.map(([a, b]) => Math.hypot(geo[b]![0] - geo[a]![0], geo[b]![1] - geo[a]![1]))),
  );
  const minEdge = unit * 0.7;
  const minGap = unit * 0.55;
  const n = pos.length;
  const iterations = straighten ? 400 : 120;
  for (let it = 0; it < iterations; it++) {
    const rate = 0.5 * (1 - it / iterations) + 0.05;
    const move: Pt[] = pos.map(() => [0, 0]);
    const count = new Array<number>(n).fill(0);
    // Each edge pulls its ends towards the nearest 45° direction, at least `minEdge` long.
    for (const [a, b] of edges) {
      const pa = pos[a]!;
      const pb = pos[b]!;
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const len = Math.hypot(dx, dy) || 1e-6;
      const ang = straighten ? octilinear(dx, dy) : Math.atan2(dy, dx);
      const want = Math.max(len, minEdge);
      const tx = Math.cos(ang) * want;
      const ty = Math.sin(ang) * want;
      const ex = (tx - dx) / 2;
      const ey = (ty - dy) / 2;
      move[a]![0] -= ex;
      move[a]![1] -= ey;
      move[b]![0] += ex;
      move[b]![1] += ey;
      count[a]! += 1;
      count[b]! += 1;
    }
    // Stations closer than `minGap` push apart.
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j]![0] - pos[i]![0];
        const dy = pos[j]![1] - pos[i]![1];
        const d = Math.hypot(dx, dy);
        if (d >= minGap) continue;
        const ux = d > 1e-6 ? dx / d : Math.cos(i + j);
        const uy = d > 1e-6 ? dy / d : Math.sin(i + j);
        const push = (minGap - d) / 2;
        move[i]![0] -= ux * push;
        move[i]![1] -= uy * push;
        move[j]![0] += ux * push;
        move[j]![1] += uy * push;
        count[i]! += 1;
        count[j]! += 1;
      }
    // A station must not sit on a section it does not belong to: push it off sideways.
    const clear = unit * 0.35;
    for (let i = 0; i < n; i++)
      for (const [a, b] of edges) {
        if (a === i || b === i) continue;
        const pa = pos[a]!;
        const pb = pos[b]!;
        const ex = pb[0] - pa[0];
        const ey = pb[1] - pa[1];
        const l2 = ex * ex + ey * ey;
        if (l2 < 1e-9) continue;
        const t = ((pos[i]![0] - pa[0]) * ex + (pos[i]![1] - pa[1]) * ey) / l2;
        if (t <= 0.05 || t >= 0.95) continue;
        const cx = pa[0] + ex * t;
        const cy = pa[1] + ey * t;
        let dx = pos[i]![0] - cx;
        let dy = pos[i]![1] - cy;
        let d = Math.hypot(dx, dy);
        if (d >= clear) continue;
        if (d < 1e-6) {
          dx = -ey;
          dy = ex;
          d = Math.sqrt(l2);
        }
        const push = clear - d;
        move[i]![0] += (dx / d) * push;
        move[i]![1] += (dy / d) * push;
        move[a]![0] -= (dx / d) * push * 0.5;
        move[a]![1] -= (dy / d) * push * 0.5;
        move[b]![0] -= (dx / d) * push * 0.5;
        move[b]![1] -= (dy / d) * push * 0.5;
        count[i]! += 1;
        count[a]! += 1;
        count[b]! += 1;
      }
    for (let i = 0; i < n; i++) {
      if (fixed[i] || !count[i]) continue;
      // A weak pull back to the geographic place keeps the map recognisable.
      const pull = straighten ? 0.004 : 0.02;
      const gx = (geo[i]![0] - pos[i]![0]) * pull;
      const gy = (geo[i]![1] - pos[i]![1]) * pull;
      pos[i]![0] += (move[i]![0] / count[i]!) * rate * 2 + gx;
      pos[i]![1] += (move[i]![1] / count[i]!) * rate * 2 + gy;
    }
  }
  if (straighten) {
    // Make nearly straight sections exactly straight, so they are not drawn with a small jog.
    const near = unit * 0.3;
    for (let pass = 0; pass < 12; pass++)
      for (const [a, b] of edges) {
        if (fixed[a] && fixed[b]) continue;
        const pa = pos[a]!;
        const pb = pos[b]!;
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        // Where each end must move (dx, dy) to make the section horizontal, vertical or diagonal.
        let fix: Pt | null = null;
        if (Math.abs(dy) < near && Math.abs(dy) < Math.abs(dx)) fix = [0, dy];
        else if (Math.abs(dx) < near && Math.abs(dx) < Math.abs(dy)) fix = [dx, 0];
        else {
          const diff = Math.abs(dx) - Math.abs(dy);
          if (Math.abs(diff) < near)
            fix = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) * diff, 0] : [0, -Math.sign(dy) * diff];
        }
        if (!fix || (Math.abs(fix[0]) < 1e-6 && Math.abs(fix[1]) < 1e-6)) continue;
        // Move b by `fix` towards a (or a away by the opposite), split between the free ends.
        const wa = fixed[a] ? 0 : fixed[b] ? 1 : 0.5;
        const wb = 1 - wa;
        pa[0] += fix[0] * wa;
        pa[1] += fix[1] * wa;
        pb[0] -= fix[0] * wb;
        pb[1] -= fix[1] * wb;
      }
  }
  return { pos, unit };
}

/**
 * Purpose: where a dragged station goes with snapping on: on the nearest 45° ray from one of its neighbours,
 * when the pointer is within `tolerance` of it; else the pointer itself.
 */
export function snapToNeighbours(p: Pt, neighbours: readonly Pt[], tolerance: number): Pt {
  let best: Pt = p;
  let bestD = tolerance;
  for (const q of neighbours) {
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    const ang = octilinear(dx, dy);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const t = Math.max(0, dx * ux + dy * uy);
    const s: Pt = [q[0] + ux * t, q[1] + uy * t];
    const d = Math.hypot(p[0] - s[0], p[1] - s[1]);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

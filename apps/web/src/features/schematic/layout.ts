/**
 * Schematic layout in the browser (ADR-0025 fallback, ADR-0041): stations start at their geographic place and
 * are moved until every edge runs at a multiple of 45° (octilinear), edges are not too short, and stations
 * keep apart. Long runs without stops (an airport bus, a suburban branch) can be shortened, so they do not
 * squeeze the centre into a corner. Stations the planner dragged stay where they put them. Positions are metres
 * east and north of the diagram's origin, so a dragged station keeps its place when lines are added.
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

/** Longest section without stops offered for shortening, in typical sections (0: keep ground lengths). */
export const LONG_RUN_CHOICES = [0, 2, 3, 5] as const;
/** Default longest section: three typical sections. */
export const DEFAULT_LONG_RUN = 3;

/**
 * Purpose: the stations on one side of a section: those reached from `from` without using the section `a`–`b`.
 * Output: the set, or null when `from` also reaches the other end (the section is not a bridge).
 */
function sideOf(adj: readonly number[][], a: number, b: number, from: number): Set<number> | null {
  const other = from === a ? b : a;
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of adj[i]!) {
      if ((i === a && j === b) || (i === b && j === a) || seen.has(j)) continue;
      if (j === other) return null;
      seen.add(j);
      stack.push(j);
    }
  }
  return seen;
}

/**
 * Purpose: start places with long runs shortened (FR-SCH-01): every section longer than `maxLen` whose removal
 * splits the network (an airport bus, the end of a branch) is shortened to `maxLen` by moving the whole part
 * beyond it towards the rest, so that part keeps its own shape. The part moved is the one without stations the
 * planner placed, else the smaller one, else the one farther from the middle. Sections in a loop are left to
 * the layout's springs.
 * Inputs: geographic places (metres), the sections, the longest allowed length (metres), which stations are
 * placed by the planner. Output: new places; the input is not changed.
 */
export function shortenLongRuns(
  geo: readonly Pt[],
  edges: readonly [number, number][],
  maxLen: number,
  fixed: readonly boolean[],
): Pt[] {
  const pos: Pt[] = geo.map((p) => [p[0], p[1]]);
  if (!(maxLen > 0) || !pos.length) return pos;
  const adj: number[][] = pos.map(() => []);
  for (const [a, b] of edges) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  const mid: Pt = [
    pos.reduce((s, p) => s + p[0], 0) / pos.length,
    pos.reduce((s, p) => s + p[1], 0) / pos.length,
  ];
  const len = ([a, b]: readonly [number, number]) =>
    Math.hypot(pos[b]![0] - pos[a]![0], pos[b]![1] - pos[a]![1]);
  // Longest first, so a chain of long runs is shortened from its far end inwards consistently.
  const order = edges.filter((e) => len(e) > maxLen).sort((x, y) => len(y) - len(x));
  for (const e of order) {
    const [a, b] = e;
    const l = len(e);
    if (l <= maxLen) continue;
    const sideA = sideOf(adj, a, b, a);
    if (!sideA) continue;
    const sideB = sideOf(adj, a, b, b)!;
    const pinned = (s: Set<number>) => [...s].some((i) => fixed[i]);
    const far = (s: Set<number>) =>
      [...s].reduce((m, i) => Math.max(m, Math.hypot(pos[i]![0] - mid[0], pos[i]![1] - mid[1])), 0);
    let moveB: boolean;
    if (pinned(sideA) !== pinned(sideB)) moveB = pinned(sideA);
    else if (pinned(sideA)) continue;
    else if (sideA.size !== sideB.size) moveB = sideB.size < sideA.size;
    else moveB = far(sideB) >= far(sideA);
    // Move the chosen part along the section towards the other end by the extra length.
    const k = (l - maxLen) / l;
    const dx = (pos[b]![0] - pos[a]![0]) * k;
    const dy = (pos[b]![1] - pos[a]![1]) * k;
    for (const i of moveB ? sideB : sideA) {
      pos[i]![0] += moveB ? -dx : dx;
      pos[i]![1] += moveB ? -dy : dy;
    }
  }
  return pos;
}

export interface LayoutResult {
  /** Diagram position of every station, metres from the origin. */
  pos: Pt[];
  /** The typical edge length (median of the geographic edge lengths), metres: the diagram's unit. */
  unit: number;
}

/**
 * Purpose: lay out a network octilinearly.
 * Inputs: the network, the diagram origin, the planner's pinned positions by station key, whether to
 * straighten edges to 45° steps (off: geographic positions, only spread apart), and the longest section
 * without stops in typical sections (0 keeps ground lengths; see `shortenLongRuns`).
 * Output: a position per station and the diagram unit. No side effects; deterministic.
 */
export function layout(
  net: SchematicNetwork,
  origin: LonLat,
  pins: Readonly<Record<string, Pt>> = {},
  straighten = true,
  longRun = 0,
): LayoutResult {
  const ground = net.stations.map((s) => project(origin, s.lonlat));
  const fixed = net.stations.map((s) => s.key in pins);
  const edges = edgesOf(net);
  const unit = Math.max(
    50,
    median(edges.map(([a, b]) => Math.hypot(ground[b]![0] - ground[a]![0], ground[b]![1] - ground[a]![1]))),
  );
  const maxEdge = longRun > 0 ? unit * longRun : Infinity;
  // The places the layout starts from and is weakly pulled back to: the ground, with long runs shortened.
  const geo = longRun > 0 ? shortenLongRuns(ground, edges, maxEdge, fixed) : ground;
  const pos: Pt[] = net.stations.map((s, i) => {
    const p = pins[s.key];
    return p ? [p[0], p[1]] : [geo[i]![0], geo[i]![1]];
  });
  const minEdge = unit * 0.7;
  const minGap = unit * 0.55;
  const n = pos.length;
  const clear = unit * 0.35;
  const cell = Math.max(minGap, clear);
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
      const want = Math.min(Math.max(len, minEdge), Math.max(maxEdge, minEdge));
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
    // Stations closer than `minGap` push apart (only stations in neighbouring grid cells can be that close;
    // they are taken in the same order as checking every pair, so the result is the same).
    const near = nearGrid(pos, edges, cell, clear);
    for (let i = 0; i < n; i++)
      for (const j of near.stationsAfter(i)) {
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
    // A station must not sit on a section it does not belong to: push it off sideways (only sections whose
    // box, widened by `clear`, covers the station's grid cell can be that close; in the sections' order).
    for (let i = 0; i < n; i++)
      for (const e of near.sectionsAt(i)) {
        const [a, b] = edges[e]!;
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

/** Sections whose widened box covers more grid cells than this are checked against every station. */
const MAX_SECTION_CELLS = 400;

/**
 * Purpose: a grid over the stations for the layout's close-range forces, so each step looks at nearby stations
 * and sections only, not every pair (a city-wide network of ~500 stations took seconds).
 * Inputs: station places, sections, the grid cell size (at least the push-apart distance) and the clearance
 * round sections. Output: for a station, the later stations in its own and the eight neighbouring cells, and
 * the sections whose box widened by `clear` touches its cell; both in increasing order.
 */
function nearGrid(pos: readonly Pt[], edges: readonly [number, number][], cell: number, clear: number) {
  const cx = (x: number) => Math.floor(x / cell);
  // A number per cell (cells within ±2^20 of the origin on each axis, far beyond any network).
  const key = (x: number, y: number) => (x + 1_048_576) * 2_097_152 + (y + 1_048_576);
  const stations = new Map<number, number[]>();
  pos.forEach((p, i) => {
    const k = key(cx(p[0]), cx(p[1]));
    const list = stations.get(k);
    if (list) list.push(i);
    else stations.set(k, [i]);
  });
  const sections = new Map<number, number[]>();
  const everywhere: number[] = [];
  edges.forEach(([a, b], e) => {
    const pa = pos[a]!;
    const pb = pos[b]!;
    const x0 = cx(Math.min(pa[0], pb[0]) - clear);
    const x1 = cx(Math.max(pa[0], pb[0]) + clear);
    const y0 = cx(Math.min(pa[1], pb[1]) - clear);
    const y1 = cx(Math.max(pa[1], pb[1]) + clear);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_SECTION_CELLS) {
      everywhere.push(e);
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = key(x, y);
        const list = sections.get(k);
        if (list) list.push(e);
        else sections.set(k, [e]);
      }
  });
  const cellOf = (i: number) => [cx(pos[i]![0]), cx(pos[i]![1])] as const;
  return {
    stationsAfter(i: number): number[] {
      const [x, y] = cellOf(i);
      const out: number[] = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of stations.get(key(x + dx, y + dy)) ?? []) if (j > i) out.push(j);
      return out.sort((p, q) => p - q);
    },
    sectionsAt(i: number): number[] {
      const [x, y] = cellOf(i);
      const here = sections.get(key(x, y)) ?? [];
      if (!everywhere.length) return here;
      return [...here, ...everywhere].sort((p, q) => p - q);
    },
  };
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

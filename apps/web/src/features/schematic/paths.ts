/**
 * Drawing geometry of a schematic: lines that share a section run side by side in a fixed order, and corners
 * are rounded when curves are on (ADR-0040). All coordinates are screen coordinates (y down).
 */
import type { Pt } from "./layout";
import type { SchematicLine } from "./lines";

/** Purpose: per section (`a-b`, `a < b`), the ids of the lines on it, in the order of `lines`. */
export function bundles(lines: readonly SchematicLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of lines)
    for (let i = 1; i < l.stops.length; i++) {
      const a = Math.min(l.stops[i - 1]!, l.stops[i]!);
      const b = Math.max(l.stops[i - 1]!, l.stops[i]!);
      const k = `${a}-${b}`;
      const ids = out.get(k) ?? [];
      if (!ids.includes(l.id)) ids.push(l.id);
      out.set(k, ids);
    }
  return out;
}

/** Purpose: the intersection of the lines p1 + t·d1 and p2 + s·d2, or null when they are (almost) parallel. */
function intersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/**
 * Purpose: the drawn route of a section from `p` to `q` with every part at a multiple of 45°: when the
 * section itself is not, it runs straight for half of the extra length, then diagonally, then straight again.
 * Output: the points from `p` to `q`, both included.
 */
export function octiRoute(p: Pt, q: Pt): Pt[] {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const tol = 0.5;
  if (ax < tol || ay < tol || Math.abs(ax - ay) < tol) return [p, q];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const half = (Math.max(ax, ay) - Math.min(ax, ay)) / 2;
  const a: Pt = ax > ay ? [p[0] + sx * half, p[1]] : [p[0], p[1] + sy * half];
  const b: Pt = ax > ay ? [q[0] - sx * half, q[1]] : [q[0], q[1] - sy * half];
  return [p, a, b, q];
}

/** A drawn line: its points, and which of them are stations (the others are bends between stations). */
export interface DrawnLine {
  pts: Pt[];
  station: boolean[];
}

/**
 * Purpose: the drawn polyline of one line: each section routed at 45° steps (when `octi`), shifted sideways
 * by the line's place in the section's bundle, corners joined where the shifted parts meet.
 * Inputs: the line, the station positions (screen), the bundles, the gap between parallel lines.
 */
export function offsetPolyline(
  line: SchematicLine,
  pos: readonly Pt[],
  bundle: Map<string, string[]>,
  gap: number,
  octi = true,
): DrawnLine {
  const segs: { a: Pt; b: Pt; endsAtStation: boolean }[] = [];
  for (let i = 1; i < line.stops.length; i++) {
    const from = line.stops[i - 1]!;
    const to = line.stops[i]!;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const ids = bundle.get(`${lo}-${hi}`) ?? [line.id];
    const off = (ids.indexOf(line.id) - (ids.length - 1) / 2) * gap;
    // Route and shift as seen from `lo` to `hi`, so every line in the bundle agrees.
    const route = octi ? octiRoute(pos[lo]!, pos[hi]!) : [pos[lo]!, pos[hi]!];
    const parts: { a: Pt; b: Pt }[] = [];
    for (let k = 1; k < route.length; k++) {
      const p = route[k - 1]!;
      const q = route[k]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / len;
      const ny = (q[0] - p[0]) / len;
      parts.push({ a: [p[0] + nx * off, p[1] + ny * off], b: [q[0] + nx * off, q[1] + ny * off] });
    }
    const ordered = from === lo ? parts : parts.reverse().map(({ a, b }) => ({ a: b, b: a }));
    ordered.forEach((s, k) => segs.push({ ...s, endsAtStation: k === ordered.length - 1 }));
  }
  if (!segs.length) return { pts: line.stops.map((s) => pos[s]!), station: line.stops.map(() => true) };
  const pts: Pt[] = [segs[0]!.a];
  const station: boolean[] = [true];
  for (let i = 1; i < segs.length; i++) {
    const s1 = segs[i - 1]!;
    const s2 = segs[i]!;
    const d1: Pt = [s1.b[0] - s1.a[0], s1.b[1] - s1.a[1]];
    const d2: Pt = [s2.b[0] - s2.a[0], s2.b[1] - s2.a[1]];
    const x = intersect(s1.a, d1, s2.a, d2);
    const mid: Pt = [(s1.b[0] + s2.a[0]) / 2, (s1.b[1] + s2.a[1]) / 2];
    // A sharp hairpin would put the joint far away: keep it near the corner.
    pts.push(x && Math.hypot(x[0] - mid[0], x[1] - mid[1]) < gap * 4 ? x : mid);
    station.push(s1.endsAtStation);
  }
  pts.push(segs[segs.length - 1]!.b);
  station.push(true);
  return { pts, station };
}

const f = (v: number) => (Math.round(v * 10) / 10).toString();

/**
 * Purpose: an SVG path through the points; corner `i` is rounded with a quadratic curve that starts and ends
 * at most `radius(i)` (and at most half a part) from the corner. A radius of 0 keeps the corner sharp.
 */
export function pathD(pts: readonly Pt[], radius: number | ((i: number) => number)): string {
  if (!pts.length) return "";
  const rOf = typeof radius === "number" ? () => radius : radius;
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1]!;
    const next = pts[i + 1];
    const want = next ? rOf(i) : 0;
    if (!next || want <= 0) {
      d += `L${f(p[0])} ${f(p[1])}`;
      continue;
    }
    const l1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const l2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const cross = (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
    if (l1 < 1e-6 || l2 < 1e-6 || Math.abs(cross) / (l1 * l2) < 0.02) {
      d += `L${f(p[0])} ${f(p[1])}`;
      continue;
    }
    const r = Math.min(want, l1 / 2, l2 / 2);
    const a: Pt = [p[0] - ((p[0] - prev[0]) / l1) * r, p[1] - ((p[1] - prev[1]) / l1) * r];
    const b: Pt = [p[0] + ((next[0] - p[0]) / l2) * r, p[1] + ((next[1] - p[1]) / l2) * r];
    d += `L${f(a[0])} ${f(a[1])}Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return d;
}

/** The eight label places around a station, clockwise from east (screen: y down). */
export const LABEL_DIRS: readonly Pt[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * Purpose: the label place (index into `LABEL_DIRS`) farthest from the directions the station's sections
 * leave in; ties prefer east, then west, then the others.
 */
export function autoLabel(at: Pt, neighbours: readonly Pt[]): number {
  const prefer = [0, 4, 6, 2, 7, 1, 5, 3];
  let best = 0;
  let bestScore = -Infinity;
  for (const k of prefer) {
    const [ux, uy] = LABEL_DIRS[k]!;
    let worst = 2;
    for (const q of neighbours) {
      const dx = q[0] - at[0];
      const dy = q[1] - at[1];
      const len = Math.hypot(dx, dy) || 1;
      worst = Math.min(worst, 1 - (ux * dx + uy * dy) / len);
    }
    const score = worst - prefer.indexOf(k) * 0.001;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/** A box on screen: left, top, right, bottom. */
export type Box = [number, number, number, number];

/** Purpose: the box a label takes at a station, for a direction, gap from the station and text size. */
export function labelBox(at: Pt, dir: number, gap: number, text: string, size: number): Box {
  const [ux, uy] = LABEL_DIRS[dir]!;
  const w = text.length * size * 0.56;
  const h = size * 1.2;
  const x = at[0] + ux * gap;
  const y = at[1] + uy * gap;
  const left = ux > 0.3 ? x : ux < -0.3 ? x - w : x - w / 2;
  const top = uy > 0.3 ? y : uy < -0.3 ? y - h : y - h / 2;
  return [left, top, left + w, top + h];
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Purpose: whether the segment p–q crosses or lies in a box. */
function segmentHits(p: Pt, q: Pt, b: Box): boolean {
  // Sample along the segment: labels are larger than the steps, so this is exact enough.
  const n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4));
  for (let i = 0; i <= n; i++) {
    const x = p[0] + ((q[0] - p[0]) * i) / n;
    const y = p[1] + ((q[1] - p[1]) * i) / n;
    if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return true;
  }
  return false;
}

/**
 * Purpose: a label place for every station that does not cover another label, a station or a line, where one
 * exists. Stations with a fixed place (`fixed`) keep it; the others try the places in the order `autoLabel`
 * prefers and take the first free one (else the one with the fewest hits).
 * Inputs: stations to label (index, position, name, radius, neighbours' positions), the drawn lines' points,
 * the fixed places, the text size. Output: direction per station index.
 */
export function placeLabels(
  stations: readonly { i: number; at: Pt; name: string; r: number; neighbours: readonly Pt[] }[],
  lines: readonly (readonly Pt[])[],
  fixed: ReadonlyMap<number, number>,
  size: number,
): Map<number, number> {
  const out = new Map<number, number>();
  const placed: Box[] = [];
  const dots: Box[] = stations.map((s) => [s.at[0] - s.r, s.at[1] - s.r, s.at[0] + s.r, s.at[1] + s.r]);
  // Stations with fixed places first, then those with more lines (they are harder to place).
  const order = [...stations].sort(
    (a, b) => Number(fixed.has(b.i)) - Number(fixed.has(a.i)) || b.neighbours.length - a.neighbours.length,
  );
  for (const s of order) {
    const first = fixed.get(s.i) ?? autoLabel(s.at, s.neighbours);
    const tries = fixed.has(s.i) ? [first] : [first, ...[0, 4, 6, 2, 7, 1, 5, 3].filter((k) => k !== first)];
    let best = first;
    let bestHits = Infinity;
    for (const k of tries) {
      const box = labelBox(s.at, k, s.r + 7, s.name, size);
      let hits = 0;
      for (const p of placed) if (overlaps(box, p)) hits += 3;
      dots.forEach((d, j) => {
        if (stations[j]!.i !== s.i && overlaps(box, d)) hits += 2;
      });
      for (const l of lines)
        for (let j = 1; j < l.length; j++) if (segmentHits(l[j - 1]!, l[j]!, box)) hits += 1;
      if (hits < bestHits) {
        bestHits = hits;
        best = k;
        if (hits === 0) break;
      }
    }
    out.set(s.i, best);
    placed.push(labelBox(s.at, best, s.r + 7, s.name, size));
  }
  return out;
}

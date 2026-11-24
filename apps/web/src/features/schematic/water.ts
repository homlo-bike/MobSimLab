/**
 * Water on the network map (ADR-0041 §8): sea, lakes and rivers from OpenStreetMap, fetched for the
 * network's box (`GET /api/street-network/water`) and bent along with the stations, so the river still runs
 * between the stations it runs between on the ground.
 */
import { get } from "../../session/api";
import type { LonLat } from "../street-lines/types";
import { project, type Pt } from "./layout";
import { octiRoute } from "./paths";
import { withProject } from "../../geodata/projectData";
import { hashText } from "../../projects/inputKey";
import { codeVersion, recallAnswer, rememberAnswer } from "../../projects/keptAnswers";

/** What the API returns (apps/api/src/street-network/water.ts), `[lon, lat]`. */
export interface WaterShapes {
  areas: LonLat[][];
  rivers: { line: LonLat[]; kind: "river" | "canal" }[];
  sea: LonLat[][];
}

export type WaterBox = [number, number, number, number];
export type WaterLoader = (box: WaterBox) => Promise<WaterShapes>;

/** The API answers boxes of at most 1° a side. */
const MAX_SPAN = 1;

export const loadWater: WaterLoader = (b) =>
  get<WaterShapes>(withProject(`/api/street-network/water?bbox=${b.map((x) => x.toFixed(4)).join(",")}`));

/**
 * Purpose: the box to fetch water for: the stations' box with a margin of a fifth of its size (at least
 * 0.01°), cut to 1° a side around its centre. Output: `[west, south, east, north]`, or null without stations.
 */
export function waterBox(points: readonly LonLat[]): WaterBox | null {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box = (lo: number, hi: number): [number, number] => {
    const m = Math.max(0.01, (hi - lo) * 0.2);
    let a = lo - m;
    let b = hi + m;
    if (b - a > MAX_SPAN) {
      const c = (a + b) / 2;
      a = c - MAX_SPAN / 2 + 1e-6;
      b = c + MAX_SPAN / 2 - 1e-6;
    }
    return [a, b];
  };
  const [w, e] = box(Math.min(...xs), Math.max(...xs));
  const [s, n] = box(Math.min(...ys), Math.max(...ys));
  return [Math.max(-180, w), Math.max(-85, s), Math.min(180, e), Math.min(85, n)];
}

/**
 * Purpose: a map from ground places to the diagram: each point moves by the stations' moves (diagram place
 * minus ground place), weighted by the inverse square of the distance to each station, so water near a
 * station keeps its place next to it. Inputs: the diagram origin, the stations' ground places and their
 * diagram positions (metres from the origin).
 */
export function warp(origin: LonLat, stations: readonly LonLat[], pos: readonly Pt[]): (p: LonLat) => Pt {
  const geo = stations.map((s) => project(origin, s));
  const moves = geo.map((g, i) => [pos[i]![0] - g[0], pos[i]![1] - g[1]] as Pt);
  return (lonlat) => {
    const p = project(origin, lonlat);
    if (!geo.length) return p;
    let wx = 0;
    let wy = 0;
    let wsum = 0;
    for (let i = 0; i < geo.length; i++) {
      const d2 = (geo[i]![0] - p[0]) ** 2 + (geo[i]![1] - p[1]) ** 2;
      if (d2 < 1) return [p[0] + moves[i]![0], p[1] + moves[i]![1]];
      const w = 1 / d2;
      wx += moves[i]![0] * w;
      wy += moves[i]![1] * w;
      wsum += w;
    }
    return [p[0] + wx / wsum, p[1] + wy / wsum];
  };
}

/** Purpose: a line simplified with Douglas–Peucker to `tol` (same units as the points); ends kept. */
export function simplifyLine(line: readonly Pt[], tol: number): Pt[] {
  if (line.length <= 2) return [...line];
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(line[k]!, line[i]!, line[j]!);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([i, best], [best, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}

/** Purpose: the distance from `p` to the segment `a`–`b`. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
}

/** Purpose: the length of a polyline. */
function lengthOf(line: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < line.length; i++)
    l += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return l;
}

/** Purpose: river pieces joined end to end where they meet (within `tol`), longest continuation first. */
function joinPieces(pieces: readonly Pt[][], tol: number): Pt[][] {
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  left.sort((a, b) => lengthOf(b) - lengthOf(a));
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const out: Pt[][] = [];
  while (left.length) {
    let c = left.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i]!;
        const s = c[0]!;
        const e = c[c.length - 1]!;
        if (near(w[0]!, e)) c = [...c, ...w.slice(1)];
        else if (near(w[w.length - 1]!, e)) c = [...c, ...[...w].reverse().slice(1)];
        else if (near(w[w.length - 1]!, s)) c = [...w, ...c.slice(1)];
        else if (near(w[0]!, s)) c = [...[...w].reverse(), ...c.slice(1)];
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(c);
  }
  return out;
}

/** Purpose: points every `step` along a polyline (ends included). */
function samples(line: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/**
 * Purpose: rivers drawn like the lines (Homlo's schematic review): pieces joined where they meet, short side
 * arms and channels that run alongside a longer river dropped, the bends simplified, and every part turned to
 * a multiple of 45° (straight, diagonal, straight, as the lines). The bends stay where the river runs between
 * the stations, so it still passes the stations it passes on the ground; where turning a part to 45° would
 * bring it closer to a station, the part bends the other way round.
 * Inputs: the rivers already bent with the stations (diagram metres), the diagram unit (typical distance
 * between stations, metres) and the stations' diagram places. Output: the rivers as polylines, same units.
 */
export function schematicRivers(
  rivers: readonly { line: Pt[]; kind: "river" | "canal" }[],
  unit: number,
  stations: readonly Pt[],
): { line: Pt[]; kind: "river" | "canal" }[] {
  // Rivers worked out before for the same places (this visit, or saved with the project): read back.
  const key = hashText(JSON.stringify([RIVERS_VERSION, rivers, unit, stations]));
  const saved = recallAnswer(key);
  if (saved) return JSON.parse(saved) as { line: Pt[]; kind: "river" | "canal" }[];
  const out = riversNow(rivers, unit, stations);
  rememberAnswer(key, JSON.stringify(out));
  return out;
}

/** The river code's version in the fingerprint of kept rivers. */
const RIVERS_VERSION = codeVersion(import.meta.url);

/** Purpose: `schematicRivers` worked out. */
function riversNow(
  rivers: readonly { line: Pt[]; kind: "river" | "canal" }[],
  unit: number,
  stations: readonly Pt[],
): { line: Pt[]; kind: "river" | "canal" }[] {
  const out: { line: Pt[]; kind: "river" | "canal" }[] = [];
  for (const kind of ["river", "canal"] as const) {
    const chains = joinPieces(
      rivers.filter((r) => r.kind === kind).map((r) => r.line),
      unit * 0.05,
    );
    // Longest first: a chain mostly within half a unit of one already kept is a side channel of it.
    const kept: Pt[][] = [];
    for (const c of chains) {
      const len = lengthOf(c);
      if (len < unit * 1.5) continue;
      const pts = samples(c, unit * 0.25);
      const beside = (p: Pt) =>
        kept.some((k) => k.some((q, i) => i > 0 && distToSegment(p, k[i - 1]!, q) < unit * 0.5));
      if (kept.length && pts.filter(beside).length > pts.length * 0.6) continue;
      kept.push(c);
    }
    for (const c of kept) out.push({ line: octiRiver(simplifyLine(c, unit * 0.8), unit, stations), kind });
  }
  return out;
}

/** Purpose: a simplified river with every part at a multiple of 45°, bent away from nearby stations. */
function octiRiver(line: readonly Pt[], unit: number, stations: readonly Pt[]): Pt[] {
  const out: Pt[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1]!;
    const q = line[i]!;
    const mid = octiRoute(p, q);
    if (mid.length === 2) {
      out.push(q);
      continue;
    }
    // Two other ways round: the axis part first, or the diagonal first.
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const d = Math.min(ax, ay);
    const diag: Pt = [Math.sign(dx) * d, Math.sign(dy) * d];
    const axisFirst: Pt[] = [p, [q[0] - diag[0], q[1] - diag[1]], q];
    const diagFirst: Pt[] = [p, [p[0] + diag[0], p[1] + diag[1]], q];
    const box = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
    const close = stations.filter(
      (s) =>
        s[0] >= box[0]! - unit && s[0] <= box[2]! + unit && s[1] >= box[1]! - unit && s[1] <= box[3]! + unit,
    );
    // The way round that keeps farthest from the stations near it.
    const clearance = (route: Pt[]) => {
      let m = Infinity;
      for (const s of close)
        for (let k = 1; k < route.length; k++) m = Math.min(m, distToSegment(s, route[k - 1]!, route[k]!));
      return m;
    };
    let best = mid;
    let bestC = clearance(mid);
    for (const r of [axisFirst, diagFirst]) {
      const c = clearance(r);
      if (c > bestC + unit * 0.05) {
        best = r;
        bestC = c;
      }
    }
    out.push(...best.slice(1));
  }
  return out;
}

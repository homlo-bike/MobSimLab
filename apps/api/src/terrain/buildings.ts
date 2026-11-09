import { OverpassError } from "../gateway/overpass.client";
import type { LonLat } from "./terrain.service";

/**
 * Buildings a line passes over, from OpenStreetMap, for clearance checks of aerial lines.
 * Heights come from `height`, else `building:levels` (3 m per level plus a 2 m roof), else
 * `min_height`, else an assumed 10 m; the result marks estimated heights.
 */

export const METRES_PER_LEVEL = 3;
export const ROOF_M = 2;
export const DEFAULT_BUILDING_M = 10;
/** How far either side of the line a building counts (the width of a cabin and its swing). */
export const BUILDING_BUFFER_M = 6;
const STEP_M = 2;

export interface BuildingCrossing {
  /** Metres from the line's start where the line enters and leaves the building. */
  fromM: number;
  toM: number;
  heightM: number;
  /** True when OSM has no height or levels for the building. */
  estimated: boolean;
  osmId: number;
}

type Geometry = Array<{ lat: number; lon: number }>;

/** A building way, or a multipolygon relation (large buildings such as cathedrals and stations). */
interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Geometry;
  members?: Array<{ type: string; role: string; geometry?: Geometry }>;
}

/**
 * Purpose: the outer rings of an element: a way's own ring, or a relation's outer members joined end
 * to end (OSM splits long outlines into several ways). Inner rings (courtyards) are left out, which
 * errs on the side of the building.
 */
export function outerRings(el: OverpassElement): Geometry[] {
  if (el.type === "way") return el.geometry && el.geometry.length >= 3 ? [el.geometry] : [];
  if (el.type !== "relation") return [];
  const parts = (el.members ?? [])
    .filter((m) => m.type === "way" && m.role !== "inner" && m.geometry && m.geometry.length >= 2)
    .map((m) => m.geometry!.slice());
  const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
  const rings: Geometry[] = [];
  while (parts.length) {
    const ring = parts.shift()!;
    let grew = true;
    while (grew && !same(ring[0]!, ring[ring.length - 1]!)) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i]!;
        const end = ring[ring.length - 1]!;
        if (same(end, q[0]!)) ring.push(...q.slice(1));
        else if (same(end, q[q.length - 1]!)) ring.push(...q.reverse().slice(1));
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Length of the line pieces whose bounding boxes the building query asks for. */
const CHUNK_M = 400;

/**
 * Purpose: Overpass QL for the buildings near a polyline, with their geometry: one bounding box per
 * piece of up to 400 m, padded by `bufferM`; `crossings` then keeps those the line really passes over.
 * (A polyline `around` filter misses a building the line crosses when none of the building's nodes is
 * within the radius, which is the usual case for a large building, so it is not used.)
 */
export function buildingQuery(line: LonLat[], bufferM = BUILDING_BUFFER_M): string {
  const boxes: string[] = [];
  const pad = (lat: number) => [bufferM / 111_320, bufferM / (111_320 * Math.cos((lat * Math.PI) / 180))];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const k = 111_320;
    const len = Math.hypot((b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * k);
    const n = Math.max(1, Math.ceil(len / CHUNK_M));
    for (let j = 0; j < n; j++) {
      const p = [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n];
      const q = [a[0] + ((b[0] - a[0]) * (j + 1)) / n, a[1] + ((b[1] - a[1]) * (j + 1)) / n];
      const [dLat, dLon] = pad((p[1]! + q[1]!) / 2);
      const s = Math.min(p[1]!, q[1]!) - dLat!;
      const w = Math.min(p[0]!, q[0]!) - dLon!;
      const nn = Math.max(p[1]!, q[1]!) + dLat!;
      const e = Math.max(p[0]!, q[0]!) + dLon!;
      boxes.push([s, w, nn, e].map((v) => v.toFixed(7)).join(","));
    }
  }
  const parts = boxes.flatMap((bb) => [`way["building"](${bb});`, `rel["building"](${bb});`]).join("");
  return `[out:json][timeout:60][maxsize:33554432];(${parts});out tags geom;`;
}

/** Purpose: a building's height from its OSM tags, and whether it is estimated. */
export function buildingHeight(tags: Record<string, string> = {}): { heightM: number; estimated: boolean } {
  const num = (v?: string) => {
    const n = Number.parseFloat((v ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const h = num(tags.height?.replace(/\s*m$/, ""));
  if (h !== null && h < 1000) return { heightM: h, estimated: false };
  const levels = num(tags["building:levels"]);
  if (levels !== null && levels < 300) {
    const roof = num(tags["roof:levels"]) ?? 0;
    return { heightM: (levels + roof) * METRES_PER_LEVEL + ROOF_M, estimated: false };
  }
  const min = num(tags.min_height);
  if (min !== null) return { heightM: min + METRES_PER_LEVEL, estimated: true };
  return { heightM: DEFAULT_BUILDING_M, estimated: true };
}

/** Local metres around an origin (equirectangular; fine for a few kilometres). */
function projector(o: LonLat) {
  const k = 111_320;
  const c = Math.cos((o[1] * Math.PI) / 180);
  return ([lon, lat]: LonLat): [number, number] => [(lon - o[0]) * k * c, (lat - o[1]) * k];
}

function inside(p: [number, number], ring: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function distToRing(p: [number, number], ring: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}

/**
 * Purpose: where a line passes over or within `bufferM` of each building.
 * Inputs: the line, the Overpass JSON answer. Output: crossings sorted by `fromM`.
 */
export function crossings(
  line: LonLat[],
  overpassJson: string,
  bufferM = BUILDING_BUFFER_M,
): BuildingCrossing[] {
  if (line.length < 2) return [];
  const parsed = JSON.parse(overpassJson) as { elements?: OverpassElement[]; remark?: string };
  // Overpass answers 200 with a remark when a query ran out of time or memory: the list is incomplete.
  if (parsed.remark && /error/i.test(parsed.remark))
    throw new OverpassError(`Overpass: ${parsed.remark}`, 502);
  const proj = projector(line[0]!);
  const pts = line.map(proj);
  // Positions along the line every STEP_M metres.
  const along: Array<{ d: number; p: [number, number] }> = [];
  let base = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / STEP_M));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      along.push({ d: base + len * t, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
    }
    base += len;
  }
  const out: BuildingCrossing[] = [];
  for (const el of parsed.elements ?? []) {
    const rings = outerRings(el).map((g) => g.map((q) => proj([q.lon, q.lat])));
    if (!rings.length) continue;
    const xs = rings.flat().map((r) => r[0]);
    const ys = rings.flat().map((r) => r[1]);
    const box = [
      Math.min(...xs) - bufferM,
      Math.min(...ys) - bufferM,
      Math.max(...xs) + bufferM,
      Math.max(...ys) + bufferM,
    ];
    const { heightM, estimated } = buildingHeight(el.tags);
    let from: number | null = null;
    let to = 0;
    const flush = () => {
      if (from !== null) out.push({ fromM: round(from), toM: round(to), heightM, estimated, osmId: el.id });
      from = null;
    };
    for (const { d, p } of along) {
      const near =
        p[0] >= box[0]! &&
        p[0] <= box[2]! &&
        p[1] >= box[1]! &&
        p[1] <= box[3]! &&
        rings.some((ring) => inside(p, ring) || distToRing(p, ring) <= bufferM);
      if (near) {
        from ??= d;
        to = d;
      } else flush();
    }
    flush();
  }
  return out.sort((a, b) => a.fromM - b.fromM);
}

const round = (x: number) => Math.round(x * 10) / 10;

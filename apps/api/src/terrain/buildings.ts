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

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/** Purpose: Overpass QL for the buildings within `bufferM` of a polyline, with their geometry. */
export function buildingQuery(line: LonLat[], bufferM = BUILDING_BUFFER_M): string {
  const coords = line.map(([lon, lat]) => `${lat.toFixed(7)},${lon.toFixed(7)}`).join(",");
  return `[out:json][timeout:60][maxsize:33554432];way["building"](around:${bufferM},${coords});out tags geom;`;
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
  const parsed = JSON.parse(overpassJson) as { elements?: OverpassWay[] };
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
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
    const ring = el.geometry.map((g) => proj([g.lon, g.lat]));
    const xs = ring.map((r) => r[0]);
    const ys = ring.map((r) => r[1]);
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
        (inside(p, ring) || distToRing(p, ring) <= bufferM);
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

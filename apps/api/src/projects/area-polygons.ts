import { z } from "zod";

/**
 * The project area as polygons the planner draws (large-area projects, step 1): one or more polygons round the
 * expected edges of the project, each with a detail setting. Map data is downloaded only inside them, at each
 * polygon's detail. Kept on the project (`project.project.area_polygons`, migration 0027).
 */

export type LonLat = [number, number];

/** How much map data a polygon holds: everything, or only what an intercity corridor needs. */
export type AreaDetail = "full" | "main";
export const AREA_DETAILS = ["full", "main"] as const;

export interface AreaPolygon {
  /** Stable id, `a` and letters or digits. */
  id: string;
  name: string;
  detail: AreaDetail;
  /** Outer ring `[lon, lat]`, closed (first point repeated at the end). */
  ring: LonLat[];
}

/** Most polygons a project area holds (also checked by the database). */
export const MAX_AREA_POLYGONS = 50;
/** Most corners of one polygon. */
export const MAX_POLYGON_POINTS = 2000;
/** Largest map data a project area may hold by default, MB (`MOBSIMLAB_AREA_MAX_MB`). */
export const DEFAULT_AREA_MAX_MB = 1000;

/** Zoom of the map tiles the estimate counts (the street network's tiles, street-network.service `TILE_ZOOM`). */
export const ESTIMATE_ZOOM = 14;

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]);

/** A polygon as a planner sends it. The ring is closed here when its last point is not its first. */
export const areaPolygon = z
  .strictObject({
    id: z.string().regex(/^a[A-Za-z0-9_-]{1,40}$/, "A polygon id is a and up to 40 letters or digits"),
    name: z.string().trim().min(1).max(200),
    detail: z.enum(AREA_DETAILS),
    ring: z.array(lonLat).min(3).max(MAX_POLYGON_POINTS),
  })
  .transform((p) => ({ ...p, ring: closeRing(p.ring) }))
  .refine((p) => p.ring.length >= 4, "A polygon needs at least three corners")
  .refine((p) => Math.abs(shoelace(p.ring)) > 1e-10, "A polygon must enclose an area");

/** Purpose: twice the signed area of a ring in square degrees (zero for a ring with no inside). */
function shoelace(ring: readonly LonLat[]): number {
  let a = 0;
  for (let i = 0; i + 1 < ring.length; i++)
    a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a;
}

export const areaPolygons = z
  .array(areaPolygon)
  .max(MAX_AREA_POLYGONS)
  .refine((ps) => new Set(ps.map((p) => p.id)).size === ps.length, "A polygon is listed twice");

/** Purpose: a ring with its first point repeated at the end. */
export function closeRing(ring: readonly LonLat[]): LonLat[] {
  const out = ring.map((p) => [p[0], p[1]] as LonLat);
  const a = out[0];
  const b = out[out.length - 1];
  if (a && b && (a[0] !== b[0] || a[1] !== b[1])) out.push([a[0], a[1]]);
  return out;
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Purpose: the area a ring encloses, km² (spherical excess on a sphere of the mean Earth radius). */
export function ringAreaKm2(ring: readonly LonLat[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
  }
  return Math.abs((sum * R_KM * R_KM) / 2);
}

/** Purpose: the box `[west, south, east, north]` round some polygons, or null when there are none. */
export function polygonsBox(
  polygons: readonly { ring: readonly LonLat[] }[],
): [number, number, number, number] | null {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polygons)
    for (const [x, y] of p.ring) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** Purpose: whether a point lies inside a ring (even-odd rule). */
export function pointInRing([x, y]: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Purpose: whether two segments cross or touch. */
function segmentsMeet(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const cross = (o: LonLat, p: LonLat, q: LonLat) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (o: LonLat, p: LonLat, q: LonLat) =>
    Math.min(o[0], p[0]) <= q[0] &&
    q[0] <= Math.max(o[0], p[0]) &&
    Math.min(o[1], p[1]) <= q[1] &&
    q[1] <= Math.max(o[1], p[1]);
  return (
    (d1 === 0 && on(c, d, a)) ||
    (d2 === 0 && on(c, d, b)) ||
    (d3 === 0 && on(a, b, c)) ||
    (d4 === 0 && on(a, b, d))
  );
}

/** Purpose: whether a ring and a box `[west, south, east, north]` overlap at all. */
export function ringMeetsBox(ring: readonly LonLat[], [w, s, e, n]: readonly number[]): boolean {
  // A corner of the ring in the box, or a corner of the box in the ring, or an edge crossing.
  if (ring.some(([x, y]) => x >= w! && x <= e! && y >= s! && y <= n!)) return true;
  const corners: LonLat[] = [
    [w!, s!],
    [e!, s!],
    [e!, n!],
    [w!, n!],
  ];
  if (corners.some((c) => pointInRing(c, ring))) return true;
  for (let i = 0; i + 1 < ring.length; i++)
    for (let k = 0; k < 4; k++)
      if (segmentsMeet(ring[i]!, ring[i + 1]!, corners[k]!, corners[(k + 1) % 4]!)) return true;
  return false;
}

/** Purpose: web-mercator tile column and row of a point at zoom z. */
export function tileOf([lon, lat]: LonLat, z: number): [number, number] {
  const n = 2 ** z;
  const r = Math.max(-85.0511, Math.min(85.0511, lat)) * RAD;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  return [x, y];
}

/** Purpose: a tile's box `[west, south, east, north]`. */
export function tileBox(x: number, y: number, z: number): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) / RAD;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

/** A map tile of the area and the detail it is held at (the highest detail of the polygons touching it). */
export interface AreaTile {
  x: number;
  y: number;
  detail: AreaDetail;
}

/** Purpose: the tiles at zoom z touching any polygon, each at the highest detail of the polygons it touches. */
export function areaTiles(polygons: readonly AreaPolygon[], z = ESTIMATE_ZOOM): AreaTile[] {
  const out = new Map<string, AreaTile>();
  for (const p of polygons) {
    const box = polygonsBox([p]);
    if (!box) continue;
    const [x0, y1] = tileOf([box[0], box[1]], z);
    const [x1, y0] = tileOf([box[2], box[3]], z);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const key = `${x}/${y}`;
        const had = out.get(key);
        if (had?.detail === "full") continue;
        if (had && p.detail === "main") continue;
        if (!ringMeetsBox(p.ring, tileBox(x, y, z))) continue;
        out.set(key, { x, y, detail: p.detail });
      }
  }
  return [...out.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Typical map data per zoom-14 tile, bytes, by detail: what the tools load and the .mslab map data holds (street,
 * walk, building, place and rail tiles, terrain heights, population). Averages over towns and their outskirts;
 * a dense centre holds more and open country much less, so the estimate is a guide, not a promise.
 */
export const BYTES_PER_TILE: Record<AreaDetail, number> = {
  full: 600_000,
  main: 40_000,
};

/** What an area holds, for the area window and the limit. */
export interface AreaEstimate {
  areaKm2: number;
  tiles: { full: number; main: number };
  /** Estimated map data, bytes. */
  bytes: number;
  /** Per polygon: its own area and estimated data (overlaps with other polygons counted again). */
  polygons: { id: string; areaKm2: number; bytes: number }[];
  /** The limit, bytes, and whether the area is over it. */
  limitBytes: number;
  overLimit: boolean;
  /**
   * With a previous area (editing a saved one): what the new area adds to it, the tiles it does not hold yet or
   * holds only at main detail where the new area needs full. Nothing is downloaded for the rest.
   */
  added?: { tiles: number; bytes: number };
}

/** Purpose: the estimate for some polygons and a limit in MB. */
export function estimateArea(
  polygons: readonly AreaPolygon[],
  limitMb = DEFAULT_AREA_MAX_MB,
  previous?: readonly AreaPolygon[],
): AreaEstimate {
  const tiles = areaTiles(polygons);
  const full = tiles.filter((t) => t.detail === "full").length;
  const main = tiles.length - full;
  const bytes = full * BYTES_PER_TILE.full + main * BYTES_PER_TILE.main;
  const limitBytes = limitMb * 1024 * 1024;
  const round = (v: number) => Math.round(v * 10) / 10;
  let added: AreaEstimate["added"];
  if (previous) {
    const had = new Map(areaTiles(previous).map((t) => [`${t.x}/${t.y}`, t.detail]));
    const fresh = tiles.filter((t) => {
      const d = had.get(`${t.x}/${t.y}`);
      return !d || (d === "main" && t.detail === "full");
    });
    added = { tiles: fresh.length, bytes: fresh.reduce((s, t) => s + BYTES_PER_TILE[t.detail], 0) };
  }
  return {
    areaKm2: round(polygons.reduce((s, p) => s + ringAreaKm2(p.ring), 0)),
    tiles: { full, main },
    bytes,
    polygons: polygons.map((p) => ({
      id: p.id,
      areaKm2: round(ringAreaKm2(p.ring)),
      bytes: areaTiles([p]).length * BYTES_PER_TILE[p.detail],
    })),
    limitBytes,
    overLimit: bytes > limitBytes,
    ...(added ? { added } : {}),
  };
}

/** Purpose: the polygons of a stored `area_polygons` value; malformed entries are skipped. */
export function storedPolygons(v: unknown): AreaPolygon[] {
  if (!Array.isArray(v)) return [];
  const out: AreaPolygon[] = [];
  for (const x of v) {
    const r = areaPolygon.safeParse(x);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Purpose: the area limit in MB from the environment (`MOBSIMLAB_AREA_MAX_MB`, 1 to 1,000,000). */
export function areaLimitMb(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.MOBSIMLAB_AREA_MAX_MB);
  return env.MOBSIMLAB_AREA_MAX_MB && Number.isFinite(v) && v >= 1 && v <= 1_000_000
    ? v
    : DEFAULT_AREA_MAX_MB;
}

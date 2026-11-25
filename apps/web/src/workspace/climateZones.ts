/**
 * Climate zones of a large project area. One climate at the centre of an intercity network (a whole country)
 * hides the difference between its coast, mountains and desert, so a large area keeps a climate per zone: one per
 * area polygon, and a large polygon split into parts of about 100 km. A calendar run weighs each zone's hot, very
 * hot and frost days, and its heating and air conditioning, by the share of the network's line length in it.
 */
import type { AreaPolygon } from "../features/area/api";
import { fromLocalMetres } from "../features/area/drawnBox";
import type { Network } from "../features/railways/types";
import type { SavedStreetLine } from "../features/street-lines/saved";
import { type MonthClimate, monthsOf, type ProjectClimate, type ZoneClimate } from "./climate";

type LonLat = [number, number];

/** A polygon is split into parts when it is wider or taller than this, degrees of latitude (about 130 km). */
const SPLIT_DEG = 1.2;
/** The parts of a large polygon: a grid of about this size, degrees of latitude (about 110 km). */
const CELL_DEG = 1;
/** At most this many zones in a project (one Open-Meteo request each, once). */
export const MAX_ZONES = 30;

/** A climate zone without its climate: where it is and what it is called. */
export type ZonePlace = Pick<ZoneClimate, "id" | "name" | "at">;

const round1 = (x: number) => Math.round(x * 10) / 10;

function inside([x, y]: LonLat, ring: readonly LonLat[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Purpose: the centre of a ring: the mean of its corners (the closing corner once). */
function centreOf(ring: readonly LonLat[]): LonLat {
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** Purpose: the parts of one large polygon: grid cells whose centre is inside it, else its corners in the cell. */
function parts(ring: readonly LonLat[], cellDeg: number): LonLat[] {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const midLat = (s + n) / 2;
  const dLat = cellDeg;
  const dLon = cellDeg / Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const rows = Math.max(1, Math.ceil((n - s) / dLat));
  const cols = Math.max(1, Math.ceil((e - w) / dLon));
  const out: LonLat[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = w + c * dLon;
      const y0 = s + r * dLat;
      const mid: LonLat = [x0 + dLon / 2, y0 + dLat / 2];
      if (inside(mid, ring)) {
        out.push(mid);
        continue;
      }
      // A corridor along a route can miss every cell centre: take the corners of the polygon in the cell.
      const corners = ring.filter(([x, y]) => x >= x0 && x < x0 + dLon && y >= y0 && y < y0 + dLat);
      if (corners.length)
        out.push([
          corners.reduce((t, p) => t + p[0], 0) / corners.length,
          corners.reduce((t, p) => t + p[1], 0) / corners.length,
        ]);
    }
  return out.length ? out : [centreOf(ring)];
}

/**
 * Purpose: the climate zones of a project area: one per polygon, a large polygon split into parts of about
 * 100 km, at most `MAX_ZONES` (the parts grow when there would be more). Zones at the same place (0.1°) are one.
 * Output: the zones; fewer than two means the project keeps one climate.
 */
export function climateZones(polygons: readonly AreaPolygon[]): ZonePlace[] {
  for (let cell = CELL_DEG; ; cell *= 1.5) {
    const out: ZonePlace[] = [];
    const seen = new Set<string>();
    for (const p of polygons) {
      if (p.ring.length < 3) continue;
      const lons = p.ring.map((q) => q[0]);
      const lats = p.ring.map((q) => q[1]);
      const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const wide = (Math.max(...lons) - Math.min(...lons)) * Math.cos((midLat * Math.PI) / 180);
      const tall = Math.max(...lats) - Math.min(...lats);
      const points = wide > SPLIT_DEG || tall > SPLIT_DEG ? parts(p.ring, cell) : [centreOf(p.ring)];
      points.forEach((pt, i) => {
        const at: [number, number] = [round1(pt[0]), round1(pt[1])];
        const key = `${at[0]},${at[1]}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          id: points.length > 1 ? `${p.id}-${i + 1}` : p.id,
          name: points.length > 1 ? `${p.name} ${i + 1}` : p.name,
          at,
        });
      });
    }
    if (out.length <= MAX_ZONES || cell > 20) return out.slice(0, MAX_ZONES);
  }
}

/**
 * Purpose: the project's climate with its zones set to `places`, keeping the climate and own values of zones
 * that stay where they were; no zones (one climate) for fewer than two places.
 */
export function withZonePlaces(c: ProjectClimate, places: readonly ZonePlace[]): ProjectClimate {
  const next: ProjectClimate = { ...c };
  if (places.length < 2) {
    delete next.zones;
    return next;
  }
  const old = new Map((c.zones ?? []).map((z) => [`${z.at[0]},${z.at[1]}`, z]));
  next.zones = places.map((p) => {
    const was = old.get(`${p.at[0]},${p.at[1]}`);
    return { ...was, id: p.id, name: p.name, at: [p.at[0], p.at[1]] };
  });
  return next;
}

/** Purpose: whether the zones kept in the climate are the zones of the area (same ids, names and places). */
export function sameZones(c: ProjectClimate, places: readonly ZonePlace[]): boolean {
  const zones = places.length < 2 ? [] : places;
  const kept = c.zones ?? [];
  return (
    kept.length === zones.length &&
    kept.every(
      (z, i) =>
        z.id === zones[i]!.id &&
        z.name === zones[i]!.name &&
        z.at[0] === zones[i]!.at[0] &&
        z.at[1] === zones[i]!.at[1],
    )
  );
}

/** Purpose: the drawn lines of the network in degrees: the railway's tracks and the street lines. */
export function networkPolylines(
  railway: Network | null | undefined,
  streetLines: readonly SavedStreetLine[] | null | undefined,
): LonLat[][] {
  const out: LonLat[][] = [];
  if (railway?.origin) {
    const stations = new Map(railway.stations.map((s) => [s.id, s] as const));
    const end = (a: Network["tracks"][number]["start"] | null): LonLat | null => {
      if (!a) return null;
      if (a.type === "free") return fromLocalMetres(railway.origin, a.x, a.y);
      if (a.type === "station") {
        const s = stations.get(a.station);
        return s ? fromLocalMetres(railway.origin, s.x, s.y) : null;
      }
      return null;
    };
    for (const t of railway.tracks) {
      const pts = [
        end(t.start),
        ...t.points.map((p) => fromLocalMetres(railway.origin, p.x, p.y)),
        end(t.end),
      ].filter((p): p is LonLat => p !== null);
      if (pts.length > 1) out.push(pts);
    }
  }
  for (const l of streetLines ?? []) {
    const pts = l.points.map((p) => p.lonlat);
    if (pts.length > 1) out.push(pts);
  }
  return out;
}

/** Purpose: about how far apart two points are, km (equirectangular; ample for weighing zones). */
function km(a: LonLat, b: LonLat): number {
  const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * Math.cos(lat);
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy) * 111.2;
}

/**
 * Purpose: each zone's share of the network: the length of the lines nearer to it than to any other zone.
 * Output: shares adding up to 1, in the zones' order; every zone the same while no line is drawn.
 */
export function zoneShares(zones: readonly Pick<ZonePlace, "at">[], lines: readonly LonLat[][]): number[] {
  if (!zones.length) return [];
  const len = zones.map(() => 0);
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let best = 0;
      let bestKm = Infinity;
      zones.forEach((z, k) => {
        const d = km(mid, z.at);
        if (d < bestKm) {
          bestKm = d;
          best = k;
        }
      });
      len[best]! += km(a, b);
    }
  const total = len.reduce((s, x) => s + x, 0);
  return total > 0 ? len.map((x) => x / total) : zones.map(() => 1 / zones.length);
}

/** Twelve months of a zone's climate and its share of the network. */
export interface WeightedClimate {
  months: MonthClimate[];
  weight: number;
}

/**
 * Purpose: the climates a calendar run weighs: each zone's months with its share of the network, or the one
 * climate with all of it. Output: null while any zone (or the one climate) misses a value.
 */
export function weightedClimates(c: ProjectClimate, lines: readonly LonLat[][]): WeightedClimate[] | null {
  if (c.zones && c.zones.length > 1) {
    const months = c.zones.map((z) => monthsOf(z));
    if (months.some((m) => m === null)) return null;
    const shares = zoneShares(c.zones, lines);
    return months.map((m, i) => ({ months: m!, weight: shares[i]! }));
  }
  const m = monthsOf(c);
  return m ? [{ months: m, weight: 1 }] : null;
}

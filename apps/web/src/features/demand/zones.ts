/**
 * Zones of the demand model (ADR-0019, 09 §2.1): the model area around the published lines, automatic
 * hexagons over it, and the planner's own zones uploaded as GeoJSON and edited in the Tables tab and the GIS
 * tab. Saved with the project as the `demand` drawing.
 */
import type { Timetable } from "../journey-planner/types";
import { inRing, type LonLat, ringAreaM2, ringCentre } from "../benefits/regions";

/** What the planner can give a zone; anything left out is estimated from WorldPop and OpenStreetMap. */
export interface ZoneValues {
  population?: number;
  workers?: number;
  children?: number;
  retail_jobs?: number;
  other_jobs?: number;
  schools?: number;
  universities?: number;
  hospitals?: number;
  clinics?: number;
  tourism?: number;
  /** Pupils and students of the zone; replaces schools and universities times their library sizes. */
  pupils?: number;
  /** Visitor trips a weekday; replaces hospitals, clinics and attractions times their library visits. */
  visits?: number;
  /** Parking cost at a trip end, project currency. */
  parking_cost?: number;
  /** Centre zone; left out, the job density decides. */
  cbd?: boolean;
}

export type ZoneField = Exclude<keyof ZoneValues, "cbd">;

/** The numbers a zone can hold, in the order the tables show them. */
export const ZONE_FIELDS: { key: ZoneField; label: string; unit: string }[] = [
  { key: "population", label: "People", unit: "residents" },
  { key: "workers", label: "Workers", unit: "employed residents" },
  { key: "children", label: "Children", unit: "residents under 15" },
  { key: "retail_jobs", label: "Retail jobs", unit: "jobs" },
  { key: "other_jobs", label: "Other jobs", unit: "jobs" },
  { key: "schools", label: "Schools", unit: "schools" },
  { key: "universities", label: "Universities", unit: "universities and colleges" },
  { key: "hospitals", label: "Hospitals", unit: "hospitals" },
  { key: "clinics", label: "Clinics", unit: "clinics and doctors" },
  { key: "tourism", label: "Attractions", unit: "tourist attractions and museums" },
  { key: "pupils", label: "Pupils and students", unit: "enrolled" },
  { key: "visits", label: "Visits", unit: "visitor trips a weekday" },
  { key: "parking_cost", label: "Parking", unit: "per trip end" },
];

export interface DemandZone {
  id: string;
  name: string;
  /** Closed ring. */
  ring: LonLat[];
  values: ZoneValues;
}

/** The `demand` drawing: automatic hexagons, or the planner's own zones. */
export interface DemandDoc {
  source: "auto" | "own";
  /** The own zones; absent or ignored while the source is automatic. */
  zones?: DemandZone[];
  /** Values the planner gave automatic zones, by zone id (kept while the hexagon size stays the same). */
  autoValues?: Record<string, ZoneValues>;
  /** The GBFS feed of the project's shared-bike scheme (https), read with the OpenStreetMap stations. */
  gbfsUrl?: string;
  /** The demand run whose ridership the Tables tab, the service table and the system test use. */
  ridershipRun?: string;
  /** What the planner observed, to calibrate the model to (09 §2.3). */
  observed?: ObservedDoc;
}

/** Observed weekday boardings of a line or a stop, by its id or name. */
export interface ObservedCount {
  kind: "line" | "stop";
  id: string;
  value: number;
}

/** What the planner observed: mode shares in %, the mean car trip in km, and boardings of lines and stops. */
export interface ObservedDoc {
  /** By mode (car, transit, walk, cycle), %. */
  shares?: Record<string, number>;
  meanCarKm?: number | null;
  counts?: ObservedCount[];
}

/** Purpose: the zones a run uses: the own zones, or the automatic ones with the planner's values on them. */
export function activeZones(doc: DemandDoc | null | undefined, auto: DemandZone[]): DemandZone[] {
  if (doc?.source === "own") return doc.zones ?? [];
  const own = doc?.autoValues ?? {};
  return auto.map((z) => (own[z.id] ? { ...z, values: own[z.id]! } : z));
}

/** Purpose: the document with one zone's values replaced (own zones by id, or the automatic zones' values). */
export function withZoneValues(doc: DemandDoc | null | undefined, id: string, values: ZoneValues): DemandDoc {
  const base: DemandDoc = doc ?? { source: "auto" };
  const empty = Object.keys(values).length === 0;
  if (base.source === "own")
    return { ...base, zones: (base.zones ?? []).map((z) => (z.id === id ? { ...z, values } : z)) };
  const autoValues = { ...(base.autoValues ?? {}) };
  if (empty) delete autoValues[id];
  else autoValues[id] = values;
  return { ...base, autoValues };
}

/** Most zones the worker takes (worker `inputs.MAX_ZONES`). */
export const MAX_ZONES = 3000;
/** Most points of a zone's outline kept (the WorldPop request takes up to 200). */
export const MAX_RING_POINTS = 200;

/** Hexagon areas of the H3 resolutions 9 to 6, km² (average). */
export const HEX_AREAS_KM2: { res: number; km2: number }[] = [
  { res: 9, km2: 0.1053 },
  { res: 8, km2: 0.7373 },
  { res: 7, km2: 5.1613 },
  { res: 6, km2: 36.129 },
];

/** Purpose: metres between two points (equirectangular; fine within a city). */
export function metres(a: LonLat, b: LonLat): number {
  const kx = 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110_574);
}

/**
 * Purpose: the points the model area is drawn around: every stop of the published lines, and points every
 * 250 m along the straight line between consecutive stops of each trip and pattern.
 */
export function linePoints(tt: Timetable | null): LonLat[] {
  if (!tt) return [];
  const at = new Map(tt.stops.map((s) => [s.stop_id, [s.stop_lon, s.stop_lat] as LonLat]));
  const out = new Map<string, LonLat>();
  const add = (p: LonLat) => out.set(`${p[0].toFixed(5)},${p[1].toFixed(5)}`, p);
  const along = (ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      const b = at.get(ids[i]!);
      if (!b) continue;
      add(b);
      const a = i > 0 ? at.get(ids[i - 1]!) : undefined;
      if (!a) continue;
      const n = Math.ceil(metres(a, b) / 250);
      for (let k = 1; k < n; k++) add([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  };
  const seen = new Set<string>();
  for (const t of tt.trips) {
    const ids = [...t.stop_times].sort((x, y) => x.stop_sequence - y.stop_sequence).map((s) => s.stop_id);
    const key = ids.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    along(ids);
  }
  for (const p of tt.frequency_patterns ?? []) along(p.stops.map((s) => s.stop_id));
  return [...out.values()];
}

/** A local metric projection around a point. */
function projection(origin: LonLat) {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  const ky = 110_574;
  return {
    xy: (p: LonLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    lonlat: (x: number, y: number): LonLat => [
      Math.round((origin[0] + x / kx) * 1e7) / 1e7,
      Math.round((origin[1] + y / ky) * 1e7) / 1e7,
    ],
  };
}

/** Purpose: whether any point lies within `r` metres of `p` (points bucketed in an `r`-sized grid). */
function nearIndex(points: [number, number][], r: number) {
  const cells = new Map<string, [number, number][]>();
  for (const p of points) {
    const k = `${Math.floor(p[0] / r)},${Math.floor(p[1] / r)}`;
    const l = cells.get(k);
    if (l) l.push(p);
    else cells.set(k, [p]);
  }
  return (x: number, y: number): boolean => {
    const cx = Math.floor(x / r);
    const cy = Math.floor(y / r);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const p of cells.get(`${cx + dx},${cy + dy}`) ?? [])
          if (Math.hypot(p[0] - x, p[1] - y) <= r) return true;
    return false;
  };
}

/** Purpose: the hexagon centres of one size whose centre is within the buffer of a line point. */
function hexCentres(
  xy: [number, number][],
  buffer: number,
  km2: number,
): { q: number; r: number; x: number; y: number }[] {
  // Pointy-top hexagons of side s: area 3√3/2 s².
  const s = Math.sqrt((2 * km2 * 1e6) / (3 * Math.sqrt(3)));
  const w = Math.sqrt(3) * s;
  const near = nearIndex(xy, buffer);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs) - buffer, Math.max(...xs) + buffer];
  const [y0, y1] = [Math.min(...ys) - buffer, Math.max(...ys) + buffer];
  const out: { q: number; r: number; x: number; y: number }[] = [];
  const r0 = Math.floor(y0 / (1.5 * s)) - 1;
  const r1 = Math.ceil(y1 / (1.5 * s)) + 1;
  for (let r = r0; r <= r1; r++) {
    const y = r * 1.5 * s;
    const shift = (r & 1) * (w / 2);
    const q0 = Math.floor((x0 - shift) / w) - 1;
    const q1 = Math.ceil((x1 - shift) / w) + 1;
    for (let q = q0; q <= q1; q++) {
      const x = q * w + shift;
      if (near(x, y)) out.push({ q, r, x, y });
    }
  }
  return out;
}

/**
 * Purpose: automatic zones: hexagons over the model area (within `buffer` metres of the lines), of the
 * smallest H3 size that gives at most `maxCount` zones. Output: the zones (no values), and the resolution;
 * no zones without lines.
 */
export function hexZones(
  points: LonLat[],
  buffer: number,
  maxCount: number,
): { zones: DemandZone[]; res: number | null } {
  if (!points.length) return { zones: [], res: null };
  const origin: LonLat = [
    points.reduce((a, p) => a + p[0], 0) / points.length,
    points.reduce((a, p) => a + p[1], 0) / points.length,
  ];
  const proj = projection(origin);
  const xy = points.map(proj.xy);
  const limit = Math.max(1, Math.min(MAX_ZONES, Math.floor(maxCount)));
  let chosen = HEX_AREAS_KM2.at(-1)!;
  let centres = hexCentres(xy, Math.max(buffer, 100), chosen.km2);
  for (const size of HEX_AREAS_KM2) {
    const c = hexCentres(xy, Math.max(buffer, 100), size.km2);
    if (c.length <= limit) {
      chosen = size;
      centres = c;
      break;
    }
  }
  const s = Math.sqrt((2 * chosen.km2 * 1e6) / (3 * Math.sqrt(3)));
  const zones = centres.map(({ q, r, x, y }, i) => {
    const ring: LonLat[] = [];
    for (let k = 0; k < 6; k++) {
      const a = ((60 * k - 30) * Math.PI) / 180;
      ring.push(proj.lonlat(x + s * Math.cos(a), y + s * Math.sin(a)));
    }
    ring.push(ring[0]!);
    return { id: `h${chosen.res}.${q}.${r}`, name: `Zone ${i + 1}`, ring, values: {} };
  });
  return { zones, res: chosen.res };
}

/** Purpose: a ring with at most `max` points (every n-th point kept; first and last kept, closed). */
export function thinRing(ring: LonLat[], max = MAX_RING_POINTS): LonLat[] {
  const open =
    ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1]
      ? ring.slice(0, -1)
      : ring;
  if (open.length + 1 <= max) return [...open, open[0]!];
  const step = open.length / (max - 1);
  const out: LonLat[] = [];
  for (let i = 0; i < max - 1; i++) out.push(open[Math.floor(i * step)]!);
  out.push(out[0]!);
  return out;
}

/** Purpose: a zone's centre: the mean of its outline, or a point inside it when the mean falls outside. */
export function zoneCentre(z: DemandZone): LonLat {
  const c = ringCentre(z.ring);
  if (inRing(c, z.ring)) return c;
  // A point inside: the middle of the widest stretch of the horizontal line through the centre.
  const y = c[1];
  const xs: number[] = [];
  const r = z.ring;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  let best: LonLat = r[0]!;
  let width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1]! - xs[i]! > width) {
      width = xs[i + 1]! - xs[i]!;
      best = [(xs[i]! + xs[i + 1]!) / 2, y];
    }
  return best;
}

/** Purpose: a zone's area, km². */
export function zoneKm2(z: DemandZone): number {
  return ringAreaM2(z.ring) / 1e6;
}

// ---------------------------------------------------------------------------------------------------
// GeoJSON.

/** Property names (lower case) each value is read from, besides its own key. */
const ALIASES: Record<keyof ZoneValues, string[]> = {
  population: ["population", "pop", "residents", "inhabitants", "people"],
  workers: ["workers", "employed", "employed_residents"],
  children: ["children", "under15", "under_15", "kids"],
  retail_jobs: ["retail_jobs", "retail"],
  other_jobs: ["other_jobs", "jobs", "employment", "emp"],
  schools: ["schools"],
  universities: ["universities", "colleges"],
  hospitals: ["hospitals"],
  clinics: ["clinics", "doctors"],
  tourism: ["tourism", "attractions"],
  pupils: ["pupils", "students", "enrolment", "enrollment"],
  visits: ["visits", "visitors"],
  parking_cost: ["parking_cost", "parking"],
  cbd: ["cbd", "centre", "center"],
};
const ID_KEYS = ["id", "zone_id", "zone", "code", "taz", "fid"];
const NAME_KEYS = ["name", "zone_name", "label"];

interface Feature {
  type?: unknown;
  id?: unknown;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "yes" || v === "true") return true;
  if (v === 0 || v === "0" || v === "no" || v === "false") return false;
  return undefined;
}

function isPoint(p: unknown): p is LonLat {
  return (
    Array.isArray(p) &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90
  );
}

/** The outer ring of the largest polygon of a Polygon or MultiPolygon, or null. */
function outerRing(g: Feature["geometry"]): LonLat[] | null {
  if (!g) return null;
  const polys: unknown[] =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon" && Array.isArray(g.coordinates)
        ? g.coordinates
        : [];
  let best: LonLat[] | null = null;
  let area = 0;
  for (const poly of polys) {
    const outer = Array.isArray(poly) ? poly[0] : null;
    if (!Array.isArray(outer) || outer.length < 4 || !outer.every(isPoint)) continue;
    const ring = outer.map((p) => [p[0], p[1]] as LonLat);
    const a = ringAreaM2(ring);
    if (a > area) {
      area = a;
      best = ring;
    }
  }
  return best;
}

/**
 * Purpose: zones from a GeoJSON file (a FeatureCollection of Polygons or MultiPolygons in WGS 84). Values
 * are read from properties of the same name or a common alias (`pop`, `jobs`, `students`…); `jobs` counts
 * as other jobs. Output: the zones and notes on what was skipped. Throws when the text is not GeoJSON.
 */
export function zonesFromGeoJson(text: string): { zones: DemandZone[]; notes: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not GeoJSON (it is not JSON).");
  }
  const fc = raw as { type?: unknown; features?: unknown };
  const features: Feature[] =
    fc?.type === "FeatureCollection" && Array.isArray(fc.features)
      ? (fc.features as Feature[])
      : fc?.type === "Feature"
        ? [fc as Feature]
        : [];
  if (!features.length) throw new Error("The file has no GeoJSON features.");
  const notes: string[] = [];
  const zones: DemandZone[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  for (const [i, f] of features.entries()) {
    const ring = outerRing(f.geometry);
    if (!ring) {
      skipped++;
      continue;
    }
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f.properties ?? {})) props[k.toLowerCase()] = v;
    const pick = (keys: string[]) =>
      keys.map((k) => props[k]).find((v) => v !== undefined && v !== null && v !== "");
    let id = String(pick(ID_KEYS) ?? f.id ?? `z${i + 1}`).slice(0, 64);
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const values: ZoneValues = {};
    for (const [key, aliases] of Object.entries(ALIASES) as [keyof ZoneValues, string[]][]) {
      const v = pick(aliases);
      if (v === undefined) continue;
      if (key === "cbd") {
        const b = toBool(v);
        if (b !== undefined) values.cbd = b;
      } else {
        const n = toNumber(v);
        if (n !== undefined) values[key] = n;
      }
    }
    zones.push({ id, name: String(pick(NAME_KEYS) ?? id).slice(0, 120), ring: thinRing(ring), values });
    if (zones.length >= MAX_ZONES) {
      if (features.length > i + 1) notes.push(`Only the first ${MAX_ZONES} zones were taken.`);
      break;
    }
  }
  if (skipped) notes.push(`${skipped} features were not polygons and were skipped.`);
  if (!zones.length) throw new Error("The file has no polygon zones.");
  return { zones, notes };
}

/** Purpose: the zones as GeoJSON, with their own values as properties (for download and editing elsewhere). */
export function zonesToGeoJson(zones: DemandZone[]): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      properties: { id: z.id, name: z.name, ...z.values },
      geometry: { type: "Polygon", coordinates: [z.ring] },
    })),
  });
}

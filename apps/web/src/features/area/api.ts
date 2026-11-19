import { get, send } from "../../session/api";

export type LonLat = [number, number];

/** How much map data a polygon holds: everything, or only what an intercity corridor needs. */
export type AreaDetail = "full" | "main";

/** A polygon of the project area, drawn in the area window (apps/api/src/projects/area-polygons.ts). */
export interface AreaPolygon {
  /** `a` and letters or digits. */
  id: string;
  name: string;
  detail: AreaDetail;
  /** Outer ring `[lon, lat]`, closed. */
  ring: LonLat[];
}

/** What some polygons hold, and the instance's limit (apps/api/src/projects/area-polygons.ts `AreaEstimate`). */
export interface AreaEstimate {
  areaKm2: number;
  tiles: { full: number; main: number };
  /** Estimated map data, bytes. */
  bytes: number;
  polygons: { id: string; areaKm2: number; bytes: number }[];
  limitBytes: number;
  overLimit: boolean;
  /** Editing a saved area: what the new area adds to it (nothing is downloaded for the rest). */
  added?: { tiles: number; bytes: number };
}

/** One import queued (or not) when the area was saved. */
export interface AreaImport {
  kind: "osm" | "dem" | "population";
  status: "queued" | "current" | "failed";
  reason?: string;
}

/** A country of the project area, with its share of the area (apps/api/src/projects/area-facts.ts). */
export interface AreaCountry {
  iso2: string;
  iso3: string | null;
  name: string;
  share: number;
}

/** What `GET /api/projects/:id/area` answers. */
export interface AreaView {
  /** The polygons of the area; empty until the planner draws one. */
  polygons: AreaPolygon[];
  estimate: AreaEstimate;
  /** The box round the polygons, or null without polygons. */
  bbox: [number, number, number, number] | null;
  /** When the area's map data was last downloaded, or null. */
  dataDate: string | null;
  /** The area's countries, looked up once; the first is the project's country. Null until looked up. */
  countries?: { main: AreaCountry | null; countries: AreaCountry[] } | null;
}

/** Purpose: what some polygons would hold; with `previous`, also what they add to that saved area. */
export type EstimateArea = (polygons: AreaPolygon[], previous?: AreaPolygon[]) => Promise<AreaEstimate>;

export interface ProjectAreaApi {
  get(): Promise<AreaView>;
  /** Set the polygons and, with `importData`, download the map data for them. */
  set(polygons: AreaPolygon[], importData?: boolean): Promise<AreaView & { imports: AreaImport[] }>;
  /** Download the area's map data again (Refresh map data). */
  refresh(): Promise<{ imports: AreaImport[] }>;
  estimate: EstimateArea;
}

/** Purpose: the estimate endpoint, which works before a project exists (New project). */
export function areaEstimator(csrf: string): EstimateArea {
  return (polygons, previous) =>
    send<AreaEstimate>("POST", "/api/area/estimate", csrf, previous ? { polygons, previous } : { polygons });
}

/** Purpose: the project area endpoints of one project. */
export function projectAreaApi(projectId: string, csrf: string): ProjectAreaApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/area`;
  return {
    get: () => get<AreaView>(base),
    set: (polygons, importData = true) => send("PUT", base, csrf, { polygons, import: importData }),
    refresh: () => send("POST", `${base}/refresh`, csrf),
    estimate: areaEstimator(csrf),
  };
}

/** Purpose: a new polygon id that none of `taken` has. */
export function newPolygonId(taken: readonly { id: string }[]): string {
  const ids = new Set(taken.map((p) => p.id));
  for (let n = taken.length + 1; ; n++) if (!ids.has(`a${n}`)) return `a${n}`;
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

/** Purpose: the area a ring encloses, km² (as the API works it out, area-polygons.ts `ringAreaKm2`). */
export function ringAreaKm2(ring: readonly LonLat[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
  }
  return Math.abs((sum * R_KM * R_KM) / 2);
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

/** Purpose: whether a point lies inside any of the polygons. */
export function inArea(p: LonLat, polygons: readonly { ring: readonly LonLat[] }[]): boolean {
  return polygons.some((a) => pointInRing(p, a.ring));
}

/**
 * Purpose: about how much of a ring lies outside the polygons, km², sampled on a grid over the ring's box.
 * Output: 0 when it lies wholly inside.
 */
export function outsideKm2(
  ring: readonly LonLat[],
  polygons: readonly { ring: readonly LonLat[] }[],
): number {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const steps = 60;
  let inRing = 0;
  let out = 0;
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) {
      const p: LonLat = [w + ((i + 0.5) * (e - w)) / steps, s + ((j + 0.5) * (n - s)) / steps];
      if (!pointInRing(p, ring)) continue;
      inRing++;
      if (!inArea(p, polygons)) out++;
    }
  return inRing ? (ringAreaKm2(ring) * out) / inRing : 0;
}

/** Purpose: megabytes for a byte count, rounded for people (at least 1 once there is anything). */
export function megabytes(bytes: number): number {
  return bytes <= 0 ? 0 : Math.max(1, Math.round(bytes / 1024 / 1024));
}

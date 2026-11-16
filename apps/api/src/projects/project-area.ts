import proj4 from "proj4";
import type { Database } from "../db/database";

/**
 * The project area (06-gis §1, §3): the box round everything drawn in the project, widened by the project's
 * buffer (`project.project.area_buffer_km`, default 2 km, 0 to 50). Reference data such as population is
 * imported for this box. Drawn means the street lines, the railway design, the road depots, the GIS regions
 * and the cargo bike route; the railway is stored in metres on a transverse Mercator centred on its origin
 * (crates/rail-design/src/proj.rs), which is converted back here.
 */

export type Bbox = [number, number, number, number];

/** Default buffer round the drawn box, km. */
export const DEFAULT_AREA_BUFFER_KM = 2;
/** Largest buffer, km (also checked by the database). */
export const MAX_AREA_BUFFER_KM = 50;

/** The project area. */
export interface ProjectArea {
  /** The drawn box widened by the buffer, `[west, south, east, north]` in degrees. */
  bbox: Bbox;
  /** The box round everything drawn. */
  drawnBbox: Bbox;
  bufferKm: number;
}

type LonLat = [number, number];

const isLonLat = (p: unknown): p is LonLat =>
  Array.isArray(p) &&
  p.length >= 2 &&
  typeof p[0] === "number" &&
  typeof p[1] === "number" &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Purpose: every drawn point of a project's drawings, by drawing kind, in degrees.
 * Inputs: the drawing documents by kind (as saved). Output: the points; malformed parts are skipped.
 */
export function drawnPoints(docs: Record<string, unknown>): LonLat[] {
  const out: LonLat[] = [];
  const add = (p: unknown) => {
    if (isLonLat(p)) out.push([p[0], p[1]]);
  };
  for (const line of arr(obj(docs["street-lines"]).lines))
    for (const pt of arr(obj(line).points)) add(obj(pt).lonlat);
  for (const d of arr(obj(docs.depots).depots)) {
    const depot = obj(d);
    arr(depot.boundary).forEach(add);
    for (const g of arr(depot.gates)) add(obj(g).lonlat);
    for (const z of arr(depot.zones)) arr(obj(z).ring).forEach(add);
  }
  for (const r of arr(obj(docs.regions).regions)) arr(obj(r).ring).forEach(add);
  const bike = obj(docs["cargo-bike"]);
  add(bike.start);
  add(bike.destination);
  const rail = obj(docs.railway);
  if (isLonLat(rail.origin)) {
    const xy: [number, number][] = [];
    const addXy = (o: unknown) => {
      const p = obj(o);
      if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y))
        xy.push([p.x, p.y]);
    };
    arr(rail.stations).forEach(addXy);
    for (const t of arr(rail.tracks)) {
      const track = obj(t);
      arr(track.points).forEach(addXy);
      for (const a of [track.start, track.end]) if (obj(a).type === "free") addXy(a);
    }
    if (xy.length) {
      const [lon0, lat0] = rail.origin;
      const tm = proj4(
        `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`,
        "EPSG:4326",
      );
      for (const p of xy) add(tm.forward(p));
    }
  }
  return out;
}

/** Purpose: the box round some points, or null when there are none. */
export function boxOf(points: LonLat[]): Bbox | null {
  if (!points.length) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of points) {
    w = Math.min(w, lon);
    s = Math.min(s, lat);
    e = Math.max(e, lon);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

/**
 * Purpose: a box widened by `km` on every side (metres to degrees at the box's widest latitude), clamped to
 * valid longitudes and latitudes.
 */
export function bufferedBox(b: Bbox, km: number): Bbox {
  const dLat = (km * 1000) / 111_320;
  const lat = Math.min(89, Math.max(Math.abs(b[1]), Math.abs(b[3])));
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return [
    Math.max(-180, b[0] - dLon),
    Math.max(-90, b[1] - dLat),
    Math.min(180, b[2] + dLon),
    Math.min(90, b[3] + dLat),
  ];
}

/**
 * Purpose: a project's area. Inputs: database, project id, an optional buffer (else the project's own).
 * Output: the area, or null when nothing is drawn yet. The caller checks access first.
 */
export async function projectArea(
  db: Database,
  projectId: string,
  bufferKm?: number,
): Promise<ProjectArea | null> {
  const rows = await db
    .selectFrom("project.drawing")
    .select(["kind", "doc"])
    .where("project_id", "=", projectId)
    .where("kind", "in", ["street-lines", "railway", "depots", "regions", "cargo-bike"])
    .execute();
  const docs: Record<string, unknown> = {};
  for (const r of rows) docs[r.kind] = r.doc;
  const drawnBbox = boxOf(drawnPoints(docs));
  if (!drawnBbox) return null;
  let km = bufferKm;
  if (km === undefined) {
    const p = await db
      .selectFrom("project.project")
      .select("area_buffer_km as km")
      .where("id", "=", projectId)
      .executeTakeFirst();
    km = p ? Number(p.km) : DEFAULT_AREA_BUFFER_KM;
  }
  return { bbox: bufferedBox(drawnBbox, km), drawnBbox, bufferKm: km };
}

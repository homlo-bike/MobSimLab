import proj4 from "proj4";
import type { Database } from "../db/database";
import { type AreaPolygon, polygonsBox, storedPolygons } from "./area-polygons";

/**
 * The project area (06-gis §1, §3): the polygons the planner drew in the area window (area-polygons.ts), each with
 * a detail setting. Map data (OpenStreetMap, elevation, population) is imported only for them; a project without
 * polygons has no area yet. `drawnPoints` lists everything drawn (street lines, the railway design, the road
 * depots, the GIS regions and the cargo bike route) for the checks that warn about drawing outside the area; the
 * railway is stored in metres on a transverse Mercator centred on its origin (crates/rail-design/src/proj.rs),
 * which is converted back here.
 */

export type Bbox = [number, number, number, number];

/** The project area. */
export interface ProjectArea {
  /** The box round the polygons, `[west, south, east, north]` in degrees: what box-based imports cover. */
  bbox: Bbox;
  /** The polygons the planner drew. Never empty. */
  polygons: AreaPolygon[];
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

/** Purpose: the box round two boxes, either of which may be missing. */
export function joinBoxes(a: Bbox | null, b: Bbox | null): Bbox | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Purpose: a project's area. Inputs: database, project id. Output: the area, or null when the planner has not
 * drawn one yet. The caller checks access first.
 */
export async function projectArea(db: Database, projectId: string): Promise<ProjectArea | null> {
  const p = await db
    .selectFrom("project.project")
    .select("area_polygons")
    .where("id", "=", projectId)
    .executeTakeFirst();
  const polygons = storedPolygons(p?.area_polygons);
  const bbox = polygonsBox(polygons);
  return bbox ? { bbox, polygons } : null;
}

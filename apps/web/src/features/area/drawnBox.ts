/**
 * The box round everything drawn in a project, for opening the map on a project that has no project area (a
 * project opened from a file without map data, or one whose area was never drawn). Drawn means the street lines,
 * the railway design, the road depots, the GIS regions, the cargo bike route and the plugin lines (ferries and
 * other modes). The railway is stored in metres on a transverse Mercator centred on its origin
 * (crates/rail-design/src/proj.rs); a spherical inverse is close enough to frame the map.
 */

export type Bbox = [number, number, number, number];
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

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = 180 / Math.PI;

/** Purpose: degrees of a point given in metres on a transverse Mercator centred on `origin` (spherical). */
export function fromLocalMetres(origin: LonLat, x: number, y: number): LonLat {
  const lat0 = origin[1] / DEG;
  const d = y / EARTH_RADIUS_M + lat0;
  const k = x / EARTH_RADIUS_M;
  const lat = Math.asin(Math.sin(d) / Math.cosh(k));
  const lon = origin[0] / DEG + Math.atan2(Math.sinh(k), Math.cos(d));
  return [lon * DEG, lat * DEG];
}

/**
 * Purpose: every drawn point of a project's drawings, in degrees.
 * Inputs: the drawing documents by kind (as saved). Output: the points; malformed parts are skipped.
 */
export function drawnPoints(docs: Partial<Record<string, unknown>>): LonLat[] {
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
  for (const t of Object.values(obj(obj(docs["plugin-lines"]).tools)))
    for (const s of arr(obj(obj(t).line).stops)) add(obj(s).lonlat);
  const rail = obj(docs.railway);
  if (isLonLat(rail.origin)) {
    const origin = rail.origin;
    const addXy = (o: unknown) => {
      const p = obj(o);
      if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y))
        add(fromLocalMetres(origin, p.x, p.y));
    };
    arr(rail.stations).forEach(addXy);
    for (const t of arr(rail.tracks)) {
      const track = obj(t);
      arr(track.points).forEach(addXy);
      for (const a of [track.start, track.end]) if (obj(a).type === "free") addXy(a);
    }
  }
  return out;
}

/**
 * Purpose: the box round everything drawn, `[west, south, east, north]` in degrees, or null when nothing is drawn.
 * Inputs: the drawings by kind as the API returns them (each with its `doc`).
 */
export function drawnBox(drawings: Partial<Record<string, { doc?: unknown } | undefined>>): Bbox | null {
  const docs: Record<string, unknown> = {};
  for (const [kind, d] of Object.entries(drawings)) docs[kind] = d?.doc;
  const points = drawnPoints(docs);
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

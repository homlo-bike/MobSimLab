import { inArea, type LonLat } from "./api";

/**
 * What lies outside the project area (large-area projects, step 2): drawn lines, stations and depots with a part
 * outside every polygon, where there is no map data. The notifications button lists them as warnings; the planner
 * extends the area to fix them.
 */

/** A drawing with a part outside the project area. */
export interface OutsideDrawing {
  kind: "streetLine" | "pluginLine" | "railway" | "depot" | "cargoBike";
  name: string;
}

interface Docs {
  streetLines?: {
    lines?: { name?: string; points?: { lonlat?: LonLat }[]; view?: { legs?: { coords?: LonLat[] }[] } }[];
  } | null;
  railway?: {
    origin?: LonLat;
    stations?: { x: number; y: number }[];
    tracks?: { points?: { x: number; y: number }[] }[];
  } | null;
  depots?: { depots?: { name?: string; boundary?: LonLat[] }[] } | null;
  cargoBike?: { start?: LonLat | null; destination?: LonLat | null } | null;
  /** The "plugin-lines" drawing: ferry, cable car and people mover lines by key (`ferry`, `ferry-2`, `cable-car`…). */
  pluginLines?: { tools?: Record<string, { doc?: unknown; line?: { name?: string } | null }> } | null;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const lonLat = (v: unknown): LonLat | undefined =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : undefined;

/** Purpose: the points of a plugin line's drawing: ferry piers, via points and speed zones, ropeway stations. */
function pluginPoints(doc: unknown): (LonLat | undefined)[] {
  const d = obj(doc);
  const pts: (LonLat | undefined)[] = [];
  for (const p of arr(d.piers)) pts.push(lonLat(obj(p).lonlat));
  for (const c of arr(d.calls)) for (const v of arr(obj(c).via)) pts.push(lonLat(v));
  for (const z of arr(d.zones)) for (const v of arr(obj(z).ring)) pts.push(lonLat(v));
  for (const st of arr(d.stations)) pts.push(lonLat(obj(st).lonlat));
  return pts;
}

const R = 6_378_137;
const RAD = Math.PI / 180;

/**
 * Purpose: a point of the railway design (metres east and north on a transverse Mercator round its origin, as
 * crates/rail-design/src/proj.rs) back in degrees, on a sphere: within a few hundred metres over 300 km, enough
 * to tell whether it lies in the project area.
 */
export function railLonLat(origin: LonLat, x: number, y: number): LonLat {
  const d = y / R + origin[1] * RAD;
  const lat = Math.asin(Math.sin(d) / Math.cosh(x / R));
  const lon = origin[0] * RAD + Math.atan2(Math.sinh(x / R), Math.cos(d));
  return [lon / RAD, lat / RAD];
}

/**
 * Purpose: the drawings with a point outside every polygon of the project area.
 * Inputs: the drawing documents and the polygons. Output: empty without polygons (no area yet) or when all is
 * inside.
 */
export function outsideDrawings(
  docs: Docs,
  polygons: readonly { ring: readonly LonLat[] }[],
): OutsideDrawing[] {
  if (!polygons.length) return [];
  const out: OutsideDrawing[] = [];
  const outside = (ps: readonly (LonLat | null | undefined)[]) =>
    ps.some((p) => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && !inArea(p, polygons));
  for (const line of docs.streetLines?.lines ?? []) {
    const pts: (LonLat | undefined)[] = (line.points ?? []).map((p) => p.lonlat);
    for (const leg of line.view?.legs ?? []) pts.push(...(leg.coords ?? []));
    if (outside(pts)) out.push({ kind: "streetLine", name: line.name ?? "" });
  }
  for (const [key, t] of Object.entries(docs.pluginLines?.tools ?? {}))
    if (outside(pluginPoints(t.doc))) out.push({ kind: "pluginLine", name: t.line?.name || key });
  const rail = docs.railway;
  if (rail?.origin) {
    const xy = [...(rail.stations ?? []), ...(rail.tracks ?? []).flatMap((t) => t.points ?? [])];
    if (outside(xy.map((p) => railLonLat(rail.origin!, p.x, p.y)))) out.push({ kind: "railway", name: "" });
  }
  for (const d of docs.depots?.depots ?? [])
    if (outside(d.boundary ?? [])) out.push({ kind: "depot", name: d.name ?? "" });
  const bike = docs.cargoBike;
  if (bike && outside([bike.start, bike.destination])) out.push({ kind: "cargoBike", name: "" });
  return out;
}

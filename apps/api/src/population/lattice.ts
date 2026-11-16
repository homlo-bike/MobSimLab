import { sql } from "kysely";
import type { Database } from "../db/database";
import type { Bbox } from "../projects/project-area";
import { ringAreaM2 } from "./uploads";

/**
 * Population layers on a regular longitude and latitude lattice, for the readers that expect a grid (the
 * noise map, the walk analysis, the benefit tables) and for the difference layer. A lattice of cell size `d`
 * degrees is anchored at 180° W, 90° S, so lattices of the same size line up; at 3 arc seconds it is
 * WorldPop's lattice.
 *
 * A feature's people go to the lattice cells whose centre lies inside it, in equal shares; a feature smaller
 * than a cell, or one no centre falls into, gives all its people to the cell that holds a point inside it
 * (PostGIS `ST_PointOnSurface`). People of a feature that reaches outside the lattice are shared over all its
 * cells, inside and out, so a box never counts more than its share.
 */

/** People per cell over an area, rows from the south. */
export interface Lattice {
  /** Longitude of the west edge, latitude of the south edge, degrees. */
  x0: number;
  y0: number;
  /** Cell size, degrees. */
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  /** People per cell, row by row from the south-west (longitude fastest). */
  people: Float64Array;
}

/** Most cells a lattice may have (about 2,000 × 2,000). */
export const MAX_LATTICE_CELLS = 4_000_000;
/** Most lattice cells checked for one feature before its share is estimated from its area instead. */
const MAX_CANDIDATES = 2_000_000;

/** Purpose: the empty lattice of cell size `d` degrees covering a box. Throws RangeError when it is too large. */
export function latticeOver(b: Bbox, d: number): Lattice {
  const c0 = Math.floor((b[0] + 180) / d + 1e-6);
  const c1 = Math.ceil((b[2] + 180) / d - 1e-6);
  const r0 = Math.floor((b[1] + 90) / d + 1e-6);
  const r1 = Math.ceil((b[3] + 90) / d - 1e-6);
  const nx = Math.max(1, c1 - c0);
  const ny = Math.max(1, r1 - r0);
  if (nx * ny > MAX_LATTICE_CELLS)
    throw new RangeError(
      `The area has more than ${MAX_LATTICE_CELLS.toLocaleString("en")} cells; use larger cells`,
    );
  return { x0: -180 + c0 * d, y0: -90 + r0 * d, dx: d, dy: d, nx, ny, people: new Float64Array(nx * ny) };
}

type Ring = [number, number][];
/** A feature's geometry as stored (GeoJSON), or null when only its inside point matters. */
export type StoredGeometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] }
  | { type: "Point"; coordinates: [number, number] }
  | { type: string; coordinates: unknown };

/** Purpose: whether a point lies inside a polygon (rings: outer and holes; even-odd). */
export function inPolygon(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/**
 * Purpose: add one feature's people to a lattice.
 * Inputs: the lattice, a point inside the feature, its geometry (null for points and for features no larger
 * than a cell) and its people.
 */
export function addFeature(
  l: Lattice,
  px: number,
  py: number,
  geom: StoredGeometry | null,
  people: number,
): void {
  if (!(people > 0)) return;
  const cellOf = (x: number, y: number): number => {
    const i = Math.floor((x - l.x0) / l.dx);
    const j = Math.floor((y - l.y0) / l.dy);
    return i >= 0 && i < l.nx && j >= 0 && j < l.ny ? j * l.nx + i : -1;
  };
  const polys: Ring[][] =
    geom?.type === "Polygon"
      ? [geom.coordinates as Ring[]]
      : geom?.type === "MultiPolygon"
        ? (geom.coordinates as Ring[][])
        : [];
  if (!polys.length) {
    const k = cellOf(px, py);
    if (k >= 0) l.people[k] = l.people[k]! + people;
    return;
  }
  // Cells of the global lattice whose centres may lie in the feature.
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polys)
    for (const [x, y] of poly[0] ?? []) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  const gi0 = Math.floor((w - l.x0) / l.dx - 0.5) + 1;
  const gi1 = Math.ceil((e - l.x0) / l.dx - 0.5) - 1;
  const gj0 = Math.floor((s - l.y0) / l.dy - 0.5) + 1;
  const gj1 = Math.ceil((n - l.y0) / l.dy - 0.5) - 1;
  const candidates = Math.max(0, gi1 - gi0 + 1) * Math.max(0, gj1 - gj0 + 1);
  const inside = (i: number, j: number) => {
    const x = l.x0 + (i + 0.5) * l.dx;
    const y = l.y0 + (j + 0.5) * l.dy;
    return polys.some((p) => inPolygon(x, y, p));
  };
  if (candidates > MAX_CANDIDATES) {
    // A very large feature: its cells inside the lattice share its people by area.
    const m = (s + n) / 2;
    const cellM2 = ringAreaM2([
      [0, m],
      [l.dx, m],
      [l.dx, m + l.dy],
      [0, m + l.dy],
    ]);
    const areaM2 = polys.reduce(
      (a, p) => a + ringAreaM2(p[0]!) - p.slice(1).reduce((h, r) => h + ringAreaM2(r), 0),
      0,
    );
    const total = Math.max(1, areaM2 / cellM2);
    for (let j = Math.max(0, gj0); j <= Math.min(l.ny - 1, gj1); j++)
      for (let i = Math.max(0, gi0); i <= Math.min(l.nx - 1, gi1); i++)
        if (inside(i, j)) l.people[j * l.nx + i] = l.people[j * l.nx + i]! + people / total;
    return;
  }
  const hits: number[] = [];
  let total = 0;
  for (let j = gj0; j <= gj1; j++)
    for (let i = gi0; i <= gi1; i++)
      if (inside(i, j)) {
        total++;
        if (i >= 0 && i < l.nx && j >= 0 && j < l.ny) hits.push(j * l.nx + i);
      }
  if (!total) {
    const k = cellOf(px, py);
    if (k >= 0) l.people[k] = l.people[k]! + people;
    return;
  }
  for (const k of hits) l.people[k] = l.people[k]! + people / total;
}

/**
 * Purpose: a stored population layer on a lattice of cell size `d` degrees over a box.
 * Side effects: reads the layer's features that touch the box.
 */
export async function layerLattice(db: Database, layerId: string, b: Bbox, d: number): Promise<Lattice> {
  const l = latticeOver(b, d);
  const env = sql`ST_MakeEnvelope(${l.x0}, ${l.y0}, ${l.x0 + l.nx * d}, ${l.y0 + l.ny * d}, 4326)`;
  const tol = d * 1.0001;
  const { rows } = await sql<{ people: number; x: number; y: number; g: string | null }>`
    SELECT f.people, ST_X(p.c) AS x, ST_Y(p.c) AS y,
      CASE WHEN GeometryType(f.geom) = 'POINT'
             OR (ST_XMax(f.geom) - ST_XMin(f.geom) <= ${tol} AND ST_YMax(f.geom) - ST_YMin(f.geom) <= ${tol})
           THEN NULL ELSE ST_AsGeoJSON(f.geom, 9) END AS g
    FROM geo.population_feature f
    CROSS JOIN LATERAL (SELECT ST_PointOnSurface(f.geom) AS c) p
    WHERE f.layer_id = ${layerId} AND f.geom && ${env}`.execute(db);
  for (const r of rows)
    addFeature(
      l,
      Number(r.x),
      Number(r.y),
      r.g ? (JSON.parse(r.g) as StoredGeometry) : null,
      Number(r.people),
    );
  return l;
}

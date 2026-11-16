/**
 * Export of the noise map (ADR-0038 step N3): the bands shown as contour polygons in GeoJSON, and the table of
 * buildings and residents per band as CSV. GeoPackage is left out (product owner, 2026-11-16); GeoJSON opens in
 * QGIS and other GIS tools.
 */
import type { LonLat } from "./types";

type Ring = LonLat[];

/** A GeoJSON MultiPolygon feature (RFC 7946). */
export interface PolygonFeature {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: { type: "MultiPolygon"; coordinates: Ring[][] };
}

export interface PolygonCollection {
  type: "FeatureCollection";
  features: PolygonFeature[];
}

/** Corners of the map picture: top left, top right, bottom right, bottom left. */
export type Corners = [LonLat, LonLat, LonLat, LonLat];

/** A grid of values, rows from the south, west to east (the engine's grid). */
export interface ValueGrid {
  values: ArrayLike<number>;
  width: number;
  height: number;
  corners: Corners;
}

/**
 * Purpose: trace the cells of one class into polygon rings in grid corner coordinates: outer rings
 * counter-clockwise, holes clockwise (RFC 7946), cells touching only at a corner kept apart.
 * Inputs: the class of each cell (rows from the south), the grid size and the class to trace.
 */
export function traceRings(
  cls: ArrayLike<number>,
  width: number,
  height: number,
  c: number,
): [number, number][][] {
  const inside = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < width && j < height && cls[j * width + i] === c;
  // Directed boundary edges with the class on their left, keyed by their start corner.
  const out = new Map<number, number[]>();
  const corner = (i: number, j: number) => j * (width + 1) + i;
  const add = (a: number, b: number) => {
    const list = out.get(a) ?? [];
    list.push(b);
    out.set(a, list);
  };
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      if (!inside(i, j)) continue;
      if (!inside(i, j - 1)) add(corner(i, j), corner(i + 1, j));
      if (!inside(i + 1, j)) add(corner(i + 1, j), corner(i + 1, j + 1));
      if (!inside(i, j + 1)) add(corner(i + 1, j + 1), corner(i, j + 1));
      if (!inside(i - 1, j)) add(corner(i, j + 1), corner(i, j));
    }
  const xy = (k: number): [number, number] => [k % (width + 1), Math.floor(k / (width + 1))];
  const rings: [number, number][][] = [];
  for (const [start, list] of out) {
    while (list.length) {
      const ring: [number, number][] = [xy(start)];
      let from = start;
      let to = list.pop()!;
      for (let guard = 0; guard < 4 * (width + 1) * (height + 1); guard++) {
        ring.push(xy(to));
        if (to === start) break;
        const next = out.get(to);
        if (!next?.length) break;
        // At a corner where two cells of the class touch diagonally, turn left to stay round the same cell.
        const [fx, fy] = xy(from);
        const [tx, ty] = xy(to);
        const d = [tx - fx, ty - fy];
        let pick = 0;
        if (next.length > 1) {
          const left = next.findIndex((n) => {
            const [nx, ny] = xy(n);
            return nx - tx === -d[1]! && ny - ty === d[0]!;
          });
          if (left >= 0) pick = left;
        }
        from = to;
        to = next.splice(pick, 1)[0]!;
      }
      rings.push(simplify(ring));
    }
  }
  return rings;
}

/** Purpose: drop the corners of a closed ring where it runs straight on. */
function simplify(ring: [number, number][]): [number, number][] {
  const pts = ring.slice(0, -1);
  const keep = pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length]!;
    const b = pts[(i + 1) % pts.length]!;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
  return [...keep, keep[0]!];
}

function signedArea(r: readonly [number, number][]): number {
  let s = 0;
  for (let i = 1; i < r.length; i++) s += r[i - 1]![0] * r[i]![1] - r[i]![0] * r[i - 1]![1];
  return s / 2;
}

function contains(r: readonly [number, number][], p: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Purpose: the rings of one class as GeoJSON polygon coordinates in longitude and latitude: each outer ring
 * with the holes inside it.
 */
export function classPolygons(cls: ArrayLike<number>, grid: Omit<ValueGrid, "values">, c: number): Ring[][] {
  const rings = traceRings(cls, grid.width, grid.height, c);
  const outers = rings.filter((r) => signedArea(r) > 0);
  const holes = rings.filter((r) => signedArea(r) < 0);
  const polygons = outers.map((o) => ({ outer: o, area: signedArea(o), holes: [] as [number, number][][] }));
  for (const h of holes) {
    // A point just inside the hole's first edge (on the class's side, its left).
    const [a, b] = [h[0]!, h[1]!];
    const p: [number, number] = [
      (a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.25,
      (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.25,
    ];
    const host = polygons.filter((x) => contains(x.outer, p)).sort((x, y) => x.area - y.area)[0];
    host?.holes.push(h);
  }
  const [tl, tr, , bl] = grid.corners;
  const lon = (i: number) => round(tl[0] + ((tr[0] - tl[0]) * i) / grid.width);
  const lat = (j: number) => round(bl[1] + ((tl[1] - bl[1]) * j) / grid.height);
  const ll = (r: [number, number][]): Ring => r.map(([i, j]) => [lon(i), lat(j)]);
  return polygons.map((x) => [ll(x.outer), ...x.holes.map(ll)]);
}

const round = (x: number) => Math.round(x * 1e7) / 1e7;

/** One class to export: which cells, its edges and what to call it. */
export interface ExportClass {
  /** Whether a value falls in the class. */
  test: (v: number) => boolean;
  properties: Record<string, string | number | null>;
}

/**
 * Purpose: contour polygons of a grid as a GeoJSON FeatureCollection, one MultiPolygon per class with cells.
 * Inputs: the grid, the classes, and properties every feature carries (indicator, scenario, input level).
 */
export function contoursGeoJson(
  grid: ValueGrid,
  classes: readonly ExportClass[],
  common: Record<string, string | number | null>,
): PolygonCollection {
  const cls = new Int16Array(grid.width * grid.height).fill(-1);
  for (let k = 0; k < cls.length; k++) {
    const v = grid.values[k]!;
    const c = classes.findIndex((x) => x.test(v));
    cls[k] = c;
  }
  const features: PolygonFeature[] = [];
  classes.forEach((c, i) => {
    const coordinates = classPolygons(cls, grid, i);
    if (!coordinates.length) return;
    features.push({
      type: "Feature",
      properties: { ...common, ...c.properties },
      geometry: { type: "MultiPolygon", coordinates },
    });
  });
  return { type: "FeatureCollection", features };
}

/** Purpose: one CSV field, quoted when it holds a comma, quote or line break. */
function field(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Purpose: a CSV text from a header and rows (RFC 4180, CRLF line ends). */
export function csv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  return [header, ...rows].map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

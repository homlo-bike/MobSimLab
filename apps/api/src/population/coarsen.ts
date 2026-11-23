import { AreaIndex, type AreaPolygon } from "../projects/area-polygons";

/** The population grid of "Main roads and railways only" polygons: 30 arc-seconds, about 1 km. */
export const MAIN_CELL_DEG = 1 / 120;

/** Grid cells as parallel arrays: west, south, east, north (degrees) and people. */
export interface Cells {
  w: number[];
  s: number[];
  e: number[];
  n: number[];
  p: number[];
}

/**
 * Purpose: keep the population of Full polygons at the grid's own resolution and sum the cells that lie only in
 * "Main roads and railways only" polygons into 30 arc-second cells, about 1 km (large-area projects, step 3).
 * Inputs: the cells (each already inside some polygon), the area's polygons. Output: the cells to store; the
 * total of people is unchanged. Without main polygons the cells come back as they are.
 */
export function coarsenMain(cells: Cells, polygons: readonly AreaPolygon[]): Cells {
  const main = polygons.filter((q) => q.detail === "main");
  if (!main.length) return cells;
  const full = new AreaIndex(polygons.filter((q) => q.detail !== "main"));
  const out: Cells = { w: [], s: [], e: [], n: [], p: [] };
  const blocks = new Map<string, { i: number; j: number; p: number }>();
  for (let k = 0; k < cells.p.length; k++) {
    const cx = (cells.w[k]! + cells.e[k]!) / 2;
    const cy = (cells.s[k]! + cells.n[k]!) / 2;
    if (full.contains(cx, cy)) {
      out.w.push(cells.w[k]!);
      out.s.push(cells.s[k]!);
      out.e.push(cells.e[k]!);
      out.n.push(cells.n[k]!);
      out.p.push(cells.p[k]!);
      continue;
    }
    const i = Math.floor(cx / MAIN_CELL_DEG);
    const j = Math.floor(cy / MAIN_CELL_DEG);
    const key = `${i}/${j}`;
    const b = blocks.get(key);
    if (b) b.p += cells.p[k]!;
    else blocks.set(key, { i, j, p: cells.p[k]! });
  }
  for (const b of blocks.values()) {
    out.w.push(b.i * MAIN_CELL_DEG);
    out.s.push(b.j * MAIN_CELL_DEG);
    out.e.push((b.i + 1) * MAIN_CELL_DEG);
    out.n.push((b.j + 1) * MAIN_CELL_DEG);
    out.p.push(b.p);
  }
  return out;
}

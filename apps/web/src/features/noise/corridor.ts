import type { LonLat } from "./types";

/** Metres per degree of latitude. */
const M_PER_DEG = 111_195;

/**
 * The land within a distance of the lines, as square cells of 1.25 times that distance: a cell is in the
 * corridor when it or one of its eight neighbours holds a point of a line (taken every 0.4 cell). Every place
 * within the distance of a line is in it; places up to about four times the distance away may be too.
 */
export class Corridor {
  /** Cell side, m. */
  readonly cellM: number;
  private readonly lat0: number;
  private readonly mPerLon: number;
  private readonly cells = new Set<number>();
  /** Box round the cells `[west, south, east, north]`, or null when there are none. */
  readonly bbox: [number, number, number, number] | null;

  /**
   * Inputs: the lines as paths of points (a point source is a path of one point) and the distance, m.
   */
  constructor(paths: readonly (readonly LonLat[])[], reachM: number) {
    this.cellM = Math.max(10, reachM * 1.25);
    let [sum, n] = [0, 0];
    for (const p of paths) for (const q of p) [sum, n] = [sum + q[1], n + 1];
    this.lat0 = n ? sum / n : 0;
    this.mPerLon = M_PER_DEG * Math.max(0.1, Math.cos((this.lat0 * Math.PI) / 180));
    // A place within the distance is at most 0.8 + 0.2 cells from a point taken, so in a neighbouring cell.
    const step = this.cellM * 0.4;
    const mark = (lon: number, lat: number) => {
      const [cx, cy] = this.cellOf(lon, lat);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) this.cells.add(key(cx + dx, cy + dy));
    };
    for (const path of paths)
      path.forEach((a, i) => {
        mark(a[0], a[1]);
        const b = path[i + 1];
        if (!b) return;
        const m = Math.hypot((b[0] - a[0]) * this.mPerLon, (b[1] - a[1]) * M_PER_DEG);
        const k = Math.ceil(m / step);
        for (let j = 1; j < k; j++) mark(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k);
      });
    let [w, s, e, nn] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of this.cells) {
      const [cx, cy] = unkey(c);
      w = Math.min(w, cx);
      e = Math.max(e, cx + 1);
      s = Math.min(s, cy);
      nn = Math.max(nn, cy + 1);
    }
    this.bbox = this.cells.size
      ? [
          (w * this.cellM) / this.mPerLon,
          (s * this.cellM) / M_PER_DEG,
          (e * this.cellM) / this.mPerLon,
          (nn * this.cellM) / M_PER_DEG,
        ]
      : null;
  }

  /** Purpose: the cell `[column, row]` holding a point. */
  private cellOf(lon: number, lat: number): [number, number] {
    return [Math.floor((lon * this.mPerLon) / this.cellM), Math.floor((lat * M_PER_DEG) / this.cellM)];
  }

  /** Purpose: whether a point is in the corridor. */
  has(lon: number, lat: number): boolean {
    const [cx, cy] = this.cellOf(lon, lat);
    return this.cells.has(key(cx, cy));
  }

  /** Purpose: whether a ring (a building footprint) has a corner in the corridor. */
  touches(ring: readonly LonLat[]): boolean {
    return ring.some((p) => this.has(p[0], p[1]));
  }

  /** Purpose: the corridor's cells as boxes `[west, south, east, north]`. */
  *boxes(): Generator<[number, number, number, number]> {
    for (const c of this.cells) {
      const [cx, cy] = unkey(c);
      yield [
        (cx * this.cellM) / this.mPerLon,
        (cy * this.cellM) / M_PER_DEG,
        ((cx + 1) * this.cellM) / this.mPerLon,
        ((cy + 1) * this.cellM) / M_PER_DEG,
      ];
    }
  }
}

/** Cell indices fit in 2^25 either way of zero (cells of 10 m or more cover the earth in under 2^22). */
const OFFSET = 2 ** 25;
const SPAN = 2 ** 26;
const key = (cx: number, cy: number) => (cx + OFFSET) * SPAN + (cy + OFFSET);
const unkey = (k: number): [number, number] => [Math.floor(k / SPAN) - OFFSET, (k % SPAN) - OFFSET];

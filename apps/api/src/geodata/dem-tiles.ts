import { deflateSync, inflateSync } from "node:zlib";
import type { DemWindow } from "../gateway/copernicus-dem.client";

/**
 * Elevation grids stored per project (06-gis §4, db/migrations/0017): a grid is cut into tiles of at most
 * TILE_PX × TILE_PX pixels that share their edge row and column with the next tile, so bilinear interpolation
 * never needs a second tile. Values are float32, little-endian, row by row from the north-west, deflated;
 * NaN is no data.
 */

export const TILE_PX = 256;

/** One stored tile, as `geo.dem_tile` holds it (values decoded). */
export interface DemTile {
  width: number;
  height: number;
  /** Centre of the north-west pixel, degrees. */
  originLon: number;
  originLat: number;
  stepLon: number;
  stepLat: number;
  values: Float32Array;
}

/** Purpose: the tile's outer edges `[west, south, east, north]` (pixel edges, not centres). */
export function tileBounds(t: Omit<DemTile, "values">): [number, number, number, number] {
  return [
    t.originLon - t.stepLon / 2,
    t.originLat - (t.height - 0.5) * t.stepLat,
    t.originLon + (t.width - 0.5) * t.stepLon,
    t.originLat + t.stepLat / 2,
  ];
}

/**
 * Purpose: cut a grid into tiles of at most `size` pixels a side that overlap by one row and column.
 * Tiles holding only no-data are left out (open sea).
 */
export function cutTiles(w: DemWindow, size = TILE_PX): DemTile[] {
  const out: DemTile[] = [];
  const stride = Math.max(1, size - 1);
  for (let y0 = 0; y0 < w.height; y0 += stride) {
    const th = Math.min(size, w.height - y0);
    for (let x0 = 0; x0 < w.width; x0 += stride) {
      const tw = Math.min(size, w.width - x0);
      const values = new Float32Array(tw * th);
      let any = false;
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const v = w.values[(y0 + y) * w.width + x0 + x]!;
          values[y * tw + x] = v;
          if (!Number.isNaN(v)) any = true;
        }
      }
      if (any)
        out.push({
          width: tw,
          height: th,
          originLon: w.originLon + x0 * w.stepLon,
          originLat: w.originLat - y0 * w.stepLat,
          stepLon: w.stepLon,
          stepLat: w.stepLat,
          values,
        });
      if (x0 + tw >= w.width) break;
    }
    if (y0 + th >= w.height) break;
  }
  return out;
}

/** Purpose: tile values as stored (float32 little-endian, deflated). */
export function encodeValues(values: Float32Array): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i]!, i * 4);
  return deflateSync(buf, { level: 6 });
}

/** Purpose: tile values from storage. Throws when the data does not hold width × height values. */
export function decodeValues(data: Uint8Array, width: number, height: number): Float32Array {
  const raw = inflateSync(data, { maxOutputLength: width * height * 4 + 1 });
  if (raw.byteLength !== width * height * 4) throw new Error("DEM tile has the wrong size");
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = raw.readFloatLE(i * 4);
  return out;
}

/** Purpose: whether a point falls on a tile (inside its outer edges). */
export function covers(t: Omit<DemTile, "values">, lon: number, lat: number): boolean {
  const [w, s, e, n] = tileBounds(t);
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

/**
 * Purpose: the height at a point, interpolated bilinearly between the four nearest pixels, as the live GLO-30
 * reader does (clamped at the tile edge; no-data pixels left out of the weights).
 * Output: metres rounded to the centimetre, or null where every neighbour is no data or the point is off the tile.
 */
export function sample(t: DemTile, lon: number, lat: number): number | null {
  if (!covers(t, lon, lat)) return null;
  const fx = Math.min(Math.max((lon - t.originLon) / t.stepLon, 0), t.width - 1);
  const fy = Math.min(Math.max((t.originLat - lat) / t.stepLat, 0), t.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, t.width - 1);
  const y1 = Math.min(y0 + 1, t.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const px = (x: number, y: number) => t.values[y * t.width + x]!;
  const ws: Array<[number, number]> = [
    [px(x0, y0), (1 - tx) * (1 - ty)],
    [px(x1, y0), tx * (1 - ty)],
    [px(x0, y1), (1 - tx) * ty],
    [px(x1, y1), tx * ty],
  ];
  let sum = 0;
  let wsum = 0;
  for (const [v, wt] of ws) {
    if (!Number.isNaN(v) && wt > 0) {
      sum += v * wt;
      wsum += wt;
    }
  }
  if (wsum > 0) return Math.round((sum / wsum) * 100) / 100;
  return null;
}

/** Street tiles: the editor loads OSM streets for the area on screen, one zoom-14 tile at a time. */

export const TILE_ZOOM = 14;
/** Streets load from this map zoom; below it the area on screen is too large. */
export const MIN_LOAD_ZOOM = 13;
/** At most this many tiles are requested for one view. */
export const MAX_TILES_PER_VIEW = 16;

/** Purpose: web-mercator tile column for a longitude. */
export function tileX(lon: number, z = TILE_ZOOM): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

/** Purpose: web-mercator tile row for a latitude. */
export function tileY(lat: number, z = TILE_ZOOM): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/**
 * Purpose: tiles covering a view, nearest to the centre first.
 * Inputs: bounds `[west, south, east, north]`. Output: `[x, y]` pairs, at most MAX_TILES_PER_VIEW.
 */
export function tilesFor([w, s, e, n]: [number, number, number, number]): [number, number][] {
  const [x0, x1, y0, y1] = [tileX(w), tileX(e), tileY(n), tileY(s)];
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  return out.slice(0, MAX_TILES_PER_VIEW);
}

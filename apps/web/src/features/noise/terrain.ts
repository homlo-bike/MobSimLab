import { fetchElevations } from "../../terrain/terrain";
import { Corridor } from "./corridor";
import type { LonLat, NoiseTerrain } from "./types";

/** Finest terrain spacing for the noise map, m (the Copernicus GLO-30 grid). */
export const TERRAIN_SPACING_M = 30;
/**
 * Most terrain heights loaded for one noise map (20 requests to the terrain API): the heights along the lines,
 * not over the whole box round them, so a whole city's network fits at 30 m.
 */
export const MAX_TERRAIN_POINTS = 400_000;
/** Most samples of the grid the engine gets, loaded or not (those away from the lines it fills itself). */
export const MAX_TERRAIN_CELLS = 2_000_000;
/** Coarsest spacing still worth using, m: beyond it the map is computed on flat ground. */
export const MAX_TERRAIN_SPACING_M = 90;
/** Spacings tried, finest first, m. */
const SPACINGS_M = [30, 40, 50, 60, 75, 90];
/** Heights per request to the terrain API (its limit). */
const CHUNK = 20_000;
/** Requests to the terrain API at the same time. */
const PARALLEL_REQUESTS = 3;

/** Fetches ground heights at points; null where the terrain source has no data. */
export type HeightsFetcher = (points: LonLat[]) => Promise<(number | null)[]>;

/** Purpose: heights from the shared terrain API (Copernicus GLO-30). */
export const fetchHeights: HeightsFetcher = (points) => fetchElevations(points).then((r) => r.elevationsM);

/** The terrain grid to load: south-west corner and spacing in degrees, size, and the samples to load. */
export interface TerrainPlan {
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  nx: number;
  ny: number;
  spacingM: number;
  /** Indices (row by row from the south-west) of the samples near the lines, the only ones loaded. */
  samples: Uint32Array;
}

/**
 * Purpose: the grid of terrain heights over the lines, at 30 m or coarser so it stays within MAX_TERRAIN_POINTS
 * and MAX_TERRAIN_CELLS. Only the samples within `reachM` (and two more steps) of the lines are loaded; the
 * engine fills the rest of the grid from them, and no path of the map reaches there.
 * Inputs: the lines as paths of points (a point source is a path of one point), the map's reach, m.
 * Output: the plan, or null when even MAX_TERRAIN_SPACING_M would need too many.
 */
export function terrainPlan(paths: readonly (readonly LonLat[])[], reachM: number): TerrainPlan | null {
  if (!paths.some((p) => p.length)) return null;
  for (const spacingM of SPACINGS_M) {
    const corridor = new Corridor(paths, reachM + 2 * spacingM);
    const box = corridor.bbox;
    if (!box) return null;
    const mid = (box[1] + box[3]) / 2;
    const mPerLat = 111_195;
    const mPerLon = mPerLat * Math.max(0.1, Math.cos((mid * Math.PI) / 180));
    const dLon = spacingM / mPerLon;
    const dLat = spacingM / mPerLat;
    const nx = Math.ceil((box[2] - box[0]) / dLon) + 1;
    const ny = Math.ceil((box[3] - box[1]) / dLat) + 1;
    if (nx * ny > MAX_TERRAIN_CELLS) continue;
    const wanted: number[] = [];
    for (let j = 0; j < ny && wanted.length <= MAX_TERRAIN_POINTS; j++)
      for (let i = 0; i < nx; i++)
        if (corridor.has(box[0] + i * dLon, box[1] + j * dLat)) wanted.push(j * nx + i);
    if (wanted.length > MAX_TERRAIN_POINTS) continue;
    return { lon0: box[0], lat0: box[1], dLon, dLat, nx, ny, spacingM, samples: Uint32Array.from(wanted) };
  }
  return null;
}

/**
 * Purpose: load the heights of a terrain plan, row by row from the south-west (longitude fastest),
 * as the noise engine takes them; null at the samples the plan leaves out.
 * Side effects: one request to the terrain API per 20,000 heights, a few at a time; `onProgress` after each,
 * and `signal` stops before the next one.
 */
export async function loadTerrain(
  plan: TerrainPlan,
  fetch: HeightsFetcher,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<NoiseTerrain> {
  const z: (number | null)[] = new Array<number | null>(plan.nx * plan.ny).fill(null);
  const all = plan.samples;
  let [next, done] = [0, 0];
  const worker = async () => {
    while (next < all.length) {
      signal?.throwIfAborted();
      const from = next;
      next = Math.min(all.length, next + CHUNK);
      const idx = all.subarray(from, next);
      const pts: LonLat[] = Array.from(idx, (k) => [
        plan.lon0 + (k % plan.nx) * plan.dLon,
        plan.lat0 + Math.floor(k / plan.nx) * plan.dLat,
      ]);
      const got = await fetch(pts);
      idx.forEach((k, i) => (z[k] = got[i] ?? null));
      done += idx.length;
      onProgress?.(done, all.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_REQUESTS, Math.ceil(all.length / CHUNK)) }, worker),
  );
  signal?.throwIfAborted();
  return { x0: plan.lon0, y0: plan.lat0, dx: plan.dLon, dy: plan.dLat, nx: plan.nx, ny: plan.ny, z };
}

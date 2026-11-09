import { fetchElevations } from "../../terrain/terrain";
import type { LonLat, NoiseTerrain } from "./types";

/** Finest terrain spacing for the noise map, m (the Copernicus GLO-30 grid). */
export const TERRAIN_SPACING_M = 30;
/** Most terrain heights loaded for one noise map (two requests to the terrain API). */
export const MAX_TERRAIN_POINTS = 40_000;
/** Coarsest spacing still worth using, m: beyond it the map is computed on flat ground. */
export const MAX_TERRAIN_SPACING_M = 90;
/** Heights per request to the terrain API (its limit). */
const CHUNK = 20_000;

/** Fetches ground heights at points; null where the terrain source has no data. */
export type HeightsFetcher = (points: LonLat[]) => Promise<(number | null)[]>;

/** Purpose: heights from the shared terrain API (Copernicus GLO-30). */
export const fetchHeights: HeightsFetcher = (points) => fetchElevations(points).then((r) => r.elevationsM);

/** The terrain grid to load: south-west corner and spacing in degrees, size. */
export interface TerrainPlan {
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  nx: number;
  ny: number;
  spacingM: number;
}

/**
 * Purpose: the grid of terrain heights covering points widened by `reachM` (and one more step),
 * at 30 m or coarser so it stays within MAX_TERRAIN_POINTS.
 * Output: the plan, or null when even MAX_TERRAIN_SPACING_M would need more points.
 */
export function terrainPlan(points: LonLat[], reachM: number): TerrainPlan | null {
  if (!points.length) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mPerLat = 111_195;
  const mPerLon = mPerLat * Math.max(0.1, Math.cos((lat0 * Math.PI) / 180));
  const widthM = (Math.max(...lons) - Math.min(...lons)) * mPerLon + 2 * reachM;
  const heightM = (Math.max(...lats) - Math.min(...lats)) * mPerLat + 2 * reachM;
  const spacingM = Math.max(TERRAIN_SPACING_M, Math.sqrt((widthM * heightM) / MAX_TERRAIN_POINTS) * 1.05);
  if (spacingM > MAX_TERRAIN_SPACING_M) return null;
  const nx = Math.ceil(widthM / spacingM) + 3;
  const ny = Math.ceil(heightM / spacingM) + 3;
  if (nx * ny > MAX_TERRAIN_POINTS) return null;
  const dLon = spacingM / mPerLon;
  const dLat = spacingM / mPerLat;
  return {
    lon0: Math.min(...lons) - reachM / mPerLon - dLon,
    lat0: Math.min(...lats) - reachM / mPerLat - dLat,
    dLon,
    dLat,
    nx,
    ny,
    spacingM,
  };
}

/**
 * Purpose: load the heights of a terrain plan, row by row from the south-west (longitude fastest),
 * as the noise engine takes them.
 * Side effects: one request to the terrain API per 20,000 heights.
 */
export async function loadTerrain(plan: TerrainPlan, fetch: HeightsFetcher): Promise<NoiseTerrain> {
  const pts: LonLat[] = [];
  for (let j = 0; j < plan.ny; j++)
    for (let i = 0; i < plan.nx; i++) pts.push([plan.lon0 + i * plan.dLon, plan.lat0 + j * plan.dLat]);
  const z: (number | null)[] = [];
  for (let k = 0; k < pts.length; k += CHUNK) z.push(...(await fetch(pts.slice(k, k + CHUNK))));
  return { x0: plan.lon0, y0: plan.lat0, dx: plan.dLon, dy: plan.dLat, nx: plan.nx, ny: plan.ny, z };
}

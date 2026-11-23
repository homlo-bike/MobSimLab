/**
 * Ground heights for the journey planner: walks are timed on the slope between their two ends (Tobler's
 * hiking function, `journey.walk_slope_k`), so the planner needs the height of every stop and of A and B.
 * Heights come from the shared terrain source (the project's imported elevation, else Copernicus GLO-30).
 */
import { fetchElevations } from "../../terrain/terrain";
import type { LonLat, Timetable } from "./types";

/** Heights at points, in metres; null where the terrain has no data. */
export type HeightFetcher = (points: LonLat[]) => Promise<(number | null)[]>;

/** Points asked in one request (the API takes up to 20,000). */
const POINTS_PER_REQUEST = 5000;

/** Purpose: ground heights from the shared terrain source. */
export const fetchGroundHeights: HeightFetcher = (points) =>
  fetchElevations(points).then((r) => r.elevationsM);

/** Purpose: the key a stop's height is kept under (its position to about 10 cm). */
export const heightKey = ([lon, lat]: LonLat) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

/**
 * Purpose: the stop positions of a timetable whose heights are not known yet, each once.
 * Inputs: the timetable; heights already fetched (null for "no data", which is not asked again).
 */
export function missingStopPoints(tt: Timetable, known: ReadonlyMap<string, number | null>): LonLat[] {
  const out = new Map<string, LonLat>();
  for (const s of tt.stops) {
    const p: LonLat = [s.stop_lon, s.stop_lat];
    const k = heightKey(p);
    if (s.elevation_m === undefined && !known.has(k)) out.set(k, p);
  }
  return [...out.values()];
}

/**
 * Purpose: fetch heights for many points, a few thousand per request.
 * Output: the heights by `heightKey`.
 */
export async function fetchHeightsByKey(
  points: LonLat[],
  fetchHeights: HeightFetcher,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (let i = 0; i < points.length; i += POINTS_PER_REQUEST) {
    const batch = points.slice(i, i + POINTS_PER_REQUEST);
    const z = await fetchHeights(batch);
    batch.forEach((p, j) => {
      const h = z[j];
      out.set(heightKey(p), typeof h === "number" && Number.isFinite(h) ? h : null);
    });
  }
  return out;
}

/**
 * Purpose: the timetable with each stop's ground height (`elevation_m`) where it is known.
 * Output: the same object when no stop gains a height, so the planner is not compiled again for nothing.
 */
export function withStopHeights(tt: Timetable, heights: ReadonlyMap<string, number | null>): Timetable {
  let changed = false;
  const stops = tt.stops.map((s) => {
    if (s.elevation_m !== undefined) return s;
    const z = heights.get(heightKey([s.stop_lon, s.stop_lat]));
    if (typeof z !== "number") return s;
    changed = true;
    return { ...s, elevation_m: z };
  });
  return changed ? { ...tt, stops } : tt;
}

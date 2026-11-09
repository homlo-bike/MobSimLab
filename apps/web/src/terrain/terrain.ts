/**
 * Terrain heights for the editors: one shared source for the railway, cable car and other tools.
 * The API reads the Copernicus GLO-30 DEM (and optionally the OpenStreetMap buildings a line passes
 * over); see apps/api/src/terrain. Answers are cached per request for the session.
 */

export type LonLat = [number, number];

export interface TerrainSample {
  /** Metres from the line's start (great-circle). */
  distM: number;
  lon: number;
  lat: number;
  /** Metres above the EGM2008 geoid; null where the DEM has no data (open sea, outside coverage). */
  elevationM: number | null;
}

export interface BuildingCrossing {
  fromM: number;
  toM: number;
  heightM: number;
  estimated: boolean;
  osmId: number;
}

export interface TerrainSource {
  id: string;
  name: string;
  kind: string;
  note: string;
  resolutionM: number;
  verticalAccuracyM: number;
  verticalAccuracyNote: string;
  url: string;
  licence: string;
}

export interface TerrainLine {
  lengthM: number;
  samples: TerrainSample[];
  buildings?: BuildingCrossing[];
}

export interface TerrainProfiles {
  spacingM: number;
  lines: TerrainLine[];
  source: TerrainSource;
  buildingSource?: { name: string; note: string; licence: string; url: string };
}

export interface ProfileOptions {
  /** Sample spacing in metres (5 to 1000); every vertex is sampled too. Default 50. */
  spacingM?: number;
  /** Also list the OpenStreetMap buildings each line passes over (up to 50 lines of 20 km). */
  buildings?: boolean;
  fetchImpl?: typeof fetch;
}

const cache = new Map<string, Promise<unknown>>();
const CACHE_SIZE = 64;

async function post<T>(path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const key = `${path} ${JSON.stringify(body)}`;
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = (async () => {
    const res = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res
        .json()
        .then((j: { message?: string }) => j.message)
        .catch(() => undefined);
      throw new Error(msg ?? `Terrain heights failed (${res.status})`);
    }
    return (await res.json()) as T;
  })();
  p.catch(() => cache.delete(key));
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, p);
  return p;
}

/**
 * Purpose: height profiles of several lines in one request, sampled every `spacingM` and at every vertex.
 * Output: one profile per line, in order, with the DEM's source and accuracy.
 */
export function fetchProfiles(lines: LonLat[][], options: ProfileOptions = {}): Promise<TerrainProfiles> {
  const { spacingM = 50, buildings = false, fetchImpl = (...a) => fetch(...a) } = options;
  const body = { lines: lines.map((l) => l.map(round)), spacingM, ...(buildings ? { buildings } : {}) };
  return post<TerrainProfiles>("/api/terrain/profile", body, fetchImpl);
}

/** Purpose: heights at points, without resampling; null where the DEM has no data. */
export function fetchElevations(
  points: LonLat[],
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<{ elevationsM: (number | null)[]; source: TerrainSource }> {
  return post("/api/terrain/points", { points: points.map(round) }, fetchImpl);
}

/** Coordinates to 1e-7° (1 cm), so equal drawings share cache entries. */
function round([lon, lat]: LonLat): LonLat {
  return [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
}

/** A ground sample for the straight spans kit (crates/mode-kits `GroundSample`). */
export interface GroundSample {
  at_m: number;
  z_m: number;
  obstacle_m: number;
}

/**
 * Purpose: ground samples for one section of an aerial line: the DEM profile, with each building the
 * line passes over standing on the terrain beside it. GLO-30 is a surface model, so DEM samples on a
 * building are replaced by the lowest DEM height beside it (within 30 m, and at least the nearest sample
 * each side) plus the building's OSM height.
 * Inputs: the section's terrain line; the section length the kit measures (distances are scaled to it).
 * Output: samples sorted by chainage, without the two ends (the stations).
 */
export function sectionGround(line: TerrainLine, lengthM: number): GroundSample[] {
  const k = line.lengthM > 0 ? lengthM / line.lengthM : 1;
  const dem = line.samples
    .filter((s) => s.elevationM !== null)
    .map((s) => ({ at: s.distM, z: s.elevationM as number }));
  const zAt = (d: number) => {
    let prev = dem[0];
    for (const s of dem) {
      if (s.at >= d) {
        if (!prev || s.at === prev.at) return s.z;
        return prev.z + ((s.z - prev.z) * (d - prev.at)) / (s.at - prev.at);
      }
      prev = s;
    }
    return prev?.z ?? 0;
  };
  const blds = line.buildings ?? [];
  const onBuilding = (d: number) => blds.some((b) => d >= b.fromM && d <= b.toM);
  const out: GroundSample[] = dem
    .filter((s) => !onBuilding(s.at))
    .map((s) => ({ at_m: s.at * k, z_m: s.z, obstacle_m: 0 }));
  for (const b of blds) {
    // Terrain beside the building: samples off it within 30 m, and at least the nearest one each side.
    const off = dem.filter((s) => !onBuilding(s.at));
    const before = off.filter((s) => s.at < b.fromM).pop();
    const after = off.find((s) => s.at > b.toM);
    const near = [
      ...off.filter((s) => s.at >= b.fromM - 30 && s.at <= b.toM + 30),
      ...(before ? [before] : []),
      ...(after ? [after] : []),
    ].map((s) => s.z);
    const base = near.length ? Math.min(...near) : zAt((b.fromM + b.toM) / 2);
    const n = Math.max(1, Math.ceil((b.toM - b.fromM) / 10));
    for (let i = 0; i <= n; i++) {
      const d = b.fromM + ((b.toM - b.fromM) * i) / n;
      out.push({ at_m: d * k, z_m: base, obstacle_m: b.heightM });
    }
  }
  return out.filter((s) => s.at_m > 0.5 && s.at_m < lengthM - 0.5).sort((a, b) => a.at_m - b.at_m);
}

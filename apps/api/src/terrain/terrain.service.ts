import { Injectable, Optional } from "@nestjs/common";
import { CopernicusDemClient, DemError, TERRAIN_SOURCE } from "../gateway/copernicus-dem.client";
import { OPEN_ELEVATION_SOURCE, OpenElevationClient } from "../gateway/open-elevation.client";
import { OverpassClient } from "../gateway/overpass.client";
import { GeodataReader } from "../geodata/geodata-reader";
import { type BuildingCrossing, buildingQuery, crossings } from "./buildings";

/** Where the heights come from, shown next to every result that uses them (06-gis §4, C-09). */
export const BUILDING_SOURCE = {
  name: "OpenStreetMap buildings",
  note: "Heights from height, else building:levels × 3 m + 2 m roof; buildings without either are assumed 10 m and marked estimated.",
  licence: "© OpenStreetMap contributors, ODbL 1.0",
  url: "https://www.openstreetmap.org/copyright",
} as const;

/** Where the heights come from (moved to the GLO-30 client so the import can record it too). */
export { TERRAIN_SOURCE };

export const MAX_SAMPLES = 20_000;
/** Building lookups cost an Overpass request per line; keep them to lines a cable car could have. */
export const MAX_BUILDING_LINES = 50;
export const MAX_BUILDING_LINE_M = 20_000;
const EARTH_RADIUS_M = 6_371_008.8;

export type LonLat = [number, number];

export interface ProfileSample {
  distM: number;
  lon: number;
  lat: number;
  /** Null where the DEM has no data (open sea, outside coverage). */
  elevationM: number | null;
}

/** Purpose: great-circle distance between two points in metres. */
export function distanceM(a: LonLat, b: LonLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Purpose: points along a line every `spacingM` metres, plus every vertex (06-gis §4).
 * Output: positions with their distance from the start; consecutive duplicates are dropped.
 */
export function samplePositions(
  line: LonLat[],
  spacingM: number,
): Array<{ distM: number; lon: number; lat: number }> {
  const out: Array<{ distM: number; lon: number; lat: number }> = [];
  if (line.length === 0) return out;
  const push = (distM: number, lon: number, lat: number) => {
    const last = out[out.length - 1];
    if (last && distM - last.distM < 1e-6) return;
    out.push({ distM: Math.round(distM * 100) / 100, lon, lat });
  };
  push(0, line[0]![0], line[0]![1]);
  let start = 0;
  let next = spacingM;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = distanceM(a, b);
    while (next < start + len - 1e-6) {
      const t = (next - start) / len;
      push(next, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      next += spacingM;
    }
    start += len;
    push(start, b[0], b[1]);
  }
  return out;
}

/** A Source record of heights (GLO-30, the planner's own grid, Open-Elevation), as answers carry it. */
export type HeightSource = Record<string, unknown> & { verticalAccuracyM?: number };

/** Heights at points, and every source that gave one of them. */
export interface Heights {
  values: Array<number | null>;
  sources: HeightSource[];
}

/**
 * Purpose: the source to show next to a result: the least accurate of those used (C-09 shows the accuracy
 * next to every gradient, so a mixed result shows the worst), else GLO-30.
 */
export function mainSource(sources: HeightSource[]): HeightSource {
  let best: HeightSource | null = null;
  for (const s of sources)
    if (!best || Number(s.verticalAccuracyM ?? 0) > Number(best.verticalAccuracyM ?? 0)) best = s;
  return best ?? TERRAIN_SOURCE;
}

/**
 * Terrain heights for alignments: one shared source for the railway, cable car and other tools. With a project,
 * heights come first from the project's imported grids (the planner's own GeoTIFF, then GLO-30; ADR-0045); points
 * outside them are read live from the GLO-30 bucket, and when that cannot be read, from Open-Elevation
 * (unless the fallback is turned off).
 */
@Injectable()
export class TerrainService {
  private readonly buildingCache = new Map<string, BuildingCrossing[]>();

  constructor(
    private readonly dem: CopernicusDemClient,
    private readonly overpass: OverpassClient,
    @Optional() private readonly imported?: GeodataReader,
    @Optional() private readonly fallback?: OpenElevationClient,
  ) {}

  /**
   * Purpose: buildings each line passes over, from the project's OpenStreetMap import when it holds the line,
   * else from Overpass. Side effects: one Overpass request per line not yet cached.
   */
  async buildings(lines: LonLat[][], projectId?: string): Promise<BuildingCrossing[][]> {
    if (lines.length > MAX_BUILDING_LINES)
      throw new RangeError(`Buildings for at most ${MAX_BUILDING_LINES} lines per request`);
    for (const l of lines) {
      let len = 0;
      for (let i = 1; i < l.length; i++) len += distanceM(l[i - 1]!, l[i]!);
      if (len > MAX_BUILDING_LINE_M)
        throw new RangeError(`Buildings only along lines up to ${MAX_BUILDING_LINE_M / 1000} km`);
    }
    const out: BuildingCrossing[][] = [];
    for (const l of lines) {
      if (l.length < 2) {
        out.push([]);
        continue;
      }
      if (projectId && this.imported) {
        const pad = 0.001;
        const box: [number, number, number, number] = [
          Math.min(...l.map((p) => p[0])) - pad,
          Math.min(...l.map((p) => p[1])) - pad,
          Math.max(...l.map((p) => p[0])) + pad,
          Math.max(...l.map((p) => p[1])) + pad,
        ];
        const json = await this.imported.buildings(projectId, box);
        if (json !== null) {
          out.push(crossings(l, json));
          continue;
        }
      }
      const key = JSON.stringify(l.map(([x, y]) => [x.toFixed(6), y.toFixed(6)]));
      let hit = this.buildingCache.get(key);
      if (!hit) {
        hit = crossings(l, await this.overpass.run(buildingQuery(l)));
        if (this.buildingCache.size >= 512)
          this.buildingCache.delete(this.buildingCache.keys().next().value!);
        this.buildingCache.set(key, hit);
      }
      out.push(hit);
    }
    return out;
  }

  /** Purpose: heights at the given points, in order; null where no source has data. */
  async heights(points: LonLat[], projectId?: string): Promise<Heights> {
    const values: Array<number | null | undefined> = new Array(points.length).fill(undefined);
    const sources: HeightSource[] = [];
    if (projectId && this.imported) {
      const r = await this.imported.heights(projectId, points);
      r.values.forEach((v, i) => (values[i] = v));
      sources.push(...(r.sources as HeightSource[]));
    }
    const rest = values.flatMap((v, i) => (v === undefined ? [i] : []));
    if (rest.length) {
      try {
        const zs = await Promise.all(rest.map((i) => this.dem.elevation(points[i]![0], points[i]![1])));
        rest.forEach((i, k) => (values[i] = zs[k] ?? null));
        sources.push(TERRAIN_SOURCE);
      } catch (e) {
        if (!(e instanceof DemError) || !this.fallback) throw e;
        const zs = await this.fallback.elevations(rest.map((i) => points[i]!));
        rest.forEach((i, k) => (values[i] = zs[k] ?? null));
        sources.push(OPEN_ELEVATION_SOURCE);
      }
    }
    const seen = new Set<string>();
    return {
      values: values.map((v) => v ?? null),
      sources: sources.filter((s) => {
        const k = `${String(s.id ?? s.name)}|${String(s.retrievedAt ?? "")}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    };
  }

  /** Purpose: heights at the given points, in order; null where the DEM has no data. */
  async points(points: LonLat[], projectId?: string): Promise<Array<number | null>> {
    return (await this.heights(points, projectId)).values;
  }

  /** Purpose: a height profile per line, sampled every `spacingM` metres and at every vertex. */
  async profiles(lines: LonLat[][], spacingM: number, projectId?: string): Promise<ProfileSample[][]> {
    return (await this.profilesWithSources(lines, spacingM, projectId)).profiles;
  }

  /** Purpose: profiles as `profiles` makes them, with the sources of their heights. */
  async profilesWithSources(
    lines: LonLat[][],
    spacingM: number,
    projectId?: string,
  ): Promise<{ profiles: ProfileSample[][]; sources: HeightSource[] }> {
    const positions = lines.map((l) => samplePositions(l, spacingM));
    const total = positions.reduce((s, p) => s + p.length, 0);
    if (total > MAX_SAMPLES) throw new RangeError(`${total} samples; at most ${MAX_SAMPLES} per request`);
    const flat = positions.flat();
    const h = await this.heights(
      flat.map((p) => [p.lon, p.lat]),
      projectId,
    );
    let k = 0;
    return {
      profiles: positions.map((ps) => ps.map((p) => ({ ...p, elevationM: h.values[k++] ?? null }))),
      sources: h.sources,
    };
  }
}

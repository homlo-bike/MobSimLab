import { Injectable } from "@nestjs/common";
import { CopernicusDemClient } from "../gateway/copernicus-dem.client";
import { OverpassClient } from "../gateway/overpass.client";
import { type BuildingCrossing, buildingQuery, crossings } from "./buildings";

/** Where the heights come from, shown next to every result that uses them (06-gis §4, C-09). */
export const BUILDING_SOURCE = {
  name: "OpenStreetMap buildings",
  note: "Heights from height, else building:levels × 3 m + 2 m roof; buildings without either are assumed 10 m and marked estimated.",
  licence: "© OpenStreetMap contributors, ODbL 1.0",
  url: "https://www.openstreetmap.org/copyright",
} as const;

export const TERRAIN_SOURCE = {
  id: "copernicus_glo30",
  name: "Copernicus DEM GLO-30",
  kind: "DSM",
  note: "Surface model: heights include buildings and tree canopy. Heights are metres above the EGM2008 geoid.",
  resolutionM: 30,
  verticalAccuracyM: 4,
  verticalAccuracyNote:
    "Absolute vertical accuracy better than 4 m (90 % linear error), worse in steep terrain and forest.",
  url: "https://doi.org/10.5270/ESA-c5d3d65",
  licence:
    "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Free use under the Copernicus DEM licence.",
} as const;

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

/** Terrain heights for alignments: one shared source for the railway, cable car and other tools. */
@Injectable()
export class TerrainService {
  private readonly buildingCache = new Map<string, BuildingCrossing[]>();

  constructor(
    private readonly dem: CopernicusDemClient,
    private readonly overpass: OverpassClient,
  ) {}

  /**
   * Purpose: buildings each line passes over, from OpenStreetMap.
   * Side effects: one Overpass request per line not yet cached.
   */
  async buildings(lines: LonLat[][]): Promise<BuildingCrossing[][]> {
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
      const key = JSON.stringify(l.map(([x, y]) => [x.toFixed(6), y.toFixed(6)]));
      let hit = this.buildingCache.get(key);
      if (!hit) {
        hit = l.length < 2 ? [] : crossings(l, await this.overpass.run(buildingQuery(l)));
        if (this.buildingCache.size >= 512)
          this.buildingCache.delete(this.buildingCache.keys().next().value!);
        this.buildingCache.set(key, hit);
      }
      out.push(hit);
    }
    return out;
  }

  /** Purpose: heights at the given points, in order; null where the DEM has no data. */
  points(points: LonLat[]): Promise<Array<number | null>> {
    return Promise.all(points.map(([lon, lat]) => this.dem.elevation(lon, lat)));
  }

  /** Purpose: a height profile per line, sampled every `spacingM` metres and at every vertex. */
  async profiles(lines: LonLat[][], spacingM: number): Promise<ProfileSample[][]> {
    const positions = lines.map((l) => samplePositions(l, spacingM));
    const total = positions.reduce((s, p) => s + p.length, 0);
    if (total > MAX_SAMPLES) throw new RangeError(`${total} samples; at most ${MAX_SAMPLES} per request`);
    return Promise.all(
      positions.map(async (ps) => {
        const zs = await this.points(ps.map((p) => [p.lon, p.lat]));
        return ps.map((p, i) => ({ ...p, elevationM: zs[i] ?? null }));
      }),
    );
  }
}

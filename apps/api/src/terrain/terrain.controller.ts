import { BadRequestException, Body, Controller, HttpCode, HttpException, Post } from "@nestjs/common";
import { z } from "zod";
import { DemError } from "../gateway/copernicus-dem.client";
import { OverpassError } from "../gateway/overpass.client";
import { Requires } from "../iam/requires";
import { BUILDING_SOURCE, MAX_SAMPLES, TERRAIN_SOURCE, TerrainService, type LonLat } from "./terrain.service";

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-89.999).max(89.999)]);
const pointsBody = z.object({ points: z.array(lonLat).min(1).max(MAX_SAMPLES) });
const profileBody = z.object({
  lines: z.array(z.array(lonLat).min(1).max(5_000)).min(1).max(500),
  spacingM: z.number().min(5).max(1_000).default(50),
  buildings: z.boolean().default(false),
});

/**
 * Terrain heights from the Copernicus GLO-30 DEM (06-gis §4), shared by every tool that needs ground
 * levels: railway gradients, tunnel cover and bridge clearance, cable car clearance. Members only:
 * uncached cells cost requests to the DEM host.
 */
@Controller("api/terrain")
export class TerrainController {
  constructor(private readonly terrain: TerrainService) {}

  /**
   * Purpose: heights at points, without resampling.
   * Inputs: { points: [[lon, lat], ...] }. Output: { elevationsM: (number | null)[], source }.
   */
  @Post("points")
  @HttpCode(200)
  @Requires("instance.read")
  async points(@Body() body: unknown) {
    const { points } = parse(pointsBody, body);
    const elevationsM = await upstream(() => this.terrain.points(points as LonLat[]));
    return { elevationsM, source: TERRAIN_SOURCE };
  }

  /**
   * Purpose: height profiles of lines, sampled every `spacingM` metres (default 50) and at every vertex.
   * Inputs: { lines: [[[lon, lat], ...], ...], spacingM?, buildings? }.
   * Output: { spacingM, lines: [{ lengthM, samples: [{ distM, lon, lat, elevationM | null }],
   * buildings?: [{ fromM, toM, heightM, estimated, osmId }] }], source, buildingSource? }.
   * With `buildings`, each line also lists the OpenStreetMap buildings it passes over (cable car clearance).
   */
  @Post("profile")
  @HttpCode(200)
  @Requires("instance.read")
  async profile(@Body() body: unknown) {
    const { lines, spacingM, buildings } = parse(profileBody, body);
    const ls = lines as LonLat[][];
    const [profiles, crossings] = await upstream(() =>
      Promise.all([this.terrain.profiles(ls, spacingM), buildings ? this.terrain.buildings(ls) : null]),
    );
    return {
      spacingM,
      lines: profiles.map((samples, i) => ({
        lengthM: samples[samples.length - 1]?.distM ?? 0,
        samples,
        ...(crossings ? { buildings: crossings[i] } : {}),
      })),
      source: TERRAIN_SOURCE,
      ...(crossings ? { buildingSource: BUILDING_SOURCE } : {}),
    };
  }
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
  return r.data;
}

async function upstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RangeError) throw new BadRequestException(e.message);
    if (e instanceof DemError) throw new HttpException("Terrain heights are unavailable right now", e.status);
    if (e instanceof OverpassError)
      throw new HttpException("OpenStreetMap buildings are unavailable right now", e.status);
    throw e;
  }
}

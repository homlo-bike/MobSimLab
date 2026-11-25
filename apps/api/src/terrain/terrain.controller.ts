import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  Optional,
} from "@nestjs/common";
import { z } from "zod";
import type { MslRequest } from "../auth/session.service";
import { DemError } from "../gateway/copernicus-dem.client";
import { GEBCO_SOURCE, GebcoClient, GebcoError } from "../gateway/gebco.client";
import { OpenElevationError } from "../gateway/open-elevation.client";
import { OverpassError } from "../gateway/overpass.client";
import { ProjectGate } from "../geodata/project-gate";
import { factKey, ProjectDataCache } from "../projects/data-cache";
import { Requires } from "../iam/requires";
import { BUILDING_SOURCE, MAX_SAMPLES, TerrainService, type LonLat, mainSource } from "./terrain.service";

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-89.999).max(89.999)]);
const pointsBody = z.object({
  points: z.array(lonLat).min(1).max(MAX_SAMPLES),
  projectId: z.string().optional(),
});
/** Most points one depth request asks (the ferry route checks ask up to 400). */
export const MAX_DEPTH_POINTS = 1_000;
const depthsBody = z.object({
  points: z.array(lonLat).min(1).max(MAX_DEPTH_POINTS),
  projectId: z.string().optional(),
});
const profileBody = z.object({
  lines: z.array(z.array(lonLat).min(1).max(5_000)).min(1).max(500),
  spacingM: z.number().min(5).max(1_000).default(50),
  buildings: z.boolean().default(false),
  projectId: z.string().optional(),
});

/**
 * Terrain heights from the Copernicus GLO-30 DEM (06-gis §4), shared by every tool that needs ground
 * levels: railway gradients, tunnel cover and bridge clearance, cable car clearance. Members only:
 * uncached cells cost requests to the DEM host. With `projectId` (a project the caller can read), heights and
 * buildings come from the project's imports where they cover the points (ADR-0046). `source` is the least
 * accurate source used; `sources` lists every one.
 */
@Controller("api/terrain")
export class TerrainController {
  constructor(
    private readonly terrain: TerrainService,
    @Optional() private readonly gate?: ProjectGate,
    @Optional() private readonly gebco?: GebcoClient,
    @Optional() private readonly kept?: ProjectDataCache,
  ) {}

  /**
   * Purpose: water depths at points from the GEBCO grid, for the ferry route checks.
   * Inputs: { points: [[lon, lat], ...] }. Output: { depthsM: (number | null)[] (metres below sea level; land is
   * negative), source }; 503 when depths are turned off on this instance. With `projectId` (a project the caller
   * can read), depths the project already asked for come from the project and new ones are kept with it, so a
   * saved project file carries them and the checks work without the depth service.
   */
  @Post("depths")
  @HttpCode(200)
  @Requires("instance.read")
  async depths(@Body() body: unknown, @Req() req: MslRequest) {
    const { points, projectId } = parse(depthsBody, body);
    const project = this.kept ? await this.gate?.readable(req, projectId) : undefined;
    const keys = (points as LonLat[]).map(([lon, lat]) => factKey.depth(lon, lat));
    const have = project
      ? await this.kept!.getMany(project, "facts", [...new Set(keys)])
      : new Map<string, string>();
    const missing = (points as LonLat[]).filter((_, i) => !have.has(keys[i]!));
    if (missing.length) {
      if (!this.gebco) throw new HttpException("Water depths are turned off on this instance", 503);
      const gebco = this.gebco;
      const got = await upstream(() => gebco.depths(missing));
      const fresh = new Map<string, string>();
      missing.forEach(([lon, lat], i) => fresh.set(factKey.depth(lon, lat), JSON.stringify(got[i] ?? null)));
      if (project) await this.kept!.putMany(project, "facts", [...fresh]);
      for (const [k, v] of fresh) have.set(k, v);
    }
    const depthsM = keys.map((k) => JSON.parse(have.get(k) ?? "null") as number | null);
    return { depthsM, source: GEBCO_SOURCE };
  }

  /**
   * Purpose: heights at points, without resampling.
   * Inputs: { points: [[lon, lat], ...] }. Output: { elevationsM: (number | null)[], source }.
   */
  @Post("points")
  @HttpCode(200)
  @Requires("instance.read")
  async points(@Body() body: unknown, @Req() req: MslRequest) {
    const { points, projectId } = parse(pointsBody, body);
    const project = await this.gate?.readable(req, projectId);
    const h = await upstream(() => this.terrain.heights(points as LonLat[], project));
    return {
      elevationsM: h.values,
      source: mainSource(h.sources),
      sources: h.sources,
      ...(project ? { liveCount: h.live ?? 0 } : {}),
    };
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
  async profile(@Body() body: unknown, @Req() req: MslRequest) {
    const { lines, spacingM, buildings, projectId } = parse(profileBody, body);
    const project = await this.gate?.readable(req, projectId);
    const ls = lines as LonLat[][];
    const [{ profiles, sources }, crossings] = await upstream(() =>
      Promise.all([
        this.terrain.profilesWithSources(ls, spacingM, project),
        buildings ? this.terrain.buildings(ls, project) : null,
      ]),
    );
    return {
      spacingM,
      lines: profiles.map((samples, i) => ({
        lengthM: samples[samples.length - 1]?.distM ?? 0,
        samples,
        ...(crossings ? { buildings: crossings[i] } : {}),
      })),
      source: mainSource(sources),
      sources,
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
    if (e instanceof DemError || e instanceof OpenElevationError)
      throw new HttpException("Terrain heights are unavailable right now", e.status);
    if (e instanceof OverpassError)
      throw new HttpException("OpenStreetMap buildings are unavailable right now", e.status);
    if (e instanceof GebcoError) throw new HttpException("Water depths are unavailable right now", e.status);
    throw e;
  }
}

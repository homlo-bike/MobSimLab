import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { BenefitsService } from "../benefits/benefits.service";
import { OverpassError } from "../gateway/overpass.client";
import { WorldPopError } from "../gateway/worldpop.client";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { importRequest, layerDetails, PopulationLayersService, viewRequest } from "./layers.service";
import { type Bbox, PopulationService } from "./population.service";
import { uploadMeta } from "./uploads";

const uuid = z.uuid();
const bufferBody = z.strictObject({ bufferKm: z.number().min(0).max(50) });
const primaryBody = z.strictObject({ layerId: z.uuid().nullable() });
const patchBody = layerDetails.partial().refine((b) => Object.keys(b).length > 0, "nothing to change");
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const gridBody = z.strictObject({
  bbox: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-89.999).max(89.999),
    z.number().min(-180).max(180),
    z.number().min(-89.999).max(89.999),
  ]),
});
const catchmentsBody = z.strictObject({
  areas: z
    .array(z.object({ id: z.string().min(1).max(100), ring: z.array(lonLat).min(4).max(200) }))
    .min(1)
    .max(400),
});
/** The `info` query parameter of an upload: the layer's details and how to read the file (JSON). */
const uploadInfo = z.strictObject({ details: layerDetails, file: uploadMeta });

/** Purpose: parse input with a zod schema; 400 with the issue messages on failure. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * Population layers of a project (06-gis §3, FR-GIS-04): WorldPop and GHSL imports for the project area, the
 * planners' own files, the primary layer and the difference layer. Every member reads; Owners and Editors
 * change (checked in PopulationLayersService).
 */
@Controller("api/projects/:id/population")
export class PopulationLayersController {
  constructor(
    private readonly layers: PopulationLayersService,
    private readonly population: PopulationService,
    private readonly benefits: BenefitsService,
    private readonly sessions: SessionService,
  ) {}

  private actor(req: MslRequest): ProjectActor {
    const s = req.session;
    if (!s) throw new ForbiddenException();
    return {
      userId: s.actor.userId,
      role: s.actor.role,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: the project area, the layers and the choices an import offers. */
  @Get()
  @Requires("projects.read")
  async overview(@Param("id") id: string, @Req() req: MslRequest) {
    return this.layers.overview(this.actor(req), parse(uuid, id));
  }

  /** Purpose: change the buffer round everything drawn. Body: `{ bufferKm }` (0 to 50). */
  @Put("area")
  @Requires("projects.read")
  async setBuffer(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return this.layers.setBuffer(this.actor(req), parse(uuid, id), parse(bufferBody, body).bufferKm);
  }

  /**
   * Purpose: import WorldPop or GHSL for the project area. Body: `{ source: "worldpop", year? }` or
   * `{ source: "ghsl", epoch?, resolution? }`, with optional `name` and `confidence`.
   * Output: `{ layer }`, importing; poll `GET layers/:layerId` until it is ready or failed.
   */
  @Post("imports")
  @Requires("projects.read")
  async startImport(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return {
      layer: await this.layers.startImport(this.actor(req), parse(uuid, id), parse(importRequest, body)),
    };
  }

  /**
   * Purpose: upload the planner's own population file as a new layer. Body: the raw file
   * (`application/octet-stream`). Query: `info`, JSON `{ details: { name, licence, sourceUrl, citation,
   * confidence, referenceYear }, file: { format: "geotiff" | "geojson" | "csv", … } }`.
   */
  @Post("uploads")
  @Requires("projects.read")
  async upload(
    @Param("id") id: string,
    @Query("info") info: unknown,
    @Body() body: unknown,
    @Req() req: MslRequest,
  ) {
    if (typeof info !== "string" || info.length > 32_768) throw new BadRequestException("info is missing");
    let json: unknown;
    try {
      json = JSON.parse(info);
    } catch {
      throw new BadRequestException("info is not JSON");
    }
    const { details, file } = parse(uploadInfo, json);
    if (!Buffer.isBuffer(body)) throw new BadRequestException("send the file as application/octet-stream");
    return { layer: await this.layers.upload(this.actor(req), parse(uuid, id), details, file, body) };
  }

  /** Purpose: one layer (to follow an import). */
  @Get("layers/:layerId")
  @Requires("projects.read")
  async layer(@Param("id") id: string, @Param("layerId") layerId: string, @Req() req: MslRequest) {
    return { layer: await this.layers.get(this.actor(req), parse(uuid, id), parse(uuid, layerId)) };
  }

  /** Purpose: change a layer's details. Body: any of `{ name, licence, sourceUrl, citation, confidence, referenceYear }`. */
  @Patch("layers/:layerId")
  @Requires("projects.read")
  async update(
    @Param("id") id: string,
    @Param("layerId") layerId: string,
    @Body() body: unknown,
    @Req() req: MslRequest,
  ) {
    return {
      layer: await this.layers.update(
        this.actor(req),
        parse(uuid, id),
        parse(uuid, layerId),
        parse(patchBody, body),
      ),
    };
  }

  /** Purpose: delete a layer. */
  @Delete("layers/:layerId")
  @Requires("projects.read")
  async remove(@Param("id") id: string, @Param("layerId") layerId: string, @Req() req: MslRequest) {
    await this.layers.remove(this.actor(req), parse(uuid, id), parse(uuid, layerId));
    return { ok: true };
  }

  /** Purpose: choose the primary layer, or none (WorldPop's live grid). Body: `{ layerId }`. */
  @Put("primary")
  @Requires("projects.read")
  async setPrimary(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return {
      layers: await this.layers.setPrimary(
        this.actor(req),
        parse(uuid, id),
        parse(primaryBody, body).layerId,
      ),
    };
  }

  /**
   * Purpose: a layer, or a layer minus another (the difference layer), on a lattice over the project area.
   * Body: `{ layerId, minusId?, cellM? }`.
   */
  @Post("lattice")
  @HttpCode(200)
  @Requires("projects.read")
  async lattice(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return this.layers.lattice(this.actor(req), parse(uuid, id), parse(viewRequest, body));
  }

  /**
   * Purpose: people per 100 m cell over a box for the project's readers (noise map, walk analysis): its primary
   * layer, or WorldPop's live grid when it has none. Body: `{ bbox }`, at most 0.3° on a side.
   * Output: as `POST /api/population/grid`.
   */
  @Post("grid")
  @HttpCode(200)
  @Requires("projects.read")
  async grid(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const projectId = parse(uuid, id);
    const { bbox } = parse(gridBody, body);
    await this.layers.checkRead(this.actor(req), projectId);
    try {
      return await this.population.gridFor(bbox as Bbox, projectId);
    } catch (e) {
      if (e instanceof RangeError) throw new BadRequestException(e.message);
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap cannot place the area right now", e.status);
      if (e instanceof WorldPopError) throw new HttpException("WorldPop is unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: people inside each area (station catchments) for the benefit tables, from the project's primary
   * layer or WorldPop. Body: `{ areas: [{ id, ring }] }`. Output: as `POST /api/benefits/population`.
   */
  @Post("catchments")
  @HttpCode(200)
  @Requires("projects.read")
  async catchments(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const projectId = parse(uuid, id);
    const { areas } = parse(catchmentsBody, body);
    await this.layers.checkRead(this.actor(req), projectId);
    return this.benefits.population(areas as { id: string; ring: [number, number][] }[], projectId);
  }
}

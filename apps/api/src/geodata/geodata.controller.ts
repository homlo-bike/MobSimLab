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
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { GeofabrikError } from "../gateway/geofabrik.client";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { GeodataService } from "./geodata.service";

const uuid = z.uuid();
const osmBody = z.strictObject({
  method: z.enum(["overpass", "geofabrik"]),
  region: z.string().trim().min(1).max(200).optional(),
  planned: z.boolean().default(false),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * OpenStreetMap and elevation imported per project area (06-gis §2 and §4, ADR-0045). Every member reads the
 * import state; Owners and Editors start, cancel and remove imports (checked in GeodataService).
 */
@Controller("api/projects/:id/geodata")
export class GeodataController {
  constructor(
    private readonly geodata: GeodataService,
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

  /** Purpose: the project area, the current and latest import of each kind, and the limits. */
  @Get()
  @Requires("projects.read")
  async status(@Param("id") id: string, @Req() req: MslRequest) {
    return this.geodata.status(this.actor(req), parse(uuid, id));
  }

  /** Purpose: the Geofabrik regions holding the project area, smallest first. */
  @Get("geofabrik-regions")
  @Requires("projects.read")
  async regions(@Param("id") id: string, @Req() req: MslRequest) {
    try {
      return { regions: await this.geodata.regions(this.actor(req), parse(uuid, id)) };
    } catch (e) {
      if (e instanceof GeofabrikError) throw new HttpException(e.message, e.status);
      throw e;
    }
  }

  /** Purpose: start an OpenStreetMap import. Body: `{ method: "overpass" | "geofabrik", region?, planned? }`. */
  @Post("osm")
  @Requires("projects.read")
  async osm(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return { import: await this.geodata.startOsm(this.actor(req), parse(uuid, id), parse(osmBody, body)) };
  }

  /**
   * Purpose: import an uploaded `.osm.pbf` file, sent as `application/octet-stream`.
   * Query: `name` (the file name, for the record) and `planned=true` to keep planned roads.
   */
  @Post("osm/upload")
  @Requires("projects.read")
  async osmUpload(
    @Param("id") id: string,
    @Query("name") name: string | undefined,
    @Query("planned") planned: string | undefined,
    @Req() req: MslRequest,
  ) {
    if (!/^application\/octet-stream\b/.test(req.headers["content-type"] ?? ""))
      throw new BadRequestException("Send the .osm.pbf file as application/octet-stream");
    const run = await this.geodata.uploadPbf(this.actor(req), parse(uuid, id), req, {
      fileName: (name ?? "upload.osm.pbf").trim() || "upload.osm.pbf",
      planned: planned === "true",
    });
    return { import: run };
  }

  /** Purpose: start a Copernicus GLO-30 elevation import. */
  @Post("dem")
  @Requires("projects.read")
  async dem(@Param("id") id: string, @Req() req: MslRequest) {
    return { import: await this.geodata.startDem(this.actor(req), parse(uuid, id)) };
  }

  /** Purpose: cancel a queued or running import. */
  @Post("imports/:importId/cancel")
  @HttpCode(200)
  @Requires("projects.read")
  async cancel(@Param("id") id: string, @Param("importId") importId: string, @Req() req: MslRequest) {
    return { import: await this.geodata.cancel(this.actor(req), parse(uuid, id), parse(uuid, importId)) };
  }

  /** Purpose: remove an import and its data (such as the planner's own elevation grid). */
  @Delete("imports/:importId")
  @HttpCode(204)
  @Requires("projects.read")
  async remove(@Param("id") id: string, @Param("importId") importId: string, @Req() req: MslRequest) {
    await this.geodata.remove(this.actor(req), parse(uuid, id), parse(uuid, importId));
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import { areaBody, estimateBody, ProjectAreaService } from "./area.service";
import type { ProjectActor } from "./projects.service";

const uuid = z.uuid();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
  return r.data;
}

/**
 * The project area from OpenStreetMap regions (#140). Every member reads it; Owners and Editors set it, which
 * queues the area's imports (checked in ProjectAreaService).
 */
@Controller("api/projects/:id/area")
export class ProjectAreaController {
  constructor(
    private readonly area: ProjectAreaService,
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

  /** Purpose: the project's regions, the box imports cover and its size. */
  @Get()
  @Requires("projects.read")
  async get(@Param("id") id: string, @Req() req: MslRequest) {
    return this.area.get(this.actor(req), parse(uuid, id));
  }

  /**
   * Purpose: set the area (`{polygons, import}` from the area window, or `{regions, import}`) and queue the
   * imports. Answers the area and the imports; 400 when the polygons hold more map data than the limit.
   */
  @Put()
  @Requires("projects.read")
  async set(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    return this.area.set(this.actor(req), parse(uuid, id), parse(areaBody, body));
  }

  /** Purpose: download the area's map data again (Refresh map data). Answers what happened to each import. */
  @Post("refresh")
  @HttpCode(200)
  @Requires("projects.read")
  async refresh(@Param("id") id: string, @Req() req: MslRequest) {
    return { imports: await this.area.refresh(this.actor(req), parse(uuid, id)) };
  }
}

/**
 * What a drawn area would hold (`POST /api/area/estimate` with `{polygons}`), for the area window while the
 * planner draws, also before the project exists (New project). Pure geometry: nothing is fetched.
 */
@Controller("api/area")
export class AreaEstimateController {
  constructor(private readonly area: ProjectAreaService) {}

  @Post("estimate")
  @HttpCode(200)
  @Requires("instance.read")
  estimate(@Body() body: unknown) {
    const b = parse(estimateBody, body);
    return this.area.estimate(b.polygons, b.previous);
  }
}

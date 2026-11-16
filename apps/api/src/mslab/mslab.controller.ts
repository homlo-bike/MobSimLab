import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { MSLAB_MEDIA_TYPE } from "./format.mts";
import { MslabService } from "./mslab.service";

const uuid = z.uuid();
const exportQuery = z.strictObject({
  runs: z.enum(["true", "false"]).optional(),
  map: z.enum(["true", "false"]).optional(),
});

/**
 * `.mslab` project files (ADR-0021): save a project as a file, and open a file as a new project.
 */
@Controller("api/projects")
export class MslabController {
  constructor(
    private readonly mslab: MslabService,
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

  /**
   * Purpose: download the project as a `.mslab` file. Query: `runs=true` adds the finished simulation runs;
   * `map=true` adds the map data of the project area for the static viewer (format 1.1; may take minutes when the
   * OpenStreetMap tiles are not cached).
   */
  @Get(":id/mslab")
  @Requires("projects.read")
  async export(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() req: MslRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const q = exportQuery.safeParse(query ?? {});
    const pid = uuid.safeParse(id);
    if (!q.success || !pid.success) throw new BadRequestException("not a valid request");
    const { fileName, bytes } = await this.mslab.export(
      this.actor(req),
      pid.data,
      q.data.runs === "true",
      q.data.map === "true",
    );
    res.setHeader("Content-Type", MSLAB_MEDIA_TYPE);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    return new StreamableFile(bytes);
  }

  /**
   * Purpose: open a `.mslab` file as a new project owned by the caller. Body: the file (raw bytes, at most
   * 200 MB). Output: `{ project, skipped, migratedFrom }`. 400 with a plain message when the file cannot be opened.
   */
  @Post("import")
  @Requires("projects.create")
  async import(@Body() body: unknown, @Req() req: MslRequest) {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestException("send the .mslab file as the request body (application/octet-stream)");
    return this.mslab.import(this.actor(req), body);
  }
}

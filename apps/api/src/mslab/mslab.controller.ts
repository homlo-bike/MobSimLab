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
import { MslabContentsService } from "./contents";
import { MslabService } from "./mslab.service";

const uuid = z.uuid();
const exportQuery = z.strictObject({
  runs: z.enum(["true", "false"]).optional(),
  map: z.enum(["true", "false"]).optional(),
  results: z.enum(["true", "false"]).optional(),
  vehicles: z.enum(["true", "false"]).optional(),
  comments: z.enum(["true", "false"]).optional(),
  history: z.enum(["true", "false"]).optional(),
  facts: z.enum(["true", "false"]).optional(),
  economy: z.enum(["true", "false"]).optional(),
  otherFetched: z.enum(["true", "false"]).optional(),
  liveTiles: z.enum(["true", "false"]).optional(),
  elevation: z.enum(["true", "false"]).optional(),
  population: z.enum(["true", "false"]).optional(),
  uploads: z.enum(["true", "false"]).optional(),
});

/**
 * `.mslab` project files (ADR-0021): save a project as a file, and open a file as a new project.
 */
@Controller("api/projects")
export class MslabController {
  constructor(
    private readonly mslab: MslabService,
    private readonly contents: MslabContentsService,
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
   * OpenStreetMap tiles are not cached); `results=false` leaves out the results the tools worked out
   * and `vehicles=false` the project's own vehicles and fleet; `comments=false` and `history=false` leave out the
   * comments and the history of changed values (format 1.5); `facts`, `economy`, `otherFetched`, `liveTiles`,
   * `elevation`, `population` and `uploads` `=false` leave out that kind of fetched or imported data (format 1.6).
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
      q.data.results !== "false",
      q.data.vehicles !== "false",
      q.data.comments !== "false",
      q.data.history !== "false",
      {
        facts: q.data.facts !== "false",
        economy: q.data.economy !== "false",
        otherFetched: q.data.otherFetched !== "false",
        liveTiles: q.data.liveTiles !== "false",
        elevation: q.data.elevation !== "false",
        population: q.data.population !== "false",
        uploads: q.data.uploads !== "false",
      },
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
   * Purpose: what the project holds of each kind of data a `.mslab` file can carry (Project preferences → Saved
   * project files). Output: `{ rows: SavedDataRow[] }` with size, count, date and source.
   */
  @Get(":id/mslab/contents")
  @Requires("projects.read")
  async savedContents(@Param("id") id: string, @Req() req: MslRequest) {
    const pid = uuid.safeParse(id);
    if (!pid.success) throw new BadRequestException("not a valid request");
    return { rows: await this.contents.contents(this.actor(req), pid.data) };
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

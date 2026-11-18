import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { DATABASE, type Database } from "../db/database";
import { Requires } from "../iam/requires";
import { type ProjectActor, ProjectsService } from "./projects.service";

/** Largest saved noise map accepted, compressed. Matches the body limit of the route (app.setup.ts). */
export const MAX_NOISE_RESULT_BYTES = 64 * 1024 * 1024;

/** The two bytes every gzip stream starts with. */
const GZIP = [0x1f, 0x8b];

/**
 * The project's noise map (GIS tab, Map data), saved with the project: one result per project, replaced by the
 * next. The web app writes it as gzip-compressed JSON (features/noise/saved.ts); the API keeps it as it is.
 */
@Injectable()
export class NoiseResultService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  /** Purpose: the saved noise map and when it was worked out, or null. Every member. */
  async get(actor: ProjectActor, projectId: string): Promise<{ body: Buffer; computedAt: Date } | null> {
    await this.projects.access(actor, projectId, "read");
    const row = await this.db
      .selectFrom("project.noise_result")
      .select(["body", "computed_at"])
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    return row ? { body: row.body, computedAt: row.computed_at } : null;
  }

  /**
   * Purpose: keep a newly worked out noise map, replacing the one before. Owners and Editors.
   * Side effects: audit `project.noise_saved` with the size.
   */
  async set(actor: ProjectActor, projectId: string, body: Buffer): Promise<{ computedAt: Date }> {
    if (body.length < GZIP.length || body[0] !== GZIP[0] || body[1] !== GZIP[1])
      throw new BadRequestException("The noise map must be gzip-compressed JSON");
    if (body.length > MAX_NOISE_RESULT_BYTES) throw new BadRequestException("The noise map is too large");
    return this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const row = await tx
        .insertInto("project.noise_result")
        .values({ project_id: projectId, body, computed_by: actor.userId })
        .onConflict((oc) =>
          oc.column("project_id").doUpdateSet({ body, computed_by: actor.userId, computed_at: new Date() }),
        )
        .returning("computed_at")
        .executeTakeFirstOrThrow();
      await this.projects.logProject(
        actor,
        projectId,
        "project.noise_saved",
        null,
        { bytes: body.length },
        tx,
      );
      return { computedAt: row.computed_at };
    });
  }
}

const uuid = z.uuid();

/** The saved noise map of a project: every member reads it, Owners and Editors replace it. */
@Controller("api/projects/:id/noise-result")
export class NoiseResultController {
  constructor(
    private readonly results: NoiseResultService,
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

  private id(raw: string): string {
    const r = uuid.safeParse(raw);
    if (!r.success) throw new BadRequestException("Bad project id");
    return r.data;
  }

  /** Purpose: the saved noise map as it was sent (gzip), with `X-Computed-At`; 404 when there is none. */
  @Get()
  @Requires("projects.read")
  async get(@Param("id") id: string, @Req() req: MslRequest, @Res() res: Response): Promise<void> {
    const r = await this.results.get(this.actor(req), this.id(id));
    if (!r) throw new NotFoundException("No noise map saved");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Computed-At", r.computedAt.toISOString());
    res.setHeader("Cache-Control", "no-store");
    res.send(r.body);
  }

  /** Purpose: save a newly worked out noise map (raw gzip body). Answers when it was saved. */
  @Put()
  @HttpCode(200)
  @Requires("projects.read")
  async set(@Param("id") id: string, @Req() req: MslRequest) {
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body) throw new BadRequestException("Send the noise map as application/octet-stream");
    const r = await this.results.set(this.actor(req), this.id(id), body);
    return { computedAt: r.computedAt.toISOString() };
  }
}

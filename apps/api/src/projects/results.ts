import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { DATABASE, type Database } from "../db/database";
import { Requires } from "../iam/requires";
import { type ProjectActor, ProjectsService } from "./projects.service";

/** Largest saved result accepted, compressed. Matches the body limit of the route (app.setup.ts). */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;

/**
 * Kinds of result a project keeps, one of each (apps/web/src/projects/results.ts writes them):
 * - noise: the noise map of GIS, Map data, for the whole project
 * - walk-coverage, stop-spacing: the walk analysis of GIS, Zones
 * - benefit-access: what each station's zone reaches in every scenario (benefit tables, journey planner step)
 * - cost-quantities: the railway quantities the cost tables price (railway build step)
 * - scenario-measures: the quantities of every scenario of the Tables tab
 * - capacity-test: the last capacity test run in the browser (Simulator tab)
 */
export const RESULT_KINDS = [
  "noise",
  "walk-coverage",
  "stop-spacing",
  "benefit-access",
  "cost-quantities",
  "scenario-measures",
  "capacity-test",
] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

/** Purpose: whether a string names a kind of saved result. */
export function isResultKind(kind: string): kind is ResultKind {
  return (RESULT_KINDS as readonly string[]).includes(kind);
}

/** Shape of a result's input fingerprint (apps/web/src/projects/inputKey.ts). */
export const INPUTS_PATTERN = /^[A-Za-z0-9._:-]{0,200}$/;

/** The two bytes every gzip stream starts with. */
const GZIP = [0x1f, 0x8b];

/** What the project keeps of one result, without its body. */
export interface ResultSummary {
  kind: string;
  inputs: string;
  computedAt: string;
  bytes: number;
}

/**
 * Results the project's tools worked out, saved with the project (`project.result`): one per kind, replaced by
 * the next, with the fingerprint of what it was worked out from. The web app writes each as gzip-compressed
 * JSON; the API keeps it as it is.
 */
@Injectable()
export class ProjectResultsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  /** Purpose: the project's saved results without their bodies. Every member. */
  async list(actor: ProjectActor, projectId: string): Promise<ResultSummary[]> {
    await this.projects.access(actor, projectId, "read");
    const rows = await this.db
      .selectFrom("project.result")
      .select(["kind", "inputs", "computed_at"])
      .select((eb) => eb.fn<number>("octet_length", ["body"]).as("bytes"))
      .where("project_id", "=", projectId)
      .orderBy("kind")
      .execute();
    return rows.map((r) => ({
      kind: r.kind,
      inputs: r.inputs,
      computedAt: r.computed_at.toISOString(),
      bytes: Number(r.bytes),
    }));
  }

  /** Purpose: one saved result with its fingerprint and when it was worked out, or null. Every member. */
  async get(
    actor: ProjectActor,
    projectId: string,
    kind: ResultKind,
  ): Promise<{ body: Buffer; inputs: string; computedAt: Date } | null> {
    await this.projects.access(actor, projectId, "read");
    const row = await this.db
      .selectFrom("project.result")
      .select(["body", "inputs", "computed_at"])
      .where("project_id", "=", projectId)
      .where("kind", "=", kind)
      .executeTakeFirst();
    return row ? { body: row.body, inputs: row.inputs, computedAt: row.computed_at } : null;
  }

  /**
   * Purpose: keep a newly worked out result, replacing the one before. Owners and Editors.
   * Side effects: audit `project.result_saved` with the kind and size.
   */
  async set(
    actor: ProjectActor,
    projectId: string,
    kind: ResultKind,
    inputs: string,
    body: Buffer,
  ): Promise<{ computedAt: Date }> {
    if (body.length < GZIP.length || body[0] !== GZIP[0] || body[1] !== GZIP[1])
      throw new BadRequestException("The result must be gzip-compressed JSON");
    if (body.length > MAX_RESULT_BYTES) throw new BadRequestException("The result is too large");
    if (!INPUTS_PATTERN.test(inputs)) throw new BadRequestException("Bad input fingerprint");
    return this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const row = await tx
        .insertInto("project.result")
        .values({ project_id: projectId, kind, inputs, body, computed_by: actor.userId })
        .onConflict((oc) =>
          oc
            .columns(["project_id", "kind"])
            .doUpdateSet({ inputs, body, computed_by: actor.userId, computed_at: new Date() }),
        )
        .returning("computed_at")
        .executeTakeFirstOrThrow();
      await this.projects.logProject(
        actor,
        projectId,
        "project.result_saved",
        null,
        { kind, bytes: body.length },
        tx,
      );
      return { computedAt: row.computed_at };
    });
  }

  /** Purpose: forget a saved result. Owners and Editors. Output: whether there was one. */
  async remove(actor: ProjectActor, projectId: string, kind: ResultKind): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const r = await tx
        .deleteFrom("project.result")
        .where("project_id", "=", projectId)
        .where("kind", "=", kind)
        .executeTakeFirst();
      return Number(r.numDeletedRows) > 0;
    });
  }
}

const uuid = z.uuid();

/** The saved results of a project: every member reads them, Owners and Editors replace them. */
@Controller("api/projects/:id/results")
export class ProjectResultsController {
  constructor(
    private readonly results: ProjectResultsService,
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

  private kind(raw: string): ResultKind {
    if (!isResultKind(raw)) throw new NotFoundException("No such kind of result");
    return raw;
  }

  /** Purpose: the project's saved results: kind, input fingerprint, when worked out and size. */
  @Get()
  @Requires("projects.read")
  async list(@Param("id") id: string, @Req() req: MslRequest) {
    return { results: await this.results.list(this.actor(req), this.id(id)) };
  }

  /**
   * Purpose: one saved result as it was sent (gzip), with `X-Inputs` (its input fingerprint) and
   * `X-Computed-At`; 404 when there is none.
   */
  @Get(":kind")
  @Requires("projects.read")
  async get(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Req() req: MslRequest,
    @Res() res: Response,
  ): Promise<void> {
    const r = await this.results.get(this.actor(req), this.id(id), this.kind(kind));
    if (!r) throw new NotFoundException("Nothing saved");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Inputs", r.inputs);
    res.setHeader("X-Computed-At", r.computedAt.toISOString());
    res.setHeader("Cache-Control", "no-store");
    res.send(r.body);
  }

  /** Purpose: save a newly worked out result (raw gzip body, `?inputs=` its fingerprint). Answers when. */
  @Put(":kind")
  @HttpCode(200)
  @Requires("projects.read")
  async set(
    @Param("id") id: string,
    @Param("kind") kind: string,
    @Query("inputs") inputs: unknown,
    @Req() req: MslRequest,
  ) {
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body) throw new BadRequestException("Send the result as application/octet-stream");
    const r = await this.results.set(
      this.actor(req),
      this.id(id),
      this.kind(kind),
      typeof inputs === "string" ? inputs : "",
      body,
    );
    return { computedAt: r.computedAt.toISOString() };
  }

  /** Purpose: forget a saved result. */
  @Delete(":kind")
  @HttpCode(204)
  @Requires("projects.read")
  async remove(@Param("id") id: string, @Param("kind") kind: string, @Req() req: MslRequest): Promise<void> {
    await this.results.remove(this.actor(req), this.id(id), this.kind(kind));
  }
}

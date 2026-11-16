import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { capacityParams } from "./params";
import { RunsService } from "./runs.service";

const uuid = z.uuid();
const fileName = z.string().trim().min(1).max(200);
/** The network texts are checked by the kernel when the worker compiles them; here only their size. */
const text = z
  .string()
  .min(2)
  .max(8 * 1024 * 1024);

const startBody = z.strictObject({
  kind: z.literal("capacity"),
  network: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("example") }),
    z.strictObject({
      kind: z.literal("files"),
      topology: text,
      topologyName: fileName,
      lines: text,
      linesName: fileName,
    }),
  ]),
  params: capacityParams,
  sweep: z.boolean(),
});

/** Purpose: parse input with a zod schema; 400 with the issue messages on failure. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * Simulation runs of a project, run by the background worker and saved with the project. Project roles are
 * checked in RunsService (Owners and Editors start and stop runs, every member reads them).
 */
@Controller("api/projects/:id/simulation-runs")
export class RunsController {
  constructor(
    private readonly runs: RunsService,
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

  /** Purpose: the project's saved runs, newest first. */
  @Get()
  @Requires("projects.read")
  async list(@Param("id") id: string, @Req() req: MslRequest) {
    return { runs: await this.runs.list(this.actor(req), parse(uuid, id)) };
  }

  /**
   * Purpose: start a run on the background worker. Body: `{ kind: "capacity", network, params, sweep }`, where
   * `network` is `{ kind: "example" }` or `{ kind: "files", topology, topologyName, lines, linesName }`.
   */
  @Post()
  @Requires("projects.read")
  async start(@Param("id") id: string, @Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(startBody, body);
    return { run: await this.runs.start(this.actor(req), parse(uuid, id), b) };
  }

  /** Purpose: one run with its progress and result. */
  @Get(":runId")
  @Requires("projects.read")
  async get(@Param("id") id: string, @Param("runId") runId: string, @Req() req: MslRequest) {
    return { run: await this.runs.get(this.actor(req), parse(uuid, id), parse(uuid, runId)) };
  }

  /** Purpose: run a saved run again with the same network and settings, replacing its result. */
  @Post(":runId/rerun")
  @HttpCode(200)
  @Requires("projects.read")
  async rerun(@Param("id") id: string, @Param("runId") runId: string, @Req() req: MslRequest) {
    return { run: await this.runs.rerun(this.actor(req), parse(uuid, id), parse(uuid, runId)) };
  }

  /** Purpose: delete a saved run for everyone (a run that is still going is stopped). */
  @Delete(":runId")
  @Requires("projects.read")
  async remove(@Param("id") id: string, @Param("runId") runId: string, @Req() req: MslRequest) {
    await this.runs.remove(this.actor(req), parse(uuid, id), parse(uuid, runId));
    return { ok: true };
  }

  /** Purpose: stop a queued or running run. */
  @Post(":runId/cancel")
  @HttpCode(200)
  @Requires("projects.read")
  async cancel(@Param("id") id: string, @Param("runId") runId: string, @Req() req: MslRequest) {
    return { run: await this.runs.cancel(this.actor(req), parse(uuid, id), parse(uuid, runId)) };
  }
}

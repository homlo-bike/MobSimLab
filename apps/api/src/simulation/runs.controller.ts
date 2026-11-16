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
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { capacityParams } from "./params";
import { roadParams, roadScenario } from "./road";
import { RunsService } from "./runs.service";

const uuid = z.uuid();
const inputName = z.string().trim().min(1).max(200);
/** The network texts are checked by the kernel when the worker compiles them; here only their size. */
const text = z
  .string()
  .min(2)
  .max(8 * 1024 * 1024);

const capacityBody = z.strictObject({
  kind: z.literal("capacity"),
  network: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("example") }),
    z.strictObject({
      kind: z.literal("files"),
      topology: text,
      topologyName: inputName,
      lines: text,
      linesName: inputName,
    }),
  ]),
  params: capacityParams,
  sweep: z.boolean(),
});

/** A road run: the period and the scenario the simulator panel built from the project (./road.ts). */
const roadBody = z.strictObject({
  kind: z.literal("road"),
  params: roadParams,
  scenario: roadScenario,
});

const count = z.number().int().min(0).max(10_000_000);
/** An observed mode share, as a fraction or a percentage (the worker scales the four to add up to 1). */
const share = z.number().finite().min(0).max(100);

/**
 * A demand model run (ADR-0019): the Demand section's bundle as JSON text (contracts/demand-input.schema.json,
 * without streets: the API adds the street tiles of the zones; the worker checks the rest when it reads it),
 * the project's demand values, and the bundle's size for the list.
 */
const demandBody = z.strictObject({
  kind: z.literal("demand"),
  bundle: z
    .string()
    .min(2)
    .max(8 * 1024 * 1024),
  values: z
    .record(z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/), z.number().finite())
    .refine((v) => Object.keys(v).length <= 1000, "too many demand values"),
  summary: z.strictObject({ zones: count, stops: count, lines: count }),
  gbfsUrl: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional(),
  /** What the planner observed, to calibrate to (09 §2.3); the worker checks the details. */
  observed: z
    .strictObject({
      mode_shares: z
        .strictObject({
          car: share,
          transit: share,
          walk: share,
          cycle: share,
        })
        .optional(),
      mean_car_km: z.number().finite().gt(0).lt(1000).optional(),
      counts: z
        .array(
          z.strictObject({
            kind: z.enum(["line", "stop"]),
            id: z.string().min(1).max(300),
            value: z.number().finite().min(0).max(100_000_000),
          }),
        )
        .max(5000)
        .optional(),
    })
    .optional(),
});

const startBody = z.discriminatedUnion("kind", [capacityBody, roadBody, demandBody]);
const fileName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

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
   * `network` is `{ kind: "example" }` or `{ kind: "files", topology, topologyName, lines, linesName }`; or
   * `{ kind: "road", params, scenario }` for the road simulation (./road.ts); or
   * `{ kind: "demand", bundle, values, summary }` for the demand model.
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

  /** Purpose: download a file a run saved next to its result (a demand run's `od.omx`). */
  @Get(":runId/files/:name")
  @Requires("projects.read")
  async file(
    @Param("id") id: string,
    @Param("runId") runId: string,
    @Param("name") name: string,
    @Req() req: MslRequest,
    @Res() res: Response,
  ) {
    const f = await this.runs.file(
      this.actor(req),
      parse(uuid, id),
      parse(uuid, runId),
      parse(fileName, name),
    );
    res.setHeader("Content-Type", f.mediaType);
    res.setHeader("Content-Disposition", `attachment; filename="${f.name}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(f.content);
  }

  /**
   * Purpose: the replay of a road run: gzipped JSON with the street line vehicles' positions (worker
   * `pack_replay`). Sent as stored with `Content-Encoding: gzip`, so the browser unpacks it.
   */
  @Get(":runId/replay")
  @Requires("projects.read")
  async replay(
    @Param("id") id: string,
    @Param("runId") runId: string,
    @Req() req: MslRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.runs.replay(this.actor(req), parse(uuid, id), parse(uuid, runId));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Cache-Control", "private, no-cache");
    return new StreamableFile(data);
  }

  /** Purpose: the scenario a road run ran, as JSON (`RoadScenario`, ./road.ts). */
  @Get(":runId/scenario")
  @Requires("projects.read")
  async scenario(
    @Param("id") id: string,
    @Param("runId") runId: string,
    @Req() req: MslRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const text = await this.runs.roadScenario(this.actor(req), parse(uuid, id), parse(uuid, runId));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-cache");
    return text;
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

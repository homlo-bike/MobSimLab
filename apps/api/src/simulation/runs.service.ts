import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { type Kysely, sql } from "kysely";
import { AuditService, projectChain } from "../audit/audit.service";
import { type DB, DATABASE, type Database, type RunKind, type RunStatus } from "../db/database";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";
import type { CapacitySettings, SweepDesign, SweepMetric } from "./params";
import { type JobState, RunQueue } from "./queue";

/** The network of a capacity run: the example metro, or the railway editor's topology with a lines file. */
export type RunNetwork =
  | { kind: "example" }
  | { kind: "files"; topology: string; topologyName: string; lines: string; linesName: string }
  /** The network and lines of a saved run of the same project (agents use this to avoid resending files). */
  | { kind: "run"; runId: string };

/** What a planner asks for: a capacity run of one period, with or without the frequency sweep. */
export interface NewCapacityRun {
  kind: "capacity";
  network: RunNetwork;
  /** `CapacityParams` of crates/rail-sim/src/capacity.rs; missing fields take the kernel's defaults. */
  params: CapacitySettings;
  sweep: boolean;
}

/**
 * A sweep of the capacity run's settings (ADR-0035 §7): one capacity run per variant of the design, in one
 * job, with the Pareto front over the objectives (worker/src/mobsim_worker/jobs/sweep.py).
 */
export interface NewSweepRun {
  kind: "sweep";
  network: RunNetwork;
  /** Settings every variant shares; the design overrides the ones it varies. */
  params: CapacitySettings;
  design: SweepDesign;
  objectives: { metric: SweepMetric; better: "lower" | "higher" }[];
}

/**
 * A demand model run (ADR-0019): the Demand section's bundle (contracts/demand-input.schema.json, JSON text) and
 * the project's demand values (Project preferences). The worker checks the bundle when it reads it.
 */
export interface NewDemandRun {
  kind: "demand";
  bundle: string;
  values: Record<string, number>;
  /** What the list shows about the bundle. */
  summary: DemandSummary;
}

/** Size of a demand run's bundle, for the list of runs. */
export interface DemandSummary {
  zones: number;
  links: number;
  stops: number;
  lines: number;
}

export type NewRun = NewCapacityRun | NewSweepRun | NewDemandRun;

/** The agent connection a run is started through, for the run limit and the audit trail (ADR-0035 §7). */
export interface AgentVia {
  connectionId: string;
  clientName: string;
  tool: string;
  /** Most runs this connection may have queued or running at once. */
  maxOpen: number;
}

/** One run in the project's list of saved runs. */
export interface RunSummary {
  id: string;
  kind: RunKind;
  status: RunStatus;
  network:
    | { kind: "example" }
    | { kind: "files"; topologyName: string; linesName: string }
    | ({ kind: "demand" } & DemandSummary);
  /** Capacity runs and sweeps: their settings; null for demand runs. */
  params: CapacitySettings | null;
  sweep: boolean;
  /** Sweeps only: the design and the objectives of the Pareto front. */
  design?: SweepDesign;
  objectives?: NewSweepRun["objectives"];
  /** Name of the agent connection that started the run, or null when a person did. */
  agent: string | null;
  /** The overall verdict once the period has been planned and run. */
  verdict: string | null;
  error: string | null;
  cancelRequested: boolean;
  createdBy: { id: string; displayName: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One run with what the worker found: `progress` while it runs, `result` (partial while running). */
export interface RunDetail extends RunSummary {
  progress: unknown;
  result: unknown;
}

/** Stored settings of a run (`simulation.run.input`). The network texts have their own columns. */
interface StoredInput {
  network: RunSummary["network"];
  params: CapacitySettings | null;
  sweep: boolean;
  design?: SweepDesign;
  objectives?: NewSweepRun["objectives"];
  /** Demand runs: the project's demand values the worker uses. */
  values?: Record<string, number>;
}

/** A file a run saved next to its result. */
export interface RunFile {
  name: string;
  mediaType: string;
  content: Buffer;
}

/** The one example network the kernels know by name (crates/rail-sim/src/capacity_input.rs). */
const EXAMPLE_NETWORK = "example:metro";

/** Message for a run whose worker stopped without settling it (a crash, a restart). */
export const WORKER_STOPPED = "the background worker stopped before the run finished; start it again";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** What the audit trail records about an agent that acted on a run. */
const agentNote = (v: AgentVia) => ({ connectionId: v.connectionId, client: v.clientName, tool: v.tool });

/**
 * Simulation runs saved with a project (ADR-0003, ADR-0023). Owners and Editors start, stop, run again and
 * delete runs; every
 * member who can read the project sees them. The run is stored first and then queued; a sim-worker process
 * does the work and writes progress and the result to the run.
 */
@Injectable()
export class RunsService {
  private readonly log = new Logger("RunsService");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly queue: RunQueue,
  ) {}

  /**
   * Purpose: save a run and queue it for the background worker.
   * Output: the queued run. Side effects: inserts `simulation.run`, sends a pg-boss job, audit
   * `simulation.run_started` (settings and file names, not the files). 503 when the queue cannot be reached:
   * the run is then saved as failed, so the list says what happened.
   */
  async start(actor: ProjectActor, projectId: string, input: NewRun, via?: AgentVia): Promise<RunDetail> {
    await this.projects.authorize(actor, projectId, "edit");
    const net =
      input.kind === "demand"
        ? {
            stored: { kind: "demand" as const, ...input.summary },
            network: input.bundle,
            lines: "",
          }
        : await this.resolveNetwork(projectId, input.network);
    const stored: StoredInput =
      input.kind === "demand"
        ? { network: net.stored, params: null, sweep: false, values: input.values }
        : {
            network: net.stored,
            params: input.params,
            sweep: input.kind === "capacity" ? input.sweep : false,
            ...(input.kind === "sweep" ? { design: input.design, objectives: input.objectives } : {}),
          };
    const id = await this.db.transaction().execute(async (tx) => {
      if (via) await this.holdToLimit(tx, via);
      const r = await tx
        .insertInto("simulation.run")
        .values({
          project_id: projectId,
          kind: input.kind,
          input: JSON.stringify(stored),
          network: net.network,
          lines: net.lines,
          progress: null,
          result: null,
          error: null,
          job_id: null,
          created_by: actor.userId,
          started_at: null,
          finished_at: null,
          agent_connection_id: via?.connectionId ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await this.audit.append(
        {
          chain: projectChain(projectId),
          action: "simulation.run_started",
          objectType: "simulation_run",
          objectId: r.id,
          projectId,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          after: {
            kind: input.kind,
            network: stored.network,
            params: stored.params,
            sweep: stored.sweep,
            ...(stored.design ? { design: stored.design, objectives: stored.objectives } : {}),
            // A demand run's values are many; the audit trail notes how many the project changed.
            ...(stored.values ? { values: Object.keys(stored.values).length } : {}),
            ...(via ? { agent: agentNote(via) } : {}),
          },
        },
        tx,
      );
      return r.id;
    });
    await this.enqueue(id);
    return this.get(actor, projectId, id);
  }

  /**
   * Purpose: run a saved run again with the same network and settings, replacing its result ("Run again").
   * The run keeps its ID and its place in the list; who started it and when become the caller and now.
   * 409 while it is still queued or running. Side effects: clears progress, result and error, queues a new
   * job, audit `simulation.run_restarted` (with how the old run had ended).
   */
  async rerun(actor: ProjectActor, projectId: string, runId: string, via?: AgentVia): Promise<RunDetail> {
    await this.projects.authorize(actor, projectId, "edit");
    await this.db.transaction().execute(async (tx) => {
      if (via) await this.holdToLimit(tx, via);
      const r = await tx
        .selectFrom("simulation.run")
        .select(["status", "result"])
        .where("project_id", "=", projectId)
        .where("id", "=", runId)
        .forUpdate()
        .executeTakeFirst();
      if (!r) throw new NotFoundException("run not found");
      if (r.status === "queued" || r.status === "running")
        throw new ConflictException("the run is still going; stop it or wait for it to finish");
      await tx.deleteFrom("simulation.run_file").where("run_id", "=", runId).execute();
      await tx
        .updateTable("simulation.run")
        .set({
          status: "queued",
          progress: null,
          result: null,
          error: null,
          cancel_requested: false,
          job_id: null,
          created_by: actor.userId,
          created_at: new Date(),
          started_at: null,
          finished_at: null,
          agent_connection_id: via?.connectionId ?? null,
        })
        .where("id", "=", runId)
        .execute();
      const verdict = (r.result as { run?: { verdict?: unknown } } | null)?.run?.verdict;
      await this.audit.append(
        {
          chain: projectChain(projectId),
          action: "simulation.run_restarted",
          objectType: "simulation_run",
          objectId: runId,
          projectId,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: { status: r.status, verdict: typeof verdict === "string" ? verdict : null },
          ...(via ? { after: { agent: agentNote(via) } } : {}),
        },
        tx,
      );
    });
    await this.enqueue(runId);
    return this.get(actor, projectId, runId);
  }

  /**
   * Purpose: delete a saved run and its result for everyone. A run that is still going is stopped: a queued
   * job is cancelled, and a running worker finds the run gone at its next step and stops.
   * Side effects: deletes `simulation.run`, audit `simulation.run_deleted` (settings and how it had ended).
   */
  async remove(actor: ProjectActor, projectId: string, runId: string): Promise<void> {
    await this.projects.authorize(actor, projectId, "edit");
    const jobId = await this.db.transaction().execute(async (tx) => {
      const r = await tx
        .deleteFrom("simulation.run")
        .where("project_id", "=", projectId)
        .where("id", "=", runId)
        .returning(["status", "input", "job_id", "result"])
        .executeTakeFirst();
      if (!r) throw new NotFoundException("run not found");
      const verdict = (r.result as { run?: { verdict?: unknown } } | null)?.run?.verdict;
      await this.audit.append(
        {
          chain: projectChain(projectId),
          action: "simulation.run_deleted",
          objectType: "simulation_run",
          objectId: runId,
          projectId,
          actorId: actor.userId,
          actorIpHash: actor.ipHash,
          requestId: actor.requestId,
          before: {
            status: r.status,
            verdict: typeof verdict === "string" ? verdict : null,
            ...(r.input as StoredInput),
          },
        },
        tx,
      );
      return r.status === "queued" ? r.job_id : null;
    });
    if (jobId)
      await this.queue.cancel(jobId).catch((e: unknown) => {
        this.log.warn(`could not cancel job ${jobId}: ${e instanceof Error ? e.message : String(e)}`);
      });
  }

  /** Purpose: the project's runs, newest first (at most 100), for every member who can read the project. */
  async list(actor: ProjectActor, projectId: string): Promise<RunSummary[]> {
    await this.projects.authorize(actor, projectId, "read");
    const rows = await this.query()
      .select("r.result")
      .where("r.project_id", "=", projectId)
      .orderBy("r.created_at", "desc")
      .limit(100)
      .execute();
    await this.reconcile(rows);
    return rows.map((r) => this.summary(r));
  }

  /** Purpose: one run with its progress and result. 404 when it is not a run of this project. */
  async get(actor: ProjectActor, projectId: string, runId: string): Promise<RunDetail> {
    await this.projects.authorize(actor, projectId, "read");
    const r = await this.query()
      .select(["r.progress", "r.result"])
      .where("r.project_id", "=", projectId)
      .where("r.id", "=", runId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException("run not found");
    await this.reconcile([r]);
    return { ...this.summary(r), progress: r.progress ?? null, result: r.result ?? null };
  }

  /**
   * Purpose: a file a run saved next to its result (a demand run's `od.omx`). 404 when the run or the file is
   * not there. Every member who can read the project may download it.
   */
  async file(actor: ProjectActor, projectId: string, runId: string, name: string): Promise<RunFile> {
    await this.projects.authorize(actor, projectId, "read");
    const f = await this.db
      .selectFrom("simulation.run_file as f")
      .innerJoin("simulation.run as r", "r.id", "f.run_id")
      .select(["f.name", "f.media_type", "f.content"])
      .where("r.project_id", "=", projectId)
      .where("r.id", "=", runId)
      .where("f.name", "=", name)
      .executeTakeFirst();
    if (!f) throw new NotFoundException("file not found");
    return { name: f.name, mediaType: f.media_type, content: f.content };
  }

  /**
   * Purpose: stop a run. A queued run is cancelled at once; a running one stops after the step it is on (the
   * worker checks between sweep points) and keeps what it found. Settled runs are left as they are.
   * Side effects: audit `simulation.run_cancelled`.
   */
  async cancel(actor: ProjectActor, projectId: string, runId: string, via?: AgentVia): Promise<RunDetail> {
    await this.projects.authorize(actor, projectId, "edit");
    const r = await this.db
      .selectFrom("simulation.run")
      .select(["status", "job_id"])
      .where("project_id", "=", projectId)
      .where("id", "=", runId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException("run not found");
    if (r.status === "queued" || r.status === "running") {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .updateTable("simulation.run")
          .set({ cancel_requested: true })
          .where("id", "=", runId)
          .execute();
        // A queued run is settled here; if a worker takes its job anyway, it finds the run settled and skips it.
        await tx
          .updateTable("simulation.run")
          .set({ status: "cancelled", finished_at: new Date() })
          .where("id", "=", runId)
          .where("status", "=", "queued")
          .execute();
        await this.audit.append(
          {
            chain: projectChain(projectId),
            action: "simulation.run_cancelled",
            objectType: "simulation_run",
            objectId: runId,
            projectId,
            actorId: actor.userId,
            actorIpHash: actor.ipHash,
            requestId: actor.requestId,
            before: { status: r.status },
            ...(via ? { after: { agent: agentNote(via) } } : {}),
          },
          tx,
        );
      });
      if (r.status === "queued" && r.job_id)
        await this.queue.cancel(r.job_id).catch((e: unknown) => {
          this.log.warn(`could not cancel job ${r.job_id}: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
    return this.get(actor, projectId, runId);
  }

  // ---------------------------------------------------------------------------------------------------------

  /**
   * Purpose: the network texts to store for a new run, and what the list shows about them. A `run` network is
   * copied from a saved run of the same project (404 when there is none).
   */
  private async resolveNetwork(
    projectId: string,
    n: RunNetwork,
  ): Promise<{ stored: StoredInput["network"]; network: string; lines: string }> {
    if (n.kind === "example") return { stored: n, network: EXAMPLE_NETWORK, lines: "" };
    if (n.kind === "files")
      return {
        stored: { kind: "files", topologyName: n.topologyName, linesName: n.linesName },
        network: n.topology,
        lines: n.lines,
      };
    const r = await this.db
      .selectFrom("simulation.run")
      .select(["input", "network", "lines"])
      .where("project_id", "=", projectId)
      .where("id", "=", n.runId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException("the run to take the network from was not found in this project");
    if ((r.input as StoredInput).network.kind === "demand")
      throw new BadRequestException("a demand run has no railway network to run again");
    return { stored: (r.input as StoredInput).network, network: r.network, lines: r.lines };
  }

  /**
   * Purpose: hold an agent connection to its limit of runs at once (ADR-0035 §7). Serialised per connection
   * with a transaction lock, so two calls at the same moment cannot both pass. 429 when the limit is reached.
   */
  private async holdToLimit(tx: Kysely<DB>, via: AgentVia): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${"agent-runs:" + via.connectionId}))`.execute(tx);
    const open = await tx
      .selectFrom("simulation.run")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("agent_connection_id", "=", via.connectionId)
      .where("status", "in", ["queued", "running"])
      .executeTakeFirstOrThrow();
    if (Number(open.n) >= via.maxOpen)
      throw new HttpException(
        `this agent connection already has ${open.n} runs queued or running (the limit is ${via.maxOpen}); wait for one to finish or cancel one`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  /** Purpose: queue a stored run. 503 when the queue cannot be reached: the run is then settled as failed. */
  private async enqueue(id: string): Promise<void> {
    try {
      const jobId = await this.queue.send({ runId: id });
      await this.db.updateTable("simulation.run").set({ job_id: jobId }).where("id", "=", id).execute();
    } catch (e) {
      this.log.error(`could not queue run ${id}: ${e instanceof Error ? e.message : String(e)}`);
      await this.settle(id, "failed", "the run could not be queued; try again in a moment");
      throw new ServiceUnavailableException("the background worker queue cannot be reached; try again");
    }
  }

  private query() {
    return this.db
      .selectFrom("simulation.run as r")
      .leftJoin("iam.user as u", "u.id", "r.created_by")
      .leftJoin("agent.connection as c", "c.id", "r.agent_connection_id")
      .select([
        "c.name as agent_name",
        "r.id",
        "r.kind",
        "r.status",
        "r.input",
        "r.error",
        "r.cancel_requested",
        "r.job_id",
        "r.created_by",
        "u.display_name as created_by_name",
        "r.created_at",
        "r.started_at",
        "r.finished_at",
      ]);
  }

  private summary(r: {
    id: string;
    kind: RunKind;
    agent_name: string | null;
    status: RunStatus;
    input: unknown;
    error: string | null;
    cancel_requested: boolean;
    created_by: string | null;
    created_by_name: string | null;
    created_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
    result?: unknown;
  }): RunSummary {
    const input = r.input as StoredInput;
    const result = r.result as { run?: { verdict?: unknown } } | null | undefined;
    const verdict = result?.run?.verdict;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      network: input.network,
      params: input.params,
      sweep: input.sweep,
      ...(input.design ? { design: input.design, objectives: input.objectives ?? [] } : {}),
      agent: r.agent_name,
      verdict: typeof verdict === "string" ? verdict : null,
      error: r.error,
      cancelRequested: r.cancel_requested,
      createdBy: r.created_by ? { id: r.created_by, displayName: r.created_by_name } : null,
      createdAt: r.created_at.toISOString(),
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
    };
  }

  /**
   * Purpose: settle runs whose job ended without the worker settling them: pg-boss failed the job after the
   * worker stopped beating (a crash, a restart), or deleted it. Runs whose job is still queued or running are
   * left alone. Mutates the rows it settles, so the caller's answer is current.
   */
  private async reconcile(
    rows: {
      id: string;
      status: RunStatus;
      job_id: string | null;
      error: string | null;
      finished_at: Date | null;
    }[],
  ): Promise<void> {
    const open = rows.filter((r) => (r.status === "queued" || r.status === "running") && r.job_id);
    if (!open.length) return;
    let states: Map<string, JobState>;
    try {
      states = await this.queue.states(open.map((r) => r.job_id!));
    } catch {
      return;
    }
    for (const r of open) {
      const s = states.get(r.job_id!);
      if (s === "created" || s === "retry" || s === "active") continue;
      // A completed job settled its run; read the run again rather than guess (the worker settles the run
      // before the job, so this only happens in the instant between the two writes).
      if (s === "completed") continue;
      if (await this.settle(r.id, "failed", WORKER_STOPPED)) {
        r.status = "failed";
        r.error = WORKER_STOPPED;
        r.finished_at = new Date();
      }
    }
  }

  /** Purpose: settle a run that is still open. Output: whether it was open. */
  private async settle(id: string, status: "failed" | "cancelled", error: string | null): Promise<boolean> {
    const r = await this.db
      .updateTable("simulation.run")
      .set({ status, error, finished_at: new Date() })
      .where("id", "=", id)
      .where("status", "in", ["queued", "running"])
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }
}

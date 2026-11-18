import { createGzip } from "node:zlib";
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
import { GbfsClient, GbfsError } from "../gateway/gbfs.client";
import { OverpassError } from "../gateway/overpass.client";
import { type BikeAccess, StreetNetworkService } from "../street-network/street-network.service";
import type { CapacitySettings, SweepDesign, SweepMetric } from "./params";
import { type JobState, RunQueue } from "./queue";
import { MAX_ROAD_TILES, type RoadScenario, type RoadSettings, roadTiles, tileOf } from "./road";
import type { CalendarPlan, CalendarSettings } from "./calendar";

/** The network of a capacity run: the example metro, or the railway editor's topology with a lines file. */
export type RunNetwork =
  | { kind: "example" }
  | { kind: "files"; topology: string; topologyName: string; lines: string; linesName: string }
  /** The network and lines of a saved run of the same project (agents use this to avoid resending files). */
  | { kind: "run"; runId: string };

/** Purpose: a calendar plan as runs show it: without the day types' own service lines, which only the worker reads. */
function shownPlan(plan: CalendarPlan): CalendarPlan {
  const day_types = Object.fromEntries(
    Object.entries(plan.day_types).map(([k, d]) => {
      const rest = { ...d };
      delete rest.lines;
      return [k, rest];
    }),
  ) as CalendarPlan["day_types"];
  return { ...plan, day_types };
}

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
  /** A GBFS feed of the project's shared-bike scheme, read with the OpenStreetMap stations. */
  gbfsUrl?: string;
  /** Observed mode shares, mean car trip and boardings to calibrate to (09 §2.3). */
  observed?: ObservedDemand;
}

/** What the planner observed, for a demand run's calibration (worker `demand/calibrate.py`). */
export interface ObservedDemand {
  mode_shares?: { car: number; transit: number; walk: number; cycle: number };
  mean_car_km?: number;
  counts?: { kind: "line" | "stop"; id: string; value: number }[];
}

/** Size of a demand run's bundle, for the list of runs. */
export interface DemandSummary {
  zones: number;
  stops: number;
  lines: number;
}

/**
 * A road simulation (Phase 5): the project's street lines with their depots and the background traffic of the
 * GIS tab's street setup, in SUMO, for one period. The API adds the street tiles the lines need.
 */
export interface NewRoadRun {
  kind: "road";
  params: RoadSettings;
  scenario: RoadScenario;
}

/**
 * A calendar run (ADR-0020): the rail service (if the project has rail service lines) run once per day type over
 * its service day, and the day figures expanded over many years, one date or a row of dates (./calendar.ts).
 */
export interface NewCalendarRun {
  kind: "calendar";
  /** The rail network, or null when the project has no rail service to run. */
  network: RunNetwork | null;
  params: CalendarSettings;
  plan: CalendarPlan;
}

export type NewRun = NewCapacityRun | NewSweepRun | NewRoadRun | NewDemandRun | NewCalendarRun;

/** What the run list shows about a road run's network: its lines and depots, and how many street tiles. */
export interface RoadNetworkSummary {
  kind: "road";
  lines: { index: number; name: string; mode: string; color: string }[];
  depots: number;
  tiles: number;
}

/** Most runs one person may have queued or running at once from the web app (agents have their own limit). */
export const MAX_OPEN_RUNS_PER_USER = 20;

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
    | RoadNetworkSummary
    | ({ kind: "demand" } & DemandSummary)
    | { kind: "none" };
  /** Capacity runs and sweeps: their settings; road and calendar runs: theirs; null for demand runs. */
  params: CapacitySettings | RoadSettings | CalendarSettings | null;
  sweep: boolean;
  /** Calendar runs only: what is run and expanded (./calendar.ts). */
  plan?: CalendarPlan;
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
  params: CapacitySettings | RoadSettings | CalendarSettings | null;
  sweep: boolean;
  plan?: CalendarPlan;
  design?: SweepDesign;
  objectives?: NewSweepRun["objectives"];
  /** Demand runs: the project's demand values the worker uses, and the shared-bike GBFS feed. */
  values?: Record<string, number>;
  gbfsUrl?: string;
  /** Demand runs: the observed data the worker calibrates to. */
  observed?: ObservedDemand;
}

/** A file a run saved next to its result. */
export interface RunFile {
  name: string;
  mediaType: string;
  content: Buffer;
}

/** The one example network the kernels know by name (crates/rail-sim/src/capacity_input.rs). */
const EXAMPLE_NETWORK = "example:metro";

/** Largest street tile text of a road run (db/migrations/0009_road_runs.sql). */
const MAX_ROAD_NETWORK_CHARS = 64 * 1024 * 1024;

/**
 * Most street tiles one demand run may take: about 28 × 28 km at 50° N and 36 × 36 km at 33° N, a whole city
 * network with its airport line. The tiles are compressed as they arrive, and the network column's size limit
 * (`MAX_ROAD_NETWORK_CHARS`) still guards a very dense area.
 */
export const MAX_DEMAND_TILES = 320;

/**
 * Purpose: the street tiles a demand run needs: the tile of every zone centre in the bundle (JSON text,
 * contracts/demand-input.schema.json) and the tiles around it, so streets reach past each zone's edge.
 * Output: tiles `[x, y]`, north to south, west to east; empty when the bundle has no zone centres.
 */
export function demandTiles(bundle: string): [number, number][] {
  let zones: unknown;
  try {
    zones = (JSON.parse(bundle) as { zones?: unknown }).zones;
  } catch {
    throw new BadRequestException("the demand model input is not JSON");
  }
  const seen = new Map<string, [number, number]>();
  for (const z of Array.isArray(zones) ? zones : []) {
    const c = (z as { centroid?: unknown })?.centroid;
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[1]) > 85) continue;
    const [x0, y0] = tileOf(c[0], c[1]);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) seen.set(`${x0 + dx}/${y0 + dy}`, [x0 + dx, y0 + dy]);
    if (seen.size > 4 * MAX_DEMAND_TILES) break;
  }
  return [...seen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/**
 * Purpose: build a gzipped JSON list of strings whose items arrive out of order (tiles fetched in parallel),
 * compressing each one as soon as the items before it are in, so only the compressed list and the few items
 * waiting for an earlier one are held in memory.
 * Output: `put(index, text)` for each item 0…n−1, and `finish()`, which closes the list (items not yet put are
 * left out) and gives the gzipped bytes.
 */
export function gzipList(): { put: (i: number, text: string) => void; finish: () => Promise<Buffer> } {
  const gz = createGzip();
  const chunks: Buffer[] = [];
  gz.on("data", (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((ok, fail) => {
    gz.on("end", ok);
    gz.on("error", fail);
  });
  gz.write("[");
  const waiting = new Map<number, string>();
  let written = 0;
  return {
    put: (i, text) => {
      waiting.set(i, text);
      while (waiting.has(written)) {
        gz.write((written ? "," : "") + JSON.stringify(waiting.get(written)));
        waiting.delete(written++);
      }
    },
    finish: async () => {
      waiting.clear();
      gz.end("]");
      await ended;
      return Buffer.concat(chunks);
    },
  };
}

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
    private readonly streets: StreetNetworkService,
    private readonly gbfs: GbfsClient,
  ) {}

  /**
   * Purpose: save a run and queue it for the background worker.
   * Output: the queued run. Side effects: inserts `simulation.run`, sends a pg-boss job, audit
   * `simulation.run_started` (settings and file names, not the files). 503 when the queue cannot be reached:
   * the run is then saved as failed, so the list says what happened.
   */
  async start(actor: ProjectActor, projectId: string, input: NewRun, via?: AgentVia): Promise<RunDetail> {
    await this.projects.authorize(actor, projectId, "edit");
    const demand = input.kind === "demand" ? this.demandNetwork(input) : null;
    const net =
      input.kind === "demand"
        ? demand!
        : input.kind === "road"
          ? await this.roadNetwork(input.scenario)
          : input.network === null
            ? { stored: { kind: "none" as const }, network: "", lines: "" }
            : await this.resolveNetwork(projectId, input.network);
    const stored: StoredInput =
      input.kind === "demand"
        ? {
            network: net.stored,
            params: null,
            sweep: false,
            values: input.values,
            ...(input.gbfsUrl ? { gbfsUrl: input.gbfsUrl } : {}),
            ...(input.observed ? { observed: input.observed } : {}),
          }
        : {
            network: net.stored,
            params: input.params,
            sweep: input.kind === "capacity" ? input.sweep : false,
            ...(input.kind === "sweep" ? { design: input.design, objectives: input.objectives } : {}),
            ...(input.kind === "calendar" ? { plan: input.plan } : {}),
          };
    const id = await this.db.transaction().execute(async (tx) => {
      if (via) await this.holdToLimit(tx, via);
      else await this.holdUserToLimit(tx, actor.userId);
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
            ...(stored.observed ? { observed: true } : {}),
            ...(via ? { agent: agentNote(via) } : {}),
          },
        },
        tx,
      );
      return r.id;
    });
    // A demand run is queued once its streets are loaded, in the background (they can take minutes).
    if (demand)
      void this.prepareDemand(
        id,
        projectId,
        demand.tiles,
        input.kind === "demand" ? input.gbfsUrl : undefined,
      );
    else await this.enqueue(id);
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
      else await this.holdUserToLimit(tx, actor.userId);
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
      await tx.deleteFrom("simulation.run_replay").where("run_id", "=", runId).execute();
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
    // A demand run whose streets never loaded loads them again first.
    const stored = await this.db
      .selectFrom("simulation.run")
      .select(["kind", "lines", "input"])
      .where("id", "=", runId)
      .where("network", "=", "{}")
      .executeTakeFirst();
    if (stored?.kind === "demand")
      void this.prepareDemand(
        runId,
        projectId,
        demandTiles(stored.lines),
        (stored.input as StoredInput).gbfsUrl,
      );
    else await this.enqueue(runId);
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

  /**
   * Purpose: the replay of a road run (gzipped JSON, worker `pack_replay`), for every member who can read the
   * project. 404 when the run is not in the project or has no replay (not a road run, or not finished).
   */
  async replay(actor: ProjectActor, projectId: string, runId: string): Promise<Buffer> {
    await this.projects.authorize(actor, projectId, "read");
    const r = await this.db
      .selectFrom("simulation.run_replay as p")
      .innerJoin("simulation.run as r", "r.id", "p.run_id")
      .select("p.data")
      .where("r.project_id", "=", projectId)
      .where("r.id", "=", runId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException("this run has no replay");
    return r.data;
  }

  /**
   * Purpose: the scenario a road run ran (lines with their legs and departures, depots, streets), as the
   * simulator panel sent it; the noise map takes the run's lines from it. 404 for another kind of run.
   */
  async roadScenario(actor: ProjectActor, projectId: string, runId: string): Promise<string> {
    await this.projects.authorize(actor, projectId, "read");
    const r = await this.db
      .selectFrom("simulation.run")
      .select("lines")
      .where("project_id", "=", projectId)
      .where("id", "=", runId)
      .where("kind", "=", "road")
      .executeTakeFirst();
    if (!r) throw new NotFoundException("no such road run");
    return r.lines;
  }

  // ---------------------------------------------------------------------------------------------------------

  /**
   * Purpose: the network of a road run: the street tiles (OSM XML, as the street line tool loads them) of the
   * area its lines and depots cover, and the scenario. 400 when the area takes more than `MAX_ROAD_TILES`
   * tiles; 502/504 when OpenStreetMap cannot be reached for a tile that is not cached.
   */
  private async roadNetwork(
    scenario: RoadScenario,
  ): Promise<{ stored: RoadNetworkSummary; network: string; lines: string }> {
    const tiles = roadTiles(scenario);
    if (!tiles.length) throw new BadRequestException("the street lines have no routes");
    if (tiles.length > MAX_ROAD_TILES)
      throw new BadRequestException(
        `the street lines and depots cover too large an area for one road run (${tiles.length} street tiles, at most ${MAX_ROAD_TILES})`,
      );
    const xml: string[] = [];
    for (const [x, y] of tiles) {
      try {
        xml.push(await this.streets.tile(x, y));
      } catch (e) {
        if (e instanceof OverpassError)
          throw new HttpException("OpenStreetMap streets are unavailable right now; try again", e.status);
        throw e;
      }
    }
    const network = JSON.stringify({ tiles: xml });
    if (network.length > MAX_ROAD_NETWORK_CHARS)
      throw new BadRequestException(
        "the streets of the area the street lines cover are too large for one road run; split the lines into smaller areas",
      );
    return {
      stored: {
        kind: "road",
        lines: scenario.lines.map((l) => ({ index: l.index, name: l.name, mode: l.mode, color: l.color })),
        depots: scenario.depots.length,
        tiles: tiles.length,
      },
      network,
      lines: JSON.stringify(scenario),
    };
  }

  /**
   * Purpose: what to store for a new demand run before its streets are loaded: the bundle, and the street tiles
   * around every zone centre that `prepareDemand` loads next. 400 when the bundle has no zone centres or the
   * zones take more than `MAX_DEMAND_TILES` tiles.
   */
  private demandNetwork(input: NewDemandRun): {
    stored: StoredInput["network"];
    network: string;
    lines: string;
    tiles: [number, number][];
  } {
    const tiles = demandTiles(input.bundle);
    if (!tiles.length) throw new BadRequestException("the demand model input has no zones");
    if (tiles.length > MAX_DEMAND_TILES)
      throw new BadRequestException(
        `the zones cover too large an area for one demand run (${tiles.length} street tiles, at most ${MAX_DEMAND_TILES}); use a smaller buffer or fewer lines`,
      );
    return { stored: { kind: "demand", ...input.summary }, network: "{}", lines: input.bundle, tiles };
  }

  /**
   * Purpose: load the OpenStreetMap street tiles of a queued demand run in the background (from the project's OSM
   * import where it has one, as the street line tool does), store them gzipped
   * in its network (worker `jobs/demand.py` `street_tiles`) with the bike parkings and shared-bike stations of
   * the same tiles and of the GBFS feed (`bikes`), and queue it. The run's progress counts the tiles. A run
   * stopped meanwhile is left as it is; a run whose streets cannot be loaded fails with the reason. Bike points
   * that cannot be loaded are left out with a note in the result.
   */
  private async prepareDemand(
    id: string,
    projectId: string,
    tiles: [number, number][],
    gbfsUrl?: string,
  ): Promise<void> {
    const open = async () =>
      (
        await this.db
          .selectFrom("simulation.run")
          .select(["status", "cancel_requested"])
          .where("id", "=", id)
          .executeTakeFirst()
      )?.status === "queued";
    try {
      // The tiles go into one gzipped JSON list in order as they arrive, so the API holds them compressed, not
      // the whole area's OSM XML at once.
      const list = gzipList();
      const put = list.put;
      let next = 0;
      let done = 0;
      let stopped = false;
      const worker = async () => {
        for (let i = next++; i < tiles.length && !stopped; i = next++) {
          const [x, y] = tiles[i]!;
          // The project's own OSM import where it has one, as the street line tool reads it; Overpass otherwise.
          put(i, await this.streets.tile(x, y, projectId));
          done++;
          if (done % 8 === 0 || done === tiles.length) {
            if (!(await open())) stopped = true;
            else
              await this.db
                .updateTable("simulation.run")
                .set({ progress: JSON.stringify({ step: "streets", done, of: tiles.length }) })
                .where("id", "=", id)
                .execute();
          }
        }
      };
      let packed: Buffer;
      try {
        await Promise.all([worker(), worker(), worker(), worker()]);
      } finally {
        packed = await list.finish();
      }
      if (stopped || !(await open())) return;
      await this.db
        .updateTable("simulation.run")
        .set({ progress: JSON.stringify({ step: "bikes" }) })
        .where("id", "=", id)
        .execute();
      const bikes = await this.demandBikes(tiles, gbfsUrl);
      if (!(await open())) return;
      // A city's street tiles are large; gzipped they fit the run's network column.
      const network = JSON.stringify({
        tiles_gz: packed.toString("base64"),
        bikes,
      });
      if (network.length > MAX_ROAD_NETWORK_CHARS) {
        await this.settle(
          id,
          "failed",
          "the streets of the model area are too large for one demand run; use a smaller buffer or fewer lines",
        );
        return;
      }
      await this.db.updateTable("simulation.run").set({ network }).where("id", "=", id).execute();
      await this.enqueue(id);
    } catch (e) {
      const reason =
        e instanceof OverpassError
          ? "OpenStreetMap streets are unavailable right now; run it again in a moment"
          : e instanceof ServiceUnavailableException
            ? "the run could not be queued; try again in a moment"
            : `the streets of the model area could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
      this.log.warn(`demand run ${id}: ${reason}`);
      await this.settle(id, "failed", reason).catch(() => undefined);
    }
  }

  /**
   * Purpose: the bike parkings and shared-bike stations of a demand run's tiles (OpenStreetMap), and the
   * stations of its GBFS feed; each point once. Tiles or a feed that cannot be read give a note instead.
   */
  private async demandBikes(
    tiles: [number, number][],
    gbfsUrl?: string,
  ): Promise<{ parking: [number, number][]; rental: [number, number][]; notes: string[] }> {
    const parking = new Map<string, [number, number]>();
    const rental = new Map<string, [number, number]>();
    const add = (m: Map<string, [number, number]>, p: [number, number]) => m.set(`${p[0]},${p[1]}`, p);
    let failed = 0;
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < tiles.length; i = next++) {
        const [x, y] = tiles[i]!;
        try {
          const t = JSON.parse(await this.streets.bikeAccessTile(x, y)) as BikeAccess;
          for (const p of t.parking) add(parking, p);
          for (const p of t.rental) add(rental, p);
        } catch {
          failed++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const notes: string[] = [];
    if (failed)
      notes.push(
        `bike parkings and shared-bike stations of ${failed} of ${tiles.length} OpenStreetMap tiles could not be loaded`,
      );
    if (gbfsUrl) {
      try {
        const stations = await this.gbfs.stations(gbfsUrl);
        for (const p of stations) add(rental, p);
        if (!stations.length) notes.push("the GBFS feed lists no shared-bike stations");
      } catch (e) {
        notes.push(e instanceof GbfsError ? e.message : "the GBFS feed could not be read");
      }
    }
    return { parking: [...parking.values()], rental: [...rental.values()], notes };
  }

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

  /**
   * Purpose: hold a person to MAX_OPEN_RUNS_PER_USER runs queued or running at once, started from the web app
   * (security review: one member must not be able to fill the queue for everyone). Serialised per user like
   * holdToLimit. 429 when the limit is reached.
   */
  private async holdUserToLimit(tx: Kysely<DB>, userId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${"user-runs:" + userId}))`.execute(tx);
    const open = await tx
      .selectFrom("simulation.run")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("created_by", "=", userId)
      .where("agent_connection_id", "is", null)
      .where("status", "in", ["queued", "running"])
      .executeTakeFirstOrThrow();
    if (Number(open.n) >= MAX_OPEN_RUNS_PER_USER)
      throw new HttpException(
        `you already have ${open.n} runs queued or running (the limit is ${MAX_OPEN_RUNS_PER_USER}); wait for one to finish or stop one`,
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
      ...(input.plan ? { plan: shownPlan(input.plan) } : {}),
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

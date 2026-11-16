import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { InstanceRole } from "../db/database";
import type { ProjectActor, ProjectsService } from "../projects/projects.service";
import {
  capacityParams,
  type CapacitySettings,
  SWEEP_METRIC_IDS,
  SWEEP_METRICS,
  SWEEP_PARAM_IDS,
  type SweepDesign,
  sweepDesign,
  type SweepMetric,
  variantCount,
} from "../simulation/params";
import type { AgentVia, RunDetail, RunNetwork, RunsService, RunSummary } from "../simulation/runs.service";
import type { Scope } from "./oauth";

/**
 * Agent tools for simulation runs on the background worker (ADR-0035 §7, phase C): the rail capacity run of
 * the simulator tab, and sweeps of its settings. They act on the project's saved runs, the same ones planners
 * see in the simulator tab, with the user's project role: every member reads runs, Owners and Editors start
 * and stop them. Each agent connection may have `AGENT_MAX_OPEN_RUNS` runs queued or running at once.
 */

/** Most runs one agent connection may have queued or running at once (ADR-0035 §7 "Budgets"). */
export const AGENT_MAX_OPEN_RUNS = 2;

/** Largest full result returned to an agent, in characters of JSON; larger results come back summarised. */
export const MAX_FULL_RESULT_CHARS = 400_000;

export interface RunToolDeps {
  runs: RunsService;
  projects: ProjectsService;
}

/** What the tools need from the MCP server: the agent, and the scope-checking wrapper of mcp.tools.ts. */
export interface RunToolHost {
  server: McpServer;
  userId: string;
  role: InstanceRole;
  connectionId: string;
  clientName: string;
  requestId: string | null;
  run: <A>(scope: Scope, fn: (args: A) => Promise<unknown>) => (args: A) => Promise<CallToolResult>;
}

const projectId = z.uuid().describe("project id from list_projects");
const runId = z.uuid().describe("run id from start_run, run_sweep or list_runs");
const text = z
  .string()
  .min(2)
  .max(8 * 1024 * 1024);
const fileName = z.string().trim().min(1).max(200);

const network = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("example") }),
    z.strictObject({
      kind: z.literal("files"),
      topology: text.describe("the railway editor's topology export (JSON text)"),
      topology_name: fileName,
      lines: text.describe("the lines file (JSON text)"),
      lines_name: fileName,
    }),
    z.strictObject({
      kind: z.literal("run"),
      run_id: z.uuid().describe("a saved run of the same project whose network and lines to use"),
    }),
  ])
  .describe(
    "the railway to run: the example metro, the railway editor's files, or the network of a saved run of this project",
  );

const params = capacityParams.describe(
  "capacity run settings: the period from_s–to_s (s from the start of the service day) and optional settings; missing settings take the assumption-library defaults",
);

/** Purpose: the runs service's network from the tool's input. */
function toNetwork(n: z.infer<typeof network>): RunNetwork {
  if (n.kind === "files")
    return {
      kind: "files",
      topology: n.topology,
      topologyName: n.topology_name,
      lines: n.lines,
      linesName: n.lines_name,
    };
  if (n.kind === "run") return { kind: "run", runId: n.run_id };
  return n;
}

/** Purpose: one run as the agent sees it in a list. */
function brief(r: RunSummary) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    network: r.network,
    params: r.params,
    ...(r.kind === "capacity" ? { sweep_headways: r.sweep, verdict: r.verdict } : {}),
    ...(r.design
      ? { design: r.design.design, variants: variantCount(r.design), objectives: r.objectives }
      : {}),
    error: r.error,
    cancel_requested: r.cancelRequested,
    started_by: r.agent ? `agent: ${r.agent}` : (r.createdBy?.displayName ?? null),
    created_at: r.createdAt,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
  };
}

interface Point {
  headway_s: number;
  per_hour: number;
  unplaced: number;
  consumption: number;
  punctuality: number;
  disturbed_punctuality: number;
  knock_on_s: number;
  residual_delay_s: number;
  stable: boolean;
  problems: string[];
  verdict: string;
}
interface CapacityResult {
  notes?: string[];
  run?: { verdict: string; fleet: unknown; issues: string[] } | null;
  lines?: { info: { id: string; name: string }; planned: Point; sweep: Point[]; sweeping: boolean }[];
}
interface SweepVariant {
  i: number;
  params: Record<string, number>;
  verdict: string | null;
  metrics: Partial<Record<SweepMetric, number>>;
  error?: string;
}
interface SweepResult {
  total?: number;
  variants?: SweepVariant[];
  pareto?: number[];
}

const point = (x: Point) => ({
  headway_s: x.headway_s,
  per_hour: x.per_hour,
  verdict: x.verdict,
  consumption: x.consumption,
  punctuality: x.punctuality,
  disturbed_punctuality: x.disturbed_punctuality,
  knock_on_s: x.knock_on_s,
  residual_delay_s: x.residual_delay_s,
  unplaced: x.unplaced,
  stable: x.stable,
  problems: x.problems,
});

/**
 * Purpose: the part of a run's result an agent needs to decide: for a capacity run the verdict, fleet and the
 * key figures of each line; for a sweep the Pareto front and the best variant for each objective.
 */
export function summariseResult(r: RunDetail): unknown {
  if (r.result == null) return null;
  if (r.kind === "capacity") {
    const c = r.result as CapacityResult;
    return {
      verdict: c.run?.verdict ?? null,
      fleet: c.run?.fleet ?? null,
      issues: c.run?.issues ?? [],
      notes: c.notes ?? [],
      lines: (c.lines ?? []).map((l) => ({
        id: l.info.id,
        name: l.info.name,
        planned: point(l.planned),
        ...(r.sweep
          ? {
              headway_sweep: l.sweep.map((x) => ({
                headway_s: x.headway_s,
                per_hour: x.per_hour,
                verdict: x.verdict,
                consumption: x.consumption,
              })),
            }
          : {}),
      })),
    };
  }
  const s = r.result as SweepResult;
  const variants = s.variants ?? [];
  const ok = variants.filter((v) => !v.error);
  const best = Object.fromEntries(
    (r.objectives ?? []).map((o) => {
      let top: SweepVariant | null = null;
      for (const v of ok) {
        const x = v.metrics[o.metric];
        if (x === undefined) continue;
        const t = top?.metrics[o.metric];
        if (t === undefined || (o.better === "lower" ? x < t : x > t)) top = v;
      }
      return [o.metric, top?.i ?? null];
    }),
  );
  const pareto = new Set(s.pareto ?? []);
  return {
    variants_done: variants.length,
    variants_total: s.total ?? null,
    variants_failed: variants.length - ok.length,
    objectives: r.objectives,
    best_variant_per_objective: best,
    pareto_front: variants.filter((v) => pareto.has(v.i)),
  };
}

/** Purpose: register the run and sweep tools on the agent's MCP server. */
export function registerRunTools(h: RunToolHost, d: RunToolDeps): void {
  const { server, run } = h;
  const actor: ProjectActor = { userId: h.userId, role: h.role, ipHash: null, requestId: h.requestId };
  const via = (tool: string): AgentVia => ({
    connectionId: h.connectionId,
    clientName: h.clientName,
    tool,
    maxOpen: AGENT_MAX_OPEN_RUNS,
  });
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const started = (r: RunDetail) => ({
    run: brief(r),
    next: "The run is queued on the background worker. Call get_run_status with this run id to follow it; it is also listed under Saved runs in the project's simulator tab.",
  });

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "The projects the user is a member of, with the user's role. Simulation runs belong to a project: every member sees them, Owners and Editors start and stop them.",
      annotations: read,
    },
    run("simulation:run", async () => ({
      projects: (await d.projects.list(actor, false)).map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        area: x.areaName,
        modes: x.modes,
        my_role: x.myRole,
        can_start_runs: x.myRole === "owner" || x.myRole === "editor",
        updated_at: x.updatedAt,
      })),
    })),
  );

  server.registerTool(
    "list_runs",
    {
      title: "List simulation runs",
      description:
        "The project's saved simulation runs (rail capacity runs and settings sweeps), newest first, with status and who started them.",
      inputSchema: { project_id: projectId },
      annotations: read,
    },
    run("simulation:run", async ({ project_id }: { project_id: string }) => ({
      runs: (await d.runs.list(actor, project_id)).map(brief),
    })),
  );

  server.registerTool(
    "start_run",
    {
      title: "Start a rail capacity run",
      description:
        "Runs the simulator tab's rail capacity run on the background worker and saves it with the project: plans the period's timetable on the track, runs it, and tests stability with random primary delays (UIC 406 capacity consumption, punctuality, knock-on delays, fleet). With sweep_headways it also tries other headways for every line. Returns at once; follow it with get_run_status.",
      inputSchema: {
        project_id: projectId,
        network,
        params,
        sweep_headways: z
          .boolean()
          .default(false)
          .describe("also try other headways for every line, as the simulator tab's sweep does"),
      },
      annotations: write,
    },
    run(
      "simulation:run",
      async (a: {
        project_id: string;
        network: z.infer<typeof network>;
        params: CapacitySettings;
        sweep_headways: boolean;
      }) =>
        started(
          await d.runs.start(
            actor,
            a.project_id,
            { kind: "capacity", network: toNetwork(a.network), params: a.params, sweep: a.sweep_headways },
            via("start_run"),
          ),
        ),
    ),
  );

  server.registerTool(
    "run_sweep",
    {
      title: "Sweep capacity run settings",
      description:
        `Runs the rail capacity run once per variant of its settings, in one job on the background worker, and returns the Pareto front over the objectives. Vary settings over a full grid of values, or over ranges with a Latin hypercube (seeded, so the same sweep gives the same variants). At most 200 variants. Settings: ${SWEEP_PARAM_IDS.join(", ")}. Objectives: ` +
        SWEEP_METRIC_IDS.map(
          (m) => `${m} (${SWEEP_METRICS[m].better} is better: ${SWEEP_METRICS[m].meaning})`,
        ).join("; ") +
        ". Returns at once; follow it with get_run_status.",
      inputSchema: {
        project_id: projectId,
        network,
        params: params.describe(
          "settings every variant shares, including the period; the design overrides the ones it varies",
        ),
        design: sweepDesign.describe(
          "{design:'grid', parameters:[{name, values}]} or {design:'latin_hypercube', parameters:[{name, min, max}], samples, seed}",
        ),
        objectives: z
          .array(z.enum(SWEEP_METRIC_IDS))
          .min(1)
          .max(3)
          .default(["verdict_rank", "min_disturbed_punctuality"])
          .describe("the measures the Pareto front is taken over"),
      },
      annotations: write,
    },
    run(
      "simulation:run",
      async (a: {
        project_id: string;
        network: z.infer<typeof network>;
        params: CapacitySettings;
        design: SweepDesign;
        objectives: SweepMetric[];
      }) => {
        const varied = new Set(a.design.parameters.map((x) => x.name));
        const objectives = [...new Set(a.objectives)].map((m) => ({
          metric: m,
          better: SWEEP_METRICS[m].better,
        }));
        const r = await d.runs.start(
          actor,
          a.project_id,
          { kind: "sweep", network: toNetwork(a.network), params: a.params, design: a.design, objectives },
          via("run_sweep"),
        );
        return {
          ...started(r),
          variants: variantCount(a.design),
          varied: [...varied],
        };
      },
    ),
  );

  server.registerTool(
    "get_run_status",
    {
      title: "Get a run's status and result",
      description:
        "Status and progress of a saved run, and its result: summary gives the verdict, fleet and key figures per line (capacity run) or the Pareto front (sweep); full gives the whole result when it is small enough.",
      inputSchema: {
        project_id: projectId,
        run_id: runId,
        detail: z.enum(["summary", "full"]).default("summary"),
      },
      annotations: read,
    },
    run("simulation:run", async (a: { project_id: string; run_id: string; detail: "summary" | "full" }) => {
      const r = await d.runs.get(actor, a.project_id, a.run_id);
      const out = { run: brief(r), progress: r.progress, result: summariseResult(r) };
      if (a.detail === "full" && r.result != null) {
        const full = JSON.stringify(r.result);
        if (full.length <= MAX_FULL_RESULT_CHARS) return { ...out, full_result: r.result };
        return {
          ...out,
          note: `the full result is ${full.length} characters, above the ${MAX_FULL_RESULT_CHARS} returned to agents; the summary is shown, and the whole result is in the project's simulator tab`,
        };
      }
      return out;
    }),
  );

  server.registerTool(
    "cancel_run",
    {
      title: "Stop a run",
      description:
        "Stops a queued or running run. A running one stops after the step it is on and keeps what it found.",
      inputSchema: { project_id: projectId, run_id: runId },
      annotations: write,
    },
    run("simulation:run", async (a: { project_id: string; run_id: string }) => ({
      run: brief(await d.runs.cancel(actor, a.project_id, a.run_id, via("cancel_run"))),
    })),
  );

  server.registerTool(
    "rerun",
    {
      title: "Run a saved run again",
      description:
        "Runs a finished, failed or stopped run again with the same network and settings; its result is replaced in place.",
      inputSchema: { project_id: projectId, run_id: runId },
      annotations: { ...write, destructiveHint: true },
    },
    run("simulation:run", async (a: { project_id: string; run_id: string }) =>
      started(await d.runs.rerun(actor, a.project_id, a.run_id, via("rerun"))),
    ),
  );
}

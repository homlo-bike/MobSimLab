import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { buildMcpServer, type ToolDeps } from "../src/agents/mcp.tools";
import type { AgentPrincipal } from "../src/agents/oauth.service";
import { AGENT_MAX_OPEN_RUNS, summariseResult } from "../src/agents/run.tools";
import { capacityParams, MAX_SWEEP_VARIANTS, sweepDesign, variantCount } from "../src/simulation/params";
import type { RunDetail } from "../src/simulation/runs.service";

// Tool answers are JSON; the tests read into them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const PROJECT = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

function detail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    id: RUN,
    kind: "capacity",
    status: "queued",
    network: { kind: "example" },
    params: { from_s: 25200, to_s: 32400 },
    sweep: false,
    agent: "Claude",
    verdict: null,
    error: null,
    cancelRequested: false,
    createdBy: { id: "u1", displayName: "Ana" },
    createdAt: "2026-11-16T07:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    progress: null,
    result: null,
    ...over,
  };
}

const SWEEP_RESULT = {
  total: 3,
  variants: [
    {
      i: 0,
      params: { spare_share: 0.1 },
      verdict: "works",
      metrics: { vehicles: 11, min_disturbed_punctuality: 0.9 },
    },
    {
      i: 1,
      params: { spare_share: 0.2 },
      verdict: "works",
      metrics: { vehicles: 12, min_disturbed_punctuality: 0.95 },
    },
    { i: 2, params: { spare_share: 0.3 }, verdict: null, metrics: {}, error: "refused" },
  ],
  pareto: [0, 1],
};

async function connect(scopes: AgentPrincipal["scopes"], runs: Record<string, unknown>) {
  const principal: AgentPrincipal = {
    userId: "u1",
    role: "user",
    connectionId: "c1",
    clientName: "Claude",
    clientId: "client",
    scopes,
  };
  const projects = {
    list: vi.fn(async () => [
      {
        id: PROJECT,
        name: "Metro",
        description: "",
        areaName: null,
        modes: ["metro"],
        myRole: "editor",
        updatedAt: "x",
      },
    ]),
  };
  const deps = {
    scenarios: {},
    analysis: {},
    access: {},
    simulation: { runs, projects },
    instanceName: "Test",
  } as unknown as ToolDeps;
  const server = buildMcpServer(principal, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    const text = r.content[0]?.text ?? "";
    return {
      isError: r.isError ?? false,
      text,
      json: r.isError ? null : (JSON.parse(text) as Record<string, Loose>),
    };
  };
  return { client, call, projects };
}

describe("sweep settings", () => {
  it("counts the variants of a design", () => {
    const grid = sweepDesign.parse({
      design: "grid",
      parameters: [
        { name: "spare_share", values: [0.1, 0.2] },
        { name: "seed", values: [1, 2, 3] },
      ],
    });
    expect(variantCount(grid)).toBe(6);
    const lhs = sweepDesign.parse({
      design: "latin_hypercube",
      parameters: [{ name: "delayed_share", min: 0, max: 0.5 }],
      samples: 20,
    });
    expect(lhs.design === "latin_hypercube" && lhs.seed).toBe(1);
    expect(variantCount(lhs)).toBe(20);
  });

  it("refuses grids that are too big, values out of range, repeated settings and the period", () => {
    const big = Array.from({ length: 15 }, (_, i) => i);
    const r = sweepDesign.safeParse({
      design: "grid",
      parameters: [
        { name: "seed", values: big },
        { name: "stability_runs", values: big },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain(`at most ${MAX_SWEEP_VARIANTS}`);
    expect(
      sweepDesign.safeParse({ design: "grid", parameters: [{ name: "spare_share", values: [1.5] }] }).success,
    ).toBe(false);
    expect(
      sweepDesign.safeParse({
        design: "grid",
        parameters: [
          { name: "seed", values: [1] },
          { name: "seed", values: [2] },
        ],
      }).success,
    ).toBe(false);
    expect(
      sweepDesign.safeParse({ design: "grid", parameters: [{ name: "from_s", values: [0] }] }).success,
    ).toBe(false);
    expect(
      sweepDesign.safeParse({
        design: "latin_hypercube",
        parameters: [{ name: "spare_share", min: 0.4, max: 0.1 }],
        samples: 5,
      }).success,
    ).toBe(false);
  });

  it("checks capacity settings as the runs API does", () => {
    expect(capacityParams.safeParse({ from_s: 100, to_s: 50 }).success).toBe(false);
    expect(capacityParams.safeParse({ from_s: 0, to_s: 50, nonsense: 1 }).success).toBe(false);
    expect(capacityParams.safeParse({ from_s: 0, to_s: 50, delayed_share: 0.3 }).success).toBe(true);
  });
});

describe("run results for agents", () => {
  it("summarises a sweep as its Pareto front and the best variant per objective", () => {
    const s = summariseResult(
      detail({
        kind: "sweep",
        status: "done",
        result: SWEEP_RESULT,
        objectives: [
          { metric: "vehicles", better: "lower" },
          { metric: "min_disturbed_punctuality", better: "higher" },
        ],
      }),
    ) as Record<string, Loose>;
    expect(s.variants_done).toBe(3);
    expect(s.variants_failed).toBe(1);
    expect(s.best_variant_per_objective).toEqual({ vehicles: 0, min_disturbed_punctuality: 1 });
    expect(s.pareto_front.map((v: { i: number }) => v.i)).toEqual([0, 1]);
  });

  it("summarises a capacity run by line", () => {
    const planned = {
      headway_s: 180,
      per_hour: 20,
      verdict: "works",
      consumption: 0.6,
      punctuality: 0.98,
      disturbed_punctuality: 0.9,
      knock_on_s: 30,
      residual_delay_s: 5,
      unplaced: 0,
      stable: true,
      problems: [],
      bottleneck: "x",
    };
    const s = summariseResult(
      detail({
        status: "done",
        result: {
          notes: ["n"],
          run: { verdict: "works", fleet: { vehicles: 12 }, issues: [] },
          lines: [{ info: { id: "M1", name: "M1" }, planned, sweep: [], sweeping: false }],
        },
      }),
    ) as Record<string, Loose>;
    expect(s.verdict).toBe("works");
    expect(s.lines[0].planned.consumption).toBe(0.6);
    expect(s.lines[0].planned.bottleneck).toBeUndefined();
    expect(s.lines[0].headway_sweep).toBeUndefined();
  });
});

describe("run tools", () => {
  it("are listed only with the simulation:run permission", async () => {
    const without = await connect(["project:read"], {});
    expect((await without.call("list_projects")).text).toContain("simulation:run");
    const { client } = await connect(["simulation:run"], {});
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_projects",
        "list_runs",
        "start_run",
        "run_sweep",
        "get_run_status",
        "cancel_run",
        "rerun",
      ]),
    );
  });

  it("start a run as the agent's connection, under its limit of runs at once", async () => {
    const start = vi.fn(async () => detail());
    const { call, projects } = await connect(["simulation:run"], { start });
    expect((await call("list_projects")).json!.projects[0]).toMatchObject({
      id: PROJECT,
      can_start_runs: true,
    });
    expect(projects.list).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), false);
    const r = await call("start_run", {
      project_id: PROJECT,
      network: { kind: "run", run_id: RUN },
      params: { from_s: 25200, to_s: 32400 },
    });
    expect(r.isError).toBe(false);
    expect(r.json!.run.started_by).toBe("agent: Claude");
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", role: "user" }),
      PROJECT,
      {
        kind: "capacity",
        network: { kind: "run", runId: RUN },
        params: { from_s: 25200, to_s: 32400 },
        sweep: false,
      },
      { connectionId: "c1", clientName: "Claude", tool: "start_run", maxOpen: AGENT_MAX_OPEN_RUNS },
    );
  });

  it("start a sweep with the objectives' directions", async () => {
    const start = vi.fn<(...a: unknown[]) => Promise<RunDetail>>(async () => detail({ kind: "sweep" }));
    const { call } = await connect(["simulation:run"], { start });
    const r = await call("run_sweep", {
      project_id: PROJECT,
      network: { kind: "example" },
      params: { from_s: 25200, to_s: 32400 },
      design: { design: "grid", parameters: [{ name: "spare_share", values: [0.1, 0.2, 0.3] }] },
      objectives: ["vehicles", "min_punctuality"],
    });
    expect(r.isError).toBe(false);
    expect(r.json!.variants).toBe(3);
    expect(start.mock.calls[0]![2]).toMatchObject({
      kind: "sweep",
      objectives: [
        { metric: "vehicles", better: "lower" },
        { metric: "min_punctuality", better: "higher" },
      ],
    });
    const tooBig = await call("run_sweep", {
      project_id: PROJECT,
      network: { kind: "example" },
      params: { from_s: 0, to_s: 3600 },
      design: { design: "latin_hypercube", parameters: [{ name: "seed", min: 1, max: 9 }], samples: 500 },
    });
    expect(tooBig.isError).toBe(true);
  });

  it("pass the services' refusals to the agent", async () => {
    const start = vi.fn(async () => {
      throw new HttpException(
        "this agent connection already has 2 runs queued or running",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });
    const { call } = await connect(["simulation:run"], { start });
    const r = await call("start_run", {
      project_id: PROJECT,
      network: { kind: "example" },
      params: { from_s: 0, to_s: 3600 },
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("already has 2 runs");
  });

  it("return the summary, or the full result when asked", async () => {
    const get = vi.fn(async () =>
      detail({
        kind: "sweep",
        status: "done",
        result: SWEEP_RESULT,
        objectives: [{ metric: "vehicles", better: "lower" }],
      }),
    );
    const { call } = await connect(["simulation:run"], { get });
    const s = await call("get_run_status", { project_id: PROJECT, run_id: RUN });
    expect(s.json!.result.best_variant_per_objective).toEqual({ vehicles: 0 });
    expect(s.json!.full_result).toBeUndefined();
    const f = await call("get_run_status", { project_id: PROJECT, run_id: RUN, detail: "full" });
    expect(f.json!.full_result.variants).toHaveLength(3);
  });
});

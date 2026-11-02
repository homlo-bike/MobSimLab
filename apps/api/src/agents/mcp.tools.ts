import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type AnalysisService, type DemandPoint, PRESETS } from "./analysis.service";
import DEFAULTS from "./defaults.json";
import { KPI_CATALOGUE_VERSION, KPIS } from "./kpis";
import { NetworkError } from "./network.service";
import type { AgentPrincipal } from "./oauth.service";
import type { Scope } from "./oauth";
import {
  ChangeError,
  changeSchema,
  clockS,
  LIMITS,
  lonLat,
  type ScenarioDoc,
  summarise,
  validate,
} from "./scenario";
import { ScenarioError, type ScenariosService } from "./scenarios.service";
import { WasmMissingError } from "./wasm";

/** Version of the tool set; tool names and schemas are a public contract (ADR-0035 Consequences). */
export const TOOLS_VERSION = "0.1.0";

export interface ToolDeps {
  scenarios: ScenariosService;
  analysis: AnalysisService;
  instanceName: string;
  requestId?: string;
}

/** A tool refused for missing scope or a bad request; shown to the agent as a tool error. */
class ToolRefusal extends Error {}

const json = (v: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 1) }],
});

const scenarioId = z.string().uuid().describe("scenario id from list_scenarios or create_scenario");
const demandPoints = z
  .array(z.object({ lon: z.number(), lat: z.number(), weight: z.number().min(0).optional() }))
  .max(20_000)
  .optional()
  .describe(
    "weighted demand points, e.g. residents per building or grid cell; without them walkable street length is the stand-in",
  );

/**
 * Purpose: an MCP server with MobSimLab's tools, resources and prompts for one authenticated agent call.
 * Every tool checks its scope, runs the same services as the web app and returns JSON text. Text people typed
 * (names, descriptions) comes back as data fields only.
 */
export function buildMcpServer(p: AgentPrincipal, d: ToolDeps): McpServer {
  const server = new McpServer(
    { name: "mobsimlab", title: `MobSimLab · ${d.instanceName}`, version: TOOLS_VERSION },
    {
      instructions:
        "MobSimLab is a public transport planning simulator. Work in agent scenarios: create_scenario, then " +
        "apply_changes to add stops and lines with headways. Street lines (bus, brt, trolleybus, intercity_bus) are " +
        "routed on real streets; rail and tram lines use the route you give or straight lines. Measure with " +
        "coverage_report (headline: 15-minute walk to the nearest stop on the street network), measure_stop_spacing, " +
        "find_coverage_gaps, suggest_stop_locations, plan_journey, and compare with benchmark_scenarios. Every " +
        "number states its rule and the assumption-library keys behind it; quote them. You cannot change the base " +
        "network, sharing or users; a person reviews scenarios in MobSimLab.",
    },
  );
  const need = (s: Scope) => {
    if (!p.scopes.includes(s))
      throw new ToolRefusal(`this connection lacks the ${s} permission; reconnect to grant it`);
  };
  const actor = (tool: string) => ({
    userId: p.userId,
    connectionId: p.connectionId,
    clientName: p.clientName,
    tool,
    requestId: d.requestId ?? null,
  });
  const run =
    <A>(scope: Scope, fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        need(scope);
        return json(await fn(args));
      } catch (e) {
        if (
          e instanceof ToolRefusal ||
          e instanceof ScenarioError ||
          e instanceof ChangeError ||
          e instanceof NetworkError ||
          e instanceof WasmMissingError
        )
          return { content: [{ type: "text", text: e.message }], isError: true };
        throw e;
      }
    };
  const doc = async (id: string) => (await d.scenarios.get(p.userId, id)).doc;
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  // ---- Discover -------------------------------------------------------------------------------
  server.registerTool(
    "list_scenarios",
    {
      title: "List scenarios",
      description:
        "The scenarios in the user's MobSimLab workspace, newest change first, with who made them.",
      annotations: read,
    },
    run("project:read", async () => ({
      scenarios: (await d.scenarios.list(p.userId)).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        origin: s.origin,
        made_by: s.client_name,
        parent_id: s.parent_id,
        version: s.version,
        updated_at: s.updated_at,
      })),
    })),
  );

  server.registerTool(
    "get_scenario",
    {
      title: "Get scenario",
      description:
        "Stops, lines, headways and routing summary of a scenario. Set full to include stop coordinates and route geometry.",
      inputSchema: { scenario_id: scenarioId, full: z.boolean().default(false) },
      annotations: read,
    },
    run("project:read", async ({ scenario_id, full }: { scenario_id: string; full: boolean }) => {
      const s = await d.scenarios.get(p.userId, scenario_id);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        origin: s.origin,
        made_by: s.client_name,
        version: s.version,
        summary: summarise(s.doc),
        ...(full
          ? { stops: s.doc.stops, lines: s.doc.lines, routed: s.doc.routed }
          : { stops: s.doc.stops.map((x) => ({ id: x.id, name: x.name, lon: x.lon, lat: x.lat })) }),
      };
    }),
  );

  server.registerTool(
    "get_assumptions",
    {
      title: "Assumptions used by the analyses",
      description:
        "Default values per mode (speed, dwell, catchment, stop spacing guidance, recovery, layover, spares) and walk settings, with their assumption-library keys.",
      annotations: read,
    },
    run("project:read", async () => DEFAULTS),
  );

  // ---- Scenarios ------------------------------------------------------------------------------
  server.registerTool(
    "create_scenario",
    {
      title: "Create scenario",
      description:
        "Create an agent scenario, empty or as a copy of another scenario. It shows an Agent badge in MobSimLab; a person decides what to adopt.",
      inputSchema: {
        name: z.string().trim().min(1).max(200),
        description: z.string().max(4000).default(""),
        parent_scenario_id: scenarioId.optional().describe("copy this scenario"),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    run("scenario:write", async (a: { name: string; description: string; parent_scenario_id?: string }) => {
      const s = await d.scenarios.create(
        actor("create_scenario"),
        a.name,
        a.description,
        a.parent_scenario_id,
      );
      return { id: s.id, version: s.version, summary: summarise(s.doc) };
    }),
  );

  server.registerTool(
    "apply_changes",
    {
      title: "Apply changes",
      description:
        "Apply a batch of changes to a scenario atomically (all or nothing): add_stop, move_stop, rename_stop, " +
        "remove_stop, add_line, update_line, remove_line, set_study_area. Changed lines are routed again. Returns " +
        `the validation findings a planner would see. Limits: ${LIMITS.stops} stops, ${LIMITS.lines} lines.`,
      inputSchema: {
        scenario_id: scenarioId,
        changes: z.array(changeSchema).min(1).max(500),
        expected_version: z
          .number()
          .int()
          .optional()
          .describe("refuse if the scenario moved past this version"),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    run(
      "scenario:write",
      async (a: {
        scenario_id: string;
        changes: z.infer<typeof changeSchema>[];
        expected_version?: number;
      }) => {
        const s = await d.scenarios.apply(
          actor("apply_changes"),
          a.scenario_id,
          a.changes,
          a.expected_version,
        );
        return { version: s.version, summary: summarise(s.doc), findings: validate(s.doc) };
      },
    ),
  );

  server.registerTool(
    "validate_scenario",
    {
      title: "Validate scenario",
      description:
        "The checks the editors show: unused stops, missing service, spacing outliers, routing problems.",
      inputSchema: { scenario_id: scenarioId },
      annotations: read,
    },
    run("project:read", async ({ scenario_id }: { scenario_id: string }) => ({
      findings: validate(await doc(scenario_id)),
    })),
  );

  server.registerTool(
    "diff_scenarios",
    {
      title: "Compare two scenarios' contents",
      description: "Stops and lines added, removed or changed from scenario a to scenario b.",
      inputSchema: { a: scenarioId, b: scenarioId },
      annotations: read,
    },
    run("project:read", async ({ a, b }: { a: string; b: string }) => diff(await doc(a), await doc(b))),
  );

  server.registerTool(
    "delete_agent_scenario",
    {
      title: "Delete agent scenario",
      description:
        "Delete a scenario this same agent connection created. Other scenarios cannot be deleted by agents.",
      inputSchema: { scenario_id: scenarioId },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    run("scenario:write", async ({ scenario_id }: { scenario_id: string }) => {
      await d.scenarios.remove(actor("delete_agent_scenario"), scenario_id);
      return { deleted: scenario_id };
    }),
  );

  // ---- Analysis -------------------------------------------------------------------------------
  const analysisRead = { readOnlyHint: true, openWorldHint: true } as const;
  server.registerTool(
    "measure_stop_spacing",
    {
      title: "Measure stop spacing",
      description:
        "Distance between consecutive stops along each line's route and on foot along the street network, with statistics, a histogram and segments flagged against the mode's guidance range (mode.stop_spacing_m).",
      inputSchema: {
        scenario_id: scenarioId,
        line_id: z.string().optional(),
        on_foot: z
          .boolean()
          .default(true)
          .describe("also measure the walking distance between neighbouring stops"),
      },
      annotations: analysisRead,
    },
    run("analysis:run", async (a: { scenario_id: string; line_id?: string; on_foot: boolean }) =>
      d.analysis.spacing(await doc(a.scenario_id), a.line_id, a.on_foot),
    ),
  );

  const coverageInput = {
    scenario_id: scenarioId,
    preset: z
      .enum(PRESETS)
      .default("walk_minutes")
      .describe(
        "walk_minutes: walk time to the nearest stop (headline, 15 min); sdg_11_2_1: 500 m bus/tram or 1000 m rail; catchment_by_mode: mode.catchment_m; frequent_only: walk_minutes counting only frequent stops",
      ),
    minutes: z
      .number()
      .min(1)
      .max(60)
      .optional()
      .describe(`default ${DEFAULTS.walk_rule_minutes} (analysis.walk_rule_minutes)`),
    period: z.enum(["peak", "off_peak"]).default("peak"),
    max_headway_min: z.number().min(1).max(120).optional().describe("frequent_only threshold"),
    step_free: z.boolean().default(false).describe("leave out steps (wheelchair, pram)"),
    demand_points: demandPoints,
  };
  type CoverageArgs = {
    scenario_id: string;
    preset: (typeof PRESETS)[number];
    minutes?: number;
    period: "peak" | "off_peak";
    max_headway_min?: number;
    step_free: boolean;
    demand_points?: DemandPoint[];
  };
  const coverageOpts = (a: CoverageArgs) => ({
    preset: a.preset,
    minutes: a.minutes,
    period: a.period,
    maxHeadwayMin: a.max_headway_min,
    stepFree: a.step_free,
    demand: a.demand_points,
  });

  server.registerTool(
    "coverage_report",
    {
      title: "Walk coverage report",
      description:
        "How much demand lies within the rule's walk of a stop, measured along the street network (never circles; a crow-flies figure is given for comparison). The headline is the 15-minute walk to the nearest stop or station.",
      inputSchema: coverageInput,
      annotations: analysisRead,
    },
    run("analysis:run", async (a: CoverageArgs) => {
      const { raw, ...r } = await d.analysis.coverage(await doc(a.scenario_id), coverageOpts(a));
      void raw;
      return r;
    }),
  );

  server.registerTool(
    "find_coverage_gaps",
    {
      title: "Find coverage gaps",
      description:
        "Uncovered places with the most demand, largest first, as GeoJSON points with the walk to the nearest stop.",
      inputSchema: { ...coverageInput, limit: z.number().int().min(1).max(200).default(25) },
      annotations: analysisRead,
    },
    run("analysis:run", async (a: CoverageArgs & { limit: number }) =>
      d.analysis.gaps(await doc(a.scenario_id), coverageOpts(a), a.limit),
    ),
  );

  server.registerTool(
    "walk_catchment",
    {
      title: "Walk catchment",
      description:
        "The street network within the walk limit of the stops, each street segment with the minutes to its nearest stop, as GeoJSON (capped at 3000 segments).",
      inputSchema: {
        scenario_id: scenarioId,
        minutes: z.number().min(1).max(30).default(DEFAULTS.walk_rule_minutes),
        stop_ids: z.array(z.string()).max(500).optional(),
        step_free: z.boolean().default(false),
      },
      annotations: analysisRead,
    },
    run(
      "analysis:run",
      async (a: { scenario_id: string; minutes: number; stop_ids?: string[]; step_free: boolean }) => {
        const gj = await d.analysis.catchment(await doc(a.scenario_id), a.minutes, {
          stepFree: a.step_free,
          stopIds: a.stop_ids,
        });
        const n = gj.features.length;
        return {
          segments: n,
          truncated: n > 3000,
          geojson: { ...gj, features: gj.features.slice(0, 3000) },
        };
      },
    ),
  );

  server.registerTool(
    "suggest_stop_locations",
    {
      title: "Suggest stop locations",
      description:
        "Where k new stops along the scenario's routes would bring the most uncovered demand within the walk limit (maximal covering location problem, greedy). Deterministic, not AI.",
      inputSchema: {
        scenario_id: scenarioId,
        k: z.number().int().min(1).max(20).default(3),
        line_id: z.string().optional(),
        minutes: z.number().min(1).max(30).optional(),
        demand_points: demandPoints,
      },
      annotations: analysisRead,
    },
    run(
      "analysis:run",
      async (a: {
        scenario_id: string;
        k: number;
        line_id?: string;
        minutes?: number;
        demand_points?: DemandPoint[];
      }) =>
        d.analysis.suggestStops(await doc(a.scenario_id), a.k, {
          lineId: a.line_id,
          minutes: a.minutes,
          demand: a.demand_points,
        }),
    ),
  );

  server.registerTool(
    "plan_journey",
    {
      title: "Plan a journey",
      description:
        "Door-to-door journey A → B on the scenario's lines with the journey planner (walk, wait, ride, change). Lines run at their headways; rail running times come from the mode's speed and acceleration until published rail timetables exist.",
      inputSchema: {
        scenario_id: scenarioId,
        from: lonLat.describe("[lon, lat]"),
        to: lonLat.describe("[lon, lat]"),
        time: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .default("08:00"),
        arrive_by: z.boolean().default(false),
      },
      annotations: read,
    },
    run(
      "analysis:run",
      async (a: {
        scenario_id: string;
        from: [number, number];
        to: [number, number];
        time: string;
        arrive_by: boolean;
      }) => ({
        journeys: d.analysis.planJourney(
          await doc(a.scenario_id),
          a.from,
          a.to,
          clockS(a.time),
          a.arrive_by ? "arrive_by" : "depart_at",
        ),
        note: "Walks to and from stops are estimated as straight line × journey.walk_detour_factor.",
      }),
    ),
  );

  server.registerTool(
    "benchmark_scenarios",
    {
      title: "Benchmark scenarios",
      description:
        "One table of KPIs (from the KPI catalogue) for each scenario: size, peak vehicles, fleet, vehicle-km and -hours, median stop spacing, 15-minute walk coverage, SDG 11.2.1 and, with od_pairs, median journey time. Results are deterministic: the same scenarios give the same numbers.",
      inputSchema: {
        scenario_ids: z.array(scenarioId).min(1).max(8),
        od_pairs: z
          .array(z.tuple([lonLat, lonLat]))
          .max(50)
          .optional()
          .describe("[[from], [to]] pairs for journey times"),
        depart_at: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .default("08:00"),
        demand_points: demandPoints,
      },
      annotations: analysisRead,
    },
    run(
      "analysis:run",
      async (a: {
        scenario_ids: string[];
        od_pairs?: [[number, number], [number, number]][];
        depart_at: string;
        demand_points?: DemandPoint[];
      }) => {
        const rows = [];
        for (const id of a.scenario_ids) {
          const s = await d.scenarios.get(p.userId, id);
          rows.push({
            scenario: { id: s.id, name: s.name, version: s.version },
            ...(await d.analysis.benchmark(s.doc, {
              odPairs: a.od_pairs,
              departS: clockS(a.depart_at),
              demand: a.demand_points,
            })),
          });
        }
        return {
          kpi_catalogue: KPI_CATALOGUE_VERSION,
          kpis: KPIS.map((k) => ({ id: k.id, unit: k.unit, better: k.better })),
          rows,
        };
      },
    ),
  );

  // ---- Resources ------------------------------------------------------------------------------
  server.registerResource(
    "kpi-catalogue",
    "mobsimlab://kpis",
    {
      title: "KPI catalogue",
      description: "Every benchmark figure with unit, formula and source",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ version: KPI_CATALOGUE_VERSION, kpis: KPIS }),
        },
      ],
    }),
  );
  server.registerResource(
    "assumptions",
    "mobsimlab://assumptions/agent-defaults",
    {
      title: "Assumptions",
      description: "Defaults the analyses use, with assumption-library keys",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(DEFAULTS) }],
    }),
  );
  server.registerResource(
    "change-schema",
    "mobsimlab://schemas/changes",
    {
      title: "Change commands",
      description: "JSON Schema of the apply_changes commands",
      mimeType: "application/schema+json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/schema+json",
          text: JSON.stringify(z.toJSONSchema(changeSchema)),
        },
      ],
    }),
  );
  if (p.scopes.includes("project:read"))
    server.registerResource(
      "scenario",
      new ResourceTemplate("mobsimlab://scenarios/{id}", {
        list: async () => ({
          resources: (await d.scenarios.list(p.userId)).map((s) => ({
            uri: `mobsimlab://scenarios/${s.id}`,
            name: s.name,
            mimeType: "application/json",
          })),
        }),
      }),
      { title: "Scenario", description: "A scenario document", mimeType: "application/json" },
      async (uri, { id }) => {
        const s = await d.scenarios.get(p.userId, String(id));
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(s.doc) }] };
      },
    );

  // ---- Prompts --------------------------------------------------------------------------------
  server.registerPrompt(
    "benchmark_scenarios",
    {
      title: "Benchmark these scenarios",
      description: "Compare scenarios on the KPI catalogue and explain the trade-offs",
      argsSchema: { scenario_ids: z.string().describe("comma-separated scenario ids") },
    },
    ({ scenario_ids }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Run benchmark_scenarios on ${scenario_ids}. Present one table, KPI by scenario, with units. Say which ` +
              "scenario is better on each KPI using the catalogue's direction, quote the basis of the coverage figures, " +
              "and name the trade-offs (for example coverage against peak vehicles).",
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "check_walk_coverage",
    {
      title: "Check walk coverage and stop spacing",
      description: "Report the 15-minute walk coverage, SDG 11.2.1 and stop spacing of a scenario",
      argsSchema: { scenario_id: z.string() },
    },
    ({ scenario_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `For scenario ${scenario_id}: run coverage_report (walk_minutes, then sdg_11_2_1), measure_stop_spacing and ` +
              "find_coverage_gaps. Lead with the 15-minute walk coverage and its basis sentence, list lines with stops " +
              "too close or too far apart, and show the five largest gaps.",
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "reach_coverage_target",
    {
      title: "Find the cheapest change that reaches a coverage target",
      description:
        "Add or move stops until the 15-minute walk coverage reaches a target, in a copy of the scenario",
      argsSchema: { scenario_id: z.string(), target_pct: z.string().describe("e.g. 90") },
    },
    ({ scenario_id, target_pct }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Copy scenario ${scenario_id} with create_scenario (parent_scenario_id). Then repeat: coverage_report, ` +
              `suggest_stop_locations with k = 1, apply the suggestion, until the 15-minute walk coverage reaches ${target_pct} % ` +
              "or no suggestion gains anything. Keep stop spacing inside the guidance range. Finish with benchmark_scenarios " +
              "on the original and the copy, and list every stop you added.",
          },
        },
      ],
    }),
  );
  return server;
}

/** Purpose: what changed from scenario a to scenario b. */
export function diff(a: ScenarioDoc, b: ScenarioDoc) {
  const ids = <T extends { id: string }>(x: T[]) => new Map(x.map((v) => [v.id, v]));
  const as = ids(a.stops);
  const bs = ids(b.stops);
  const al = ids(a.lines);
  const bl = ids(b.lines);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  return {
    stops_added: [...bs.keys()].filter((k) => !as.has(k)),
    stops_removed: [...as.keys()].filter((k) => !bs.has(k)),
    stops_changed: [...bs.keys()].filter((k) => as.has(k) && !same(as.get(k), bs.get(k))),
    lines_added: [...bl.keys()].filter((k) => !al.has(k)),
    lines_removed: [...al.keys()].filter((k) => !bl.has(k)),
    lines_changed: [...bl.keys()]
      .filter((k) => al.has(k) && !same(al.get(k), bl.get(k)))
      .map((k) => {
        const x = al.get(k)!;
        const y = bl.get(k)!;
        return {
          line: k,
          fields: (Object.keys({ ...x, ...y }) as (keyof typeof x)[]).filter((f) => !same(x[f], y[f])),
        };
      }),
  };
}

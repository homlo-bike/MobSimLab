import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { buildMcpServer, type ToolDeps } from "../src/agents/mcp.tools";
import type { AgentPrincipal } from "../src/agents/oauth.service";
import { PluginCodeError } from "../src/plugins/code/code.service";

// Tool answers are JSON; the tests read into them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCENARIO = "33333333-3333-4333-8333-333333333333";

const entry = {
  id: "org.example.timetable-csv",
  name: "CSV timetables",
  version: "1.0.0",
  publisher: { name: "Example Transit Lab" },
  calculations: [
    {
      id: "route_summary",
      label: "Route summary",
      runtime: "component",
      component: "wasm/calculation.wasm",
      inputs: ["timetable"],
      outputs: ["table", "kpis"],
    },
  ],
};

async function connect(scopes: AgentPrincipal["scopes"], run: (...a: unknown[]) => Promise<unknown>) {
  const principal: AgentPrincipal = {
    userId: "u1",
    role: "user",
    connectionId: "c1",
    clientName: "Claude",
    clientId: "client",
    scopes,
  };
  const code = { enabled: vi.fn(async () => ({ entry, version: "1.0.0" })), run: vi.fn(run) };
  const plugins = {
    forProject: vi.fn(async () => [
      { id: "org.mobsimlab.noise", bundled: true, enabled: true, name: "Noise", publisher: { name: "x" } },
      { ...entry, bundled: false, enabled: true, entry },
    ]),
  };
  const timetable = { stops: [], routes: [], trips: [], frequency_patterns: [] };
  const deps = {
    scenarios: { get: vi.fn(async () => ({ doc: { stops: [], lines: [] } })) },
    analysis: { timetable: vi.fn(() => timetable) },
    access: {},
    instanceName: "Test",
    plugins: { plugins, code },
  } as unknown as ToolDeps;
  const server = buildMcpServer(principal, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as Loose;
    return { error: r.isError === true, body: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
  };
  return { call, code, timetable };
}

/** Agent tools for installed plugins' calculations (ADR-0036 §7, Phase 2). */
describe("plugin agent tools", () => {
  it("lists only installed plugins' component calculations", async () => {
    const { call } = await connect(["analysis:run"], async () => ({}));
    const r = await call("list_plugin_calculations", { project_id: PROJECT });
    expect(r.body.calculations).toEqual([
      expect.objectContaining({ plugin_id: entry.id, calculation: "route_summary", inputs: ["timetable"] }),
    ]);
  });

  it("runs a calculation on the scenario's timetable and marks the output as third-party data", async () => {
    const { call, code, timetable } = await connect(["analysis:run"], async () => ({
      output: { kpis: [{ id: "routes", value: 0 }] },
      logs: [["info", "ok"]],
    }));
    const r = await call("run_plugin_calculation", {
      project_id: PROJECT,
      plugin_id: entry.id,
      calculation: "route_summary",
      scenario_id: SCENARIO,
    });
    expect(r.body).toMatchObject({
      output: { kpis: [{ id: "routes" }] },
      note: expect.stringContaining("not instructions"),
    });
    const input = JSON.parse((code.run.mock.calls[0] as Loose)[5].input);
    expect(input.inputs).toEqual({ timetable });
  });

  it("needs analysis:run, refuses unknown calculations and reports crashes", async () => {
    const none = await connect(["project:read"], async () => ({}));
    expect((await none.call("list_plugin_calculations", { project_id: PROJECT })).error).toBe(true);
    const crash = await connect(["analysis:run"], async () => {
      throw new PluginCodeError("CSV timetables stopped: it crashed or ran over the limits (256 MB, 30 s)");
    });
    const args = { project_id: PROJECT, plugin_id: entry.id, scenario_id: SCENARIO };
    expect((await crash.call("run_plugin_calculation", { ...args, calculation: "nope" })).body).toContain(
      "has no calculation nope",
    );
    expect(
      (await crash.call("run_plugin_calculation", { ...args, calculation: "route_summary" })).body,
    ).toContain("ran over the limits");
  });
});

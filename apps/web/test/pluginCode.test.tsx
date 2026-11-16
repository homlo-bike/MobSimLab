import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginRuntime } from "../src/plugins/code/context";
import type { HostReply, HostRequest } from "../src/plugins/code/host.worker";
import { calculationInput, readOutput } from "../src/plugins/code/inputs";
import { PluginCalculations } from "../src/plugins/code/PluginCalculations";
import { answer, PluginFrame } from "../src/plugins/code/PluginFrame";
import { clearPluginCode, codeUrl, runPluginCode, type WorkerFactory } from "../src/plugins/code/runtime";
import { pagesOf } from "../src/plugins/code/wasmMemory";
import { componentCalculations, PLUGINS, type Plugin, setActivePlugins } from "../src/plugins/registry";

const P = "11111111-2222-3333-4444-555555555555";

/** The example plugin of examples/plugins/timetable-csv, as the API hands its registry entry to the app. */
const csvPlugin: Plugin = {
  ...PLUGINS[0]!,
  id: "org.example.timetable-csv",
  name: "CSV timetables",
  bundled: false,
  publisher: { name: "Example Transit Lab" },
  permissions: ["read:timetable", "write:scenario"],
  modes: [],
  tools: [],
  contexts: [],
  defaults: {},
  mapLayers: [],
  calculations: [
    {
      id: "route_summary",
      label: "Route summary",
      runtime: "component",
      component: "wasm/calculation.wasm",
      inputs: ["timetable", "fleet"],
      outputs: ["table", "kpis"],
      where: ["tables", "plugin-tab"],
    },
  ],
  tabs: [{ id: "csv-routes", label: "Routes", ui: "tab/index.html", calculations: ["route_summary"] }],
} as unknown as Plugin;

const data = { timetable: { routes: [{ id: "R1" }] }, streetLines: [{ id: "S1" }] };

/** A fake worker that answers the first request with `reply`, or never when `reply` is null. */
function fakeWorker(reply: ((req: HostRequest) => HostReply[]) | null) {
  const seen: HostRequest[] = [];
  let terminated = 0;
  const factory: WorkerFactory = () => {
    const w = {
      onmessage: null as ((e: MessageEvent<HostReply>) => void) | null,
      onerror: null,
      postMessage(req: HostRequest) {
        seen.push(req);
        if (reply)
          for (const m of reply(req))
            queueMicrotask(() => w.onmessage?.({ data: m } as MessageEvent<HostReply>));
      },
      terminate() {
        terminated++;
      },
    };
    return w as unknown as Worker;
  };
  return { factory, seen, terminated: () => terminated };
}

function mockCode() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/files.json"))
      return new Response(JSON.stringify(["glue.js", "glue.core.wasm", "glue.core2.wasm"]), { status: 200 });
    return new Response(new Uint8Array([0, 97, 115, 109]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  clearPluginCode();
  setPluginRuntime({
    projectId: P,
    limits: { memoryMb: 64, timeS: 30 },
    packages: { [csvPlugin.id]: "ab".repeat(32) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setActivePlugins(PLUGINS);
});

describe("plugin code in the browser (ADR-0036 Phase 2)", () => {
  it("fetches a component's core modules once and runs it in a worker with the Admins' memory limit", async () => {
    const fetchMock = mockCode();
    const w = fakeWorker(() => [
      { type: "progress", done: 0.5 },
      { type: "done", ok: true, value: '{"kpis":[]}', logs: [["info", "hello"]] },
    ]);
    const progress: number[] = [];
    const call = {
      projectId: P,
      pluginId: csvPlugin.id,
      component: "wasm/calculation.wasm",
      world: "calculation" as const,
      id: "route_summary",
      input: "{}",
      limits: { memoryMb: 64, timeS: 30 },
      onProgress: (d: number) => progress.push(d),
    };
    const r = await runPluginCode(call, w.factory);
    expect(r).toEqual({ ok: true, value: '{"kpis":[]}', logs: [["info", "hello"]] });
    expect(progress).toEqual([0.5]);
    expect(w.terminated()).toBe(1);
    const req = w.seen[0]!;
    expect(Object.keys(req.modules)).toEqual(["glue.core.wasm", "glue.core2.wasm"]);
    expect(req.maxPages).toBe(pagesOf(64));
    expect(req.glueUrl).toContain(
      `/api/projects/${P}/plugins/org.example.timetable-csv/code/wasm/calculation.wasm/glue.js`,
    );
    await runPluginCode(call, w.factory);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(codeUrl(P, "a b", "wasm/x.wasm", "files.json")).toBe(
      `/api/projects/${P}/plugins/a%20b/code/wasm/x.wasm/files.json`,
    );
  });

  it("stops a worker that runs past the time limit", async () => {
    mockCode();
    const w = fakeWorker(null);
    const r = await runPluginCode(
      {
        projectId: P,
        pluginId: csvPlugin.id,
        component: "wasm/calculation.wasm",
        world: "calculation",
        id: "route_summary",
        limits: { memoryMb: 64, timeS: 0.05 },
      },
      w.factory,
    );
    expect(r).toMatchObject({ ok: false, crashed: true });
    expect(r.ok ? "" : r.error).toContain("longer than");
    expect(w.terminated()).toBe(1);
  });

  it("gives a calculation only the data its inputs and permissions allow", () => {
    const calc = csvPlugin.calculations![0]!;
    expect(JSON.parse(calculationInput(csvPlugin, calc, data))).toEqual({
      inputs: { timetable: data.timetable },
      parameters: {},
      options: {},
    });
    const noPerm = { ...csvPlugin, permissions: [] } as Plugin;
    expect(JSON.parse(calculationInput(noPerm, calc, data)).inputs).toEqual({});
  });

  it("reads a calculation's output defensively", () => {
    expect(() => readOutput("nope")).toThrow("did not return JSON");
    expect(() => readOutput("[1]")).toThrow("returned no result");
    const o = readOutput(
      JSON.stringify({
        table: { columns: [{ id: "a", label: "A".repeat(500) }], rows: [[1, { x: 1 }], "bad"] },
        kpis: [{ id: "k", label: "K", value: { evil: true } }],
        findings: [{ level: "fatal", message: "m" }],
        html: "<script>",
      }),
    );
    expect(o.table!.columns[0]!.label).toHaveLength(100);
    expect(o.table!.rows).toEqual([[1, '{"x":1}']]);
    expect(o.kpis![0]!.value).toBeNull();
    expect(o.findings![0]!.level).toBe("warning");
    expect(o).not.toHaveProperty("html");
  });

  it("shows installed plugins' calculations in Tables and runs them", async () => {
    mockCode();
    setActivePlugins([...PLUGINS, csvPlugin]);
    expect(componentCalculations("tables").map((c) => c.id)).toEqual(["route_summary"]);
    const w = fakeWorker(() => [
      {
        type: "done",
        ok: true,
        value: JSON.stringify({
          table: { columns: [{ id: "route", label: "Route" }], rows: [["R1"]] },
          kpis: [{ id: "routes", label: "Routes", value: 1 }],
        }),
        logs: [],
      },
    ]);
    render(<PluginCalculations data={data} createWorker={w.factory} />);
    expect(screen.getByText("Plugin calculations")).toBeTruthy();
    expect(screen.getByText("CSV timetables · by Example Transit Lab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    await waitFor(() => expect(screen.getByText("R1")).toBeTruthy());
    expect(JSON.parse(w.seen[0]!.input!).inputs.timetable).toEqual(data.timetable);
  });

  it("shows the plugin's own message when its code fails", async () => {
    mockCode();
    setActivePlugins([...PLUGINS, csvPlugin]);
    const w = fakeWorker(() => [{ type: "done", ok: false, error: "no trips", crashed: false, logs: [] }]);
    render(<PluginCalculations data={data} createWorker={w.factory} />);
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("CSV timetables could not calculate: no trips"),
    );
  });

  it("answers a tab page only within the tab's calculations and the plugin's permissions", async () => {
    mockCode();
    const tab = csvPlugin.tabs![0]!;
    const env = { language: "en", theme: "light" as const };
    const ctx = (await answer(
      csvPlugin,
      tab,
      { mobsimlab: 1, id: 1, method: "context" },
      data,
      env,
    )) as Record<string, unknown>;
    expect(ctx).toMatchObject({ tab: "csv-routes", calculations: ["route_summary"], language: "en" });
    expect(
      await answer(
        csvPlugin,
        tab,
        { mobsimlab: 1, id: 2, method: "data", params: { kind: "timetable" } },
        data,
        env,
      ),
    ).toBe(data.timetable);
    await expect(
      answer(
        csvPlugin,
        tab,
        { mobsimlab: 1, id: 3, method: "data", params: { kind: "street_lines" } },
        data,
        env,
      ),
    ).rejects.toThrow("permissions");
    await expect(
      answer(
        csvPlugin,
        tab,
        { mobsimlab: 1, id: 4, method: "run", params: { calculation: "other" } },
        data,
        env,
      ),
    ).rejects.toThrow("may not run");
    await expect(answer(csvPlugin, tab, { mobsimlab: 1, id: 5, method: "fetch" }, data, env)).rejects.toThrow(
      "unknown method",
    );
    const w = fakeWorker(() => [{ type: "done", ok: true, value: '{"kpis":[]}', logs: [] }]);
    expect(
      await answer(
        csvPlugin,
        tab,
        { mobsimlab: 1, id: 6, method: "run", params: { calculation: "route_summary" } },
        data,
        env,
        w.factory,
      ),
    ).toEqual({ kpis: [] });
  });

  it("puts a tab page in a locked frame named after its plugin", () => {
    render(<PluginFrame plugin={csvPlugin} tab={csvPlugin.tabs![0]!} data={data} />);
    const frame = screen.getByTitle("Routes, a page of the CSV timetables plugin");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toBe(`/api/plugin-ui/${"ab".repeat(32)}/tab/index.html`);
    expect(screen.getByText(/comes from the CSV timetables plugin by Example Transit Lab/)).toBeTruthy();
  });
});

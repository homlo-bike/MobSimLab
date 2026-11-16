import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pack } from "../src/plugins/code/frame.mts";
import { capMemory, pagesOf, WasmModuleError } from "../src/plugins/code/wasm-memory.mts";
import { ToolInputError, ToolRunner } from "../src/tool-runner/runner";

const WASM = join(__dirname, "..", "..", "..", "examples", "plugins", "timetable-csv", "wasm");
const component = (world: string) => readFileSync(join(WASM, `${world}.wasm`));

const CSV =
  "trip_id,route,mode,stop_name,lat,lon,time\n" +
  "t1,A,bus,Harbour,47.1,8.1,07:00\nt1,A,bus,Market,47.11,8.11,07:06\n" +
  "t2,A,bus,Harbour,47.1,8.1,07:10\nt2,A,bus,Market,47.11,8.11,07:16\n";

/** Compile a component in the sandbox; returns the generated files. */
async function compile(runner: ToolRunner, world: string, bytes: Buffer = component(world)) {
  return runner.run(
    "plugin-compile",
    pack({ world, maxPages: pagesOf(256) }, { component: bytes }),
    async (r, scratch) => {
      const files = (r as { files: string[] }).files;
      return Object.fromEntries(
        await Promise.all(files.map(async (f) => [f, await scratch.read(f)] as const)),
      );
    },
    { wallMs: 60_000 },
  );
}

/** ADR-0036 Phase 2: plugin components compiled and run in the sandboxed tool-runner. */
describe("plugin code in the sandbox", () => {
  const runner = new ToolRunner();

  it("compiles, then runs a calculation, an importer and an exporter", async () => {
    const calc = await compile(runner, "calculation");
    const imp = await compile(runner, "importer");
    const exp = await compile(runner, "exporter");
    expect(Object.keys(calc)).toContain("glue.js");

    const imported = await runner.run(
      "plugin-run",
      pack(
        { world: "importer", id: "csv_import", maxPages: pagesOf(256) },
        { ...imp, "file:0:times.csv": Buffer.from(CSV) },
      ),
      async (r, s) => ({ r, out: JSON.parse((await s.read("result.json")).toString()) }),
    );
    expect(imported.out.summary).toMatchObject({ routes: 1, stops: 2, trips: 2 });

    const summary = await runner.run(
      "plugin-run",
      pack(
        { world: "calculation", id: "route_summary", maxPages: pagesOf(256) },
        { ...calc, input: Buffer.from(JSON.stringify({ inputs: { timetable: imported.out.timetable } })) },
      ),
      async (r, s) => ({ r, out: JSON.parse((await s.read("result.json")).toString()) }),
    );
    expect(summary.r).toMatchObject({ ok: true, logs: [["info", "summing up routes"]] });
    expect(summary.out.table.rows[0]).toEqual(["A", "bus", 2, 2, "07:00:00", "07:10:00", 10]);

    const exported = await runner.run(
      "plugin-run",
      pack(
        { world: "exporter", id: "csv_export", maxPages: pagesOf(256) },
        { ...exp, input: Buffer.from(JSON.stringify({ timetable: imported.out.timetable })) },
      ),
      async (r, s) => ({ r, csv: (await s.read("out-0.bin")).toString() }),
    );
    expect(exported.r).toMatchObject({ ok: true, files: ["timetable.csv"] });
    expect(exported.csv).toContain("t2,A,bus,Market,47.110000,8.110000,07:16:00");
  });

  it("returns the plugin's own error message", async () => {
    const calc = await compile(runner, "calculation");
    const r = await runner.run(
      "plugin-run",
      pack(
        { world: "calculation", id: "nope", maxPages: pagesOf(256) },
        { ...calc, input: Buffer.from("{}") },
      ),
      async (r) => r,
    );
    expect(r).toMatchObject({ ok: false, error: "unknown calculation nope" });
  });

  it("refuses a component of the wrong world, a core module and junk", async () => {
    await expect(compile(runner, "importer", component("calculation"))).rejects.toThrow(
      /must export only importFiles/,
    );
    await expect(
      compile(runner, "calculation", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    ).rejects.toBeInstanceOf(ToolInputError);
    await expect(compile(runner, "calculation", Buffer.from("hello"))).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe("capMemory", () => {
  /** A module with one memory: min 1 page, optional max, optional shared flag. */
  const mod = (flags: number, min: number, max?: number) =>
    Uint8Array.of(
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      5,
      max === undefined ? 3 : 4,
      1,
      flags,
      min,
      ...(max === undefined ? [] : [max]),
    );

  it("adds or lowers the maximum", () => {
    const capped = capMemory(mod(0, 1), 16);
    expect([...capped.slice(8)]).toEqual([5, 4, 1, 1, 1, 16]);
    expect(WebAssembly.validate(capped)).toBe(true);
    expect([...capMemory(mod(1, 1, 100), 16).slice(8)]).toEqual([5, 4, 1, 1, 1, 16]);
    expect([...capMemory(mod(1, 1, 8), 16).slice(8)]).toEqual([5, 4, 1, 1, 1, 8]);
    const m = new WebAssembly.Memory({ initial: 1, maximum: 16 });
    expect(() => m.grow(16)).toThrow();
  });

  it("refuses shared and 64-bit memory, a too large start and non-modules", () => {
    expect(() => capMemory(mod(3, 1, 2), 16)).toThrow(WasmModuleError);
    expect(() => capMemory(mod(4, 1), 16)).toThrow(WasmModuleError);
    expect(() => capMemory(mod(0, 40), 16)).toThrow(/MB of memory at start/);
    expect(() => capMemory(Uint8Array.of(1, 2, 3), 16)).toThrow(WasmModuleError);
  });
});

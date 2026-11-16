import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ToolError } from "../../tool-runner/errors.mts";
import type { ToolContext } from "../../tool-runner/tools.mts";
import { FrameError, unpack } from "./frame.mts";
import { capMemory } from "./wasm-memory.mts";
import { isWorld, WORLD_EXPORT } from "./worlds.mts";

/**
 * Tool `plugin-run` (sandboxed, see runner.ts): runs one call of an installed plugin's code (ADR-0036 §4).
 *
 * Input: a frame (frame.mts) with meta `{ world, id, maxPages, options? }` and parts `glue.js`, the core modules
 * (`glue.core.wasm`, …), and the call's data: `input` (JSON text) for a calculation or exporter, `file:<n>:<name>`
 * for each file given to an importer. Every memory is capped at `maxPages` before the modules are compiled; CPU,
 * time and heap are capped by the runner.
 *
 * Output: `{ ok: true, logs }` with the answer in the scratch folder (`result.json` for a calculation or importer,
 * `out-<n>.bin` and `{ files: [name, …] }` for an exporter), or `{ ok: false, error, logs }` when the plugin
 * returned an error for the person. A trap or a broken component is a ToolError.
 */

const MAX_LOG_LINES = 200;

/** Purpose: the `plugin-run` tool (see above). */
export async function runPlugin(input: Buffer, ctx: ToolContext) {
  let meta: { world?: unknown; id?: unknown; maxPages?: unknown; options?: unknown };
  let parts: Map<string, Buffer>;
  try {
    const f = unpack(input);
    meta = (f.meta ?? {}) as typeof meta;
    parts = f.parts;
  } catch (e) {
    if (e instanceof FrameError) throw new ToolError("the request to the sandbox is malformed");
    throw e;
  }
  const { world, id } = meta;
  const maxPages = Number(meta.maxPages);
  if (!isWorld(world) || typeof id !== "string" || !Number.isSafeInteger(maxPages))
    throw new ToolError("the request to the sandbox is malformed");
  const glue = parts.get("glue.js");
  if (!glue) throw new ToolError("the plugin code is missing");

  // The glue is an ES module; Node loads it from the scratch folder (the only place the tool may write).
  writeFileSync("glue.mjs", glue, { flag: "wx" });
  const mod = (await import(pathToFileURL(`${process.cwd()}/glue.mjs`).href)) as {
    instantiate: (
      getCoreModule: (name: string) => WebAssembly.Module,
      imports: Record<string, Record<string, (...a: never[]) => unknown>>,
    ) => Record<string, (...a: unknown[]) => unknown>;
  };
  const logs: [string, string][] = [];
  const host = {
    log: (level: string, message: string) => {
      if (logs.length < MAX_LOG_LINES) logs.push([String(level), String(message).slice(0, 500)]);
    },
    progress: () => {},
  };
  let instance: Record<string, (...a: unknown[]) => unknown>;
  try {
    instance = mod.instantiate(
      (name) => {
        const bytes = parts.get(name);
        if (!bytes) throw new ToolError(`the plugin code lacks ${name.slice(0, 80)}`);
        return new WebAssembly.Module(capMemory(bytes, maxPages));
      },
      { "mobsimlab:plugin/host": host },
    );
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(`the plugin code could not start: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
  }
  const fn = instance[WORLD_EXPORT[world]];
  if (typeof fn !== "function") throw new ToolError("the plugin code does not export its function");

  let value: unknown;
  try {
    if (world === "importer") {
      const files = [...parts.entries()]
        .filter(([k]) => k.startsWith("file:"))
        .map(([k, data]) => ({ name: k.split(":").slice(2).join(":"), data: new Uint8Array(data) }));
      value = fn(id, files, JSON.stringify(meta.options ?? {}));
    } else value = fn(id, (parts.get("input") ?? Buffer.from("{}")).toString("utf8"));
  } catch (e) {
    // With noComponentErrorWrapping the plugin's `err(message)` arrives as the thrown string.
    if (typeof e === "string") return { ok: false, error: e.slice(0, 1000), logs };
    throw new ToolError(`the plugin code stopped: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
  }
  if (world === "exporter") {
    if (!Array.isArray(value)) throw new ToolError("the exporter returned no files");
    const names: string[] = [];
    value.forEach((f: { name?: unknown; data?: unknown }, i) => {
      if (typeof f.name !== "string" || !(f.data instanceof Uint8Array))
        throw new ToolError("the exporter returned a malformed file");
      ctx.write(`out-${i}.bin`, f.data);
      names.push(f.name.slice(0, 200));
    });
    return { ok: true, files: names, logs };
  }
  if (typeof value !== "string") throw new ToolError("the plugin returned no text");
  ctx.write("result.json", value);
  return { ok: true, logs };
}

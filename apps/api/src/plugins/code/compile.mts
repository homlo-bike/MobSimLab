import { ToolError } from "../../tool-runner/errors.mts";
import type { ToolContext } from "../../tool-runner/tools.mts";
import { FrameError, unpack } from "./frame.mts";
import { capMemory, WasmModuleError } from "./wasm-memory.mts";
import { ALLOWED_IMPORTS, FORBIDDEN_IN_GLUE, isWorld, PLUGIN_API_VERSION, WORLD_EXPORT } from "./worlds.mts";

/**
 * Tool `plugin-compile` (sandboxed, see runner.ts): turns an uploaded plugin component (ADR-0036 §4) into what the
 * hosts run: core WebAssembly modules and JavaScript glue that lifts and lowers values, written by jco's
 * component bindgen (itself WebAssembly, from @bytecodealliance/jco-transpile).
 *
 * Input: a frame (frame.mts) with meta `{ world, maxPages }` and part `component`. Checks that the component
 * imports nothing but `mobsimlab:plugin/host@1.x`, exports the world's function, uses no shared or 64-bit memory
 * and starts within the memory limit, and that the glue holds nothing but glue. Output: `{ files, imports,
 * exports }`, the files in the scratch folder (`glue.js`, `glue.core.wasm`, …). The API checks it all again.
 */

type Generate = (
  component: Uint8Array,
  opts: Record<string, unknown>,
) => { files: [string, Uint8Array][]; imports: string[]; exports: [string, string][] };

let bindgen: Promise<Generate> | null = null;

/** Purpose: load jco's bindgen without the rest of jco-transpile (whose minifier is a native add-on). */
function loadBindgen(): Promise<Generate> {
  bindgen ??= (async () => {
    const main = import.meta.resolve("@bytecodealliance/jco-transpile");
    const mod = (await import(new URL("../vendor/js-component-bindgen-component.js", main).href)) as {
      $init: Promise<void>;
      generate: Generate;
    };
    await mod.$init;
    return mod.generate;
  })();
  return bindgen;
}

/** Options for `generate`, as jco-transpile's `transpileBytes` builds them for `instantiation: "sync"`. */
const OPTIONS = {
  name: "glue",
  map: [],
  instantiation: { tag: "sync" },
  validLiftingOptimization: false,
  tracing: false,
  noComponentErrorWrapping: true,
  noNodejsCompat: true,
  noTypescript: true,
  tlaCompat: false,
  base64Cutoff: 0,
  noNamespacedExports: false,
  multiMemory: false,
  bindgenEnableWasmExnref: false,
  strict: true,
  perfStringsSkipCopyUtf8Validation: false,
  perfStringsSkipCopyUtf16Validation: false,
  flagsAsBigint: false,
  variantsInlineCases: false,
  useNamespaceObjects: false,
  enumValuesScreamingSnakeCase: false,
  idlImports: false,
  asmjs: false,
  emitConditionalSuspendingWasm: true,
};

/** Purpose: check the glue jco wrote; throws ToolError naming what is wrong. */
export function checkGlue(js: string): void {
  for (const [re, what] of FORBIDDEN_IN_GLUE)
    if (re.test(js)) throw new ToolError(`the component's generated code contains ${what}`);
  const versions = new Set([...js.matchAll(/mobsimlab:plugin\/host@([0-9.]+)/g)].map((m) => m[1]));
  for (const v of versions)
    if (v!.split(".")[0] !== PLUGIN_API_VERSION.split(".")[0])
      throw new ToolError(
        `the component was built for plugin API ${v}; this MobSimLab runs ${PLUGIN_API_VERSION}`,
      );
}

/** Purpose: the `plugin-compile` tool (see above). */
export async function compilePlugin(input: Buffer, ctx: ToolContext) {
  let meta: { world?: unknown; maxPages?: unknown };
  let component: Buffer | undefined;
  try {
    const f = unpack(input);
    meta = (f.meta ?? {}) as typeof meta;
    component = f.parts.get("component");
  } catch (e) {
    if (e instanceof FrameError) throw new ToolError("the request to the sandbox is malformed");
    throw e;
  }
  const world = meta.world;
  if (!isWorld(world)) throw new ToolError("unknown world");
  const maxPages = Number(meta.maxPages);
  if (!component || !Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new ToolError("nothing to compile");

  const generate = await loadBindgen();
  let out: ReturnType<Generate>;
  try {
    out = generate(component, OPTIONS);
  } catch (e) {
    throw new ToolError(
      `not a WebAssembly component this MobSimLab can run: ${String(e instanceof Error ? e.message : e)
        .split("\n")
        .filter((l) => l.trim())
        .slice(0, 3)
        .join(" ")
        .slice(0, 300)}`,
    );
  }
  for (const imp of out.imports)
    if (!ALLOWED_IMPORTS.has(imp))
      throw new ToolError(
        `the component imports ${imp.slice(0, 100)}; plugin code may only import mobsimlab:plugin/host (no WASI: no files, network, clock or environment)`,
      );
  const wanted = WORLD_EXPORT[world];
  const exported = out.exports.map(([name]) => name);
  if (!exported.includes(wanted) || exported.length !== 1)
    throw new ToolError(
      `a ${world} component must export only ${wanted} (mobsimlab:plugin/${world}); it exports ${exported.join(", ").slice(0, 200) || "nothing"}`,
    );
  const files: string[] = [];
  for (const [name, data] of out.files) {
    if (name.endsWith(".wasm")) {
      try {
        capMemory(data, maxPages);
      } catch (e) {
        if (e instanceof WasmModuleError) throw new ToolError(e.message);
        throw e;
      }
    } else if (name === "glue.js") checkGlue(new TextDecoder().decode(data));
    else throw new ToolError(`unexpected generated file ${name.slice(0, 80)}`);
    ctx.write(name, data);
    files.push(name);
  }
  if (!files.includes("glue.js")) throw new ToolError("the component produced no glue code");
  return { files, imports: out.imports, exports: exported };
}

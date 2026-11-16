import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Logger } from "@nestjs/common";
import { ToolError } from "../../tool-runner/errors.mts";
import { ToolFailedError, ToolInputError, type ToolRunner } from "../../tool-runner/runner";
import type { CodeItem, PluginEntry } from "../validate";
import { checkGlue } from "./compile.mts";
import { pack } from "./frame.mts";
import { capMemory, pagesOf, WasmModuleError } from "./wasm-memory.mts";
import type { World } from "./worlds.mts";

/**
 * What an installed plugin's code and tab pages become when it is installed (ADR-0036 Phase 2): for each
 * component the JavaScript glue and core modules the hosts run (`code/<component>/…`), and the files of each
 * tab page's folder (`ui/<path>`). Compiling runs in the sandboxed tool-runner; its output is checked again here.
 */

/** One file to store in plugin.file. */
export interface StoredFile {
  path: string;
  mediaType: string;
  data: Buffer;
  sha256: string;
}

/** Media types of the files a tab page's folder may hold. */
export const UI_MEDIA_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Purpose: the components of an entry with the world each one targets. Problems for a component used twice. */
export function components(entry: PluginEntry): { components: Map<string, World>; problems: string[] } {
  const out = new Map<string, World>();
  const problems: string[] = [];
  const add = (world: World, items: unknown[] | undefined) => {
    for (const x of (items ?? []) as CodeItem[]) {
      if (x.runtime !== "component" || !x.component) continue;
      const had = out.get(x.component);
      if (had && had !== world)
        problems.push(`${x.component} is used as a ${had} and as a ${world}; a component targets one world`);
      out.set(x.component, world);
    }
  };
  add("calculation", entry.calculations);
  add("importer", entry.importers);
  add("exporter", entry.exporters);
  return { components: out, problems };
}

/**
 * Purpose: compile an entry's components in the sandbox and collect its tab pages' files.
 * Inputs: the package files, the checked entry, the tool-runner and the memory limit (MB).
 * Output: the files to store, or the problems for the install screen.
 */
export async function prepareCode(
  files: ReadonlyMap<string, Buffer>,
  entry: PluginEntry,
  tools: ToolRunner,
  memoryMb: number,
  logger: Logger = new Logger("PluginCode"),
): Promise<{ files: StoredFile[]; problems: string[] }> {
  const stored: StoredFile[] = [];
  const { components: comps, problems } = components(entry);
  for (const [path, world] of comps) {
    const bytes = files.get(path);
    if (!bytes) {
      problems.push(`${path} does not exist`);
      continue;
    }
    try {
      const out = await tools.run(
        "plugin-compile",
        pack({ world, maxPages: pagesOf(memoryMb) }, { component: bytes }),
        async (result, scratch) => {
          const names = (result as { files?: unknown }).files;
          if (!Array.isArray(names) || names.length > 16) throw new ToolFailedError("bad compile result");
          return Promise.all(
            names.map(async (n) => {
              if (typeof n !== "string") throw new ToolFailedError("bad compile result");
              return [n, await scratch.read(n)] as const;
            }),
          );
        },
        {
          inputBytes: 16 * 1024 * 1024,
          wallMs: 120_000,
          cpuSeconds: 120,
          memoryMb: 512,
          fileBytes: 32 * 1024 * 1024,
        },
      );
      // Nothing from the sandbox is trusted: check the glue and every module again.
      for (const [name, data] of out) {
        if (name === "glue.js") checkGlue(data.toString("utf8"));
        else if (/^glue\.core\d*\.wasm$/.test(name)) capMemory(data, pagesOf(memoryMb));
        else throw new ToolFailedError(`unexpected file ${name}`);
        stored.push({
          path: `code/${path}/${name}`,
          mediaType: name.endsWith(".js") ? "text/javascript" : "application/wasm",
          data,
          sha256: sha256(data),
        });
      }
    } catch (e) {
      if (e instanceof ToolInputError || e instanceof WasmModuleError || e instanceof ToolError)
        problems.push(`${path}: ${e.message}`);
      else {
        logger.warn(`compiling ${entry.id} ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
        problems.push(
          `${path}: the component could not be checked (it may be too large or too slow to compile)`,
        );
      }
    }
  }
  for (const tab of entry.tabs ?? []) {
    if (!tab.ui) continue;
    const dir = posix.dirname(tab.ui);
    if (dir === ".") {
      problems.push(`tab ${tab.id}: put its page in a folder of its own, such as tab/index.html`);
      continue;
    }
    for (const [p, data] of files) {
      if (!p.startsWith(`${dir}/`) || stored.some((s) => s.path === `ui/${p}`)) continue;
      const type = UI_MEDIA_TYPES[posix.extname(p).toLowerCase()];
      if (!type) {
        problems.push(
          `${p}: a tab page's folder may hold only ${Object.keys(UI_MEDIA_TYPES).join(" ")} files`,
        );
        continue;
      }
      stored.push({ path: `ui/${p}`, mediaType: type, data, sha256: sha256(data) });
    }
  }
  return { files: stored, problems };
}

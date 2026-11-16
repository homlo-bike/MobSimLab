import type { HostReply, HostRequest } from "./host.worker";
import { pagesOf } from "./wasmMemory";

/** Limits for plugin code, set by Admins (`GET /api/projects/:id/plugins`). */
export interface PluginLimits {
  memoryMb: number;
  timeS: number;
}

export const DEFAULT_LIMITS: PluginLimits = { memoryMb: 256, timeS: 30 };

/** What one call of plugin code returned. */
export type PluginCallResult =
  | { ok: true; value: string | { name: string; data: Uint8Array }[]; logs: [string, string][] }
  | { ok: false; error: string; crashed: boolean; logs: [string, string][] };

/** One call: which plugin, component and function, and its data. */
export interface PluginCall {
  projectId: string;
  pluginId: string;
  /** The component's path in the package, such as `wasm/calculation.wasm`. */
  component: string;
  world: HostRequest["world"];
  id: string;
  input?: string;
  files?: { name: string; data: Uint8Array }[];
  options?: unknown;
  limits: PluginLimits;
  onProgress?: (done: number) => void;
}

/** Starts the worker; tests replace it. */
export type WorkerFactory = () => Worker;

const defaultWorker: WorkerFactory = () =>
  new Worker(new URL("./host.worker.ts", import.meta.url), { type: "module", name: "mobsimlab-plugin" });

const modulesCache = new Map<string, Promise<Record<string, ArrayBuffer>>>();

/** Purpose: the URL of a compiled file of a component. */
export function codeUrl(projectId: string, pluginId: string, component: string, file: string): string {
  const parts = [...component.split("/"), file].map(encodeURIComponent).join("/");
  return `/api/projects/${projectId}/plugins/${encodeURIComponent(pluginId)}/code/${parts}`;
}

/** Purpose: the core modules of a component, fetched once per page. */
function modules(c: PluginCall): Promise<Record<string, ArrayBuffer>> {
  const key = `${c.projectId}|${c.pluginId}|${c.component}`;
  let hit = modulesCache.get(key);
  if (!hit) {
    hit = (async () => {
      const list = await fetch(codeUrl(c.projectId, c.pluginId, c.component, "files.json"), {
        credentials: "same-origin",
      });
      if (!list.ok) throw new Error(`the plugin's code is not available (${list.status})`);
      const names = ((await list.json()) as string[]).filter((n) => n.endsWith(".wasm"));
      const out: Record<string, ArrayBuffer> = {};
      for (const n of names) {
        const r = await fetch(codeUrl(c.projectId, c.pluginId, c.component, n), { credentials: "same-origin" });
        if (!r.ok) throw new Error(`the plugin's code is not available (${r.status})`);
        out[n] = await r.arrayBuffer();
      }
      return out;
    })();
    hit.catch(() => modulesCache.delete(key));
    modulesCache.set(key, hit);
  }
  return hit;
}

/** Purpose: forget fetched code, for example after the project pins another version. */
export function clearPluginCode(): void {
  modulesCache.clear();
}

/**
 * Purpose: run one call of an installed plugin's code in a fresh Web Worker, with the instance's memory limit
 * in the modules and its time limit on the worker. Output: what the plugin returned or its message; a crash or a
 * run over the time limit comes back as `{ ok: false, crashed: true }`.
 */
export async function runPluginCode(c: PluginCall, createWorker: WorkerFactory = defaultWorker): Promise<PluginCallResult> {
  const mods = await modules(c);
  const worker = createWorker();
  return new Promise<PluginCallResult>((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({
        ok: false,
        crashed: true,
        error: `the plugin ran longer than the ${c.limits.timeS} s allowed and was stopped`,
        logs: [],
      });
    }, c.limits.timeS * 1000);
    worker.onmessage = (e: MessageEvent<HostReply>) => {
      const m = e.data;
      if (m.type === "progress") {
        c.onProgress?.(m.done);
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      resolve(m.ok ? { ok: true, value: m.value, logs: m.logs } : { ok: false, error: m.error, crashed: m.crashed, logs: m.logs });
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, crashed: true, error: `the plugin code stopped: ${e.message || "out of memory?"}`, logs: [] });
    };
    // Copies, so the cache keeps its bytes.
    const copies = Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, v.slice(0)]));
    const req: HostRequest = {
      glueUrl: new URL(codeUrl(c.projectId, c.pluginId, c.component, "glue.js"), window.location.href).href,
      modules: copies,
      world: c.world,
      id: c.id,
      maxPages: pagesOf(c.limits.memoryMb),
      ...(c.input !== undefined ? { input: c.input } : {}),
      ...(c.files ? { files: c.files } : {}),
      ...(c.options !== undefined ? { options: c.options } : {}),
    };
    worker.postMessage(req, Object.values(copies));
  });
}

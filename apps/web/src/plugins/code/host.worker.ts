/// <reference lib="webworker" />
import { capMemory } from "./wasmMemory";

/**
 * Browser host for plugin code (ADR-0036 §4, Phase 2): one Web Worker per call. It takes the compiled
 * component (jco glue and core modules, served by the API to project members), removes every way out of the
 * worker (network, storage, other workers, messages) before any plugin code is loaded, caps the WebAssembly
 * memory, runs the one exported function, and posts the answer back. The page stops the worker when the call runs
 * over the time limit. The component itself imports only `mobsimlab:plugin/host`: log and progress.
 */

export interface HostRequest {
  /** URL of the glue module (same origin). */
  glueUrl: string;
  /** Core modules by name, as the glue asks for them. */
  modules: Record<string, ArrayBuffer>;
  world: "calculation" | "importer" | "exporter";
  /** Calculation, importer or exporter id. */
  id: string;
  input?: string;
  files?: { name: string; data: Uint8Array }[];
  options?: unknown;
  maxPages: number;
}

export type HostReply =
  | { type: "progress"; done: number }
  | {
      type: "done";
      ok: true;
      value: string | { name: string; data: Uint8Array }[];
      logs: [string, string][];
    }
  | { type: "done"; ok: false; error: string; crashed: boolean; logs: [string, string][] };

const EXPORTS = { calculation: "calculate", importer: "importFiles", exporter: "exportFiles" } as const;

const scope = self as unknown as DedicatedWorkerGlobalScope & Record<string, unknown>;
const post = scope.postMessage.bind(scope);

/** Purpose: take away everything that reaches outside the worker before plugin code loads. */
function lockDown(): void {
  for (const name of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "WebTransport",
    "EventSource",
    "importScripts",
    "indexedDB",
    "caches",
    "BroadcastChannel",
    "Worker",
    "SharedWorker",
    "postMessage",
    "close",
  ]) {
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false });
    } catch {
      // A property the browser does not let us redefine is deleted instead where it can be.
      delete scope[name];
    }
  }
  scope.onmessage = null;
}

scope.onmessage = async (e: MessageEvent<HostRequest>) => {
  const r = e.data;
  const logs: [string, string][] = [];
  lockDown();
  let instance: Record<string, (...a: unknown[]) => unknown>;
  try {
    const mod = (await import(/* @vite-ignore */ r.glueUrl)) as {
      instantiate: (
        getCoreModule: (name: string) => WebAssembly.Module,
        imports: Record<string, Record<string, (...a: never[]) => unknown>>,
      ) => Record<string, (...a: unknown[]) => unknown>;
    };
    instance = mod.instantiate(
      (name) => {
        const bytes = r.modules[name];
        if (!bytes) throw new Error(`the plugin code lacks ${name}`);
        return new WebAssembly.Module(capMemory(new Uint8Array(bytes), r.maxPages));
      },
      {
        "mobsimlab:plugin/host": {
          log: (level: string, message: string) => {
            if (logs.length < 200) logs.push([String(level), String(message).slice(0, 500)]);
          },
          progress: (done: number) => post({ type: "progress", done: Math.max(0, Math.min(1, done)) } satisfies HostReply),
        },
      },
    );
  } catch (err) {
    post({ type: "done", ok: false, crashed: true, error: `the plugin code could not start: ${message(err)}`, logs });
    return;
  }
  try {
    const fn = instance[EXPORTS[r.world]]!;
    const value =
      r.world === "importer"
        ? fn(r.id, r.files ?? [], JSON.stringify(r.options ?? {}))
        : fn(r.id, r.input ?? "{}");
    post({ type: "done", ok: true, value: value as string, logs } satisfies HostReply);
  } catch (err) {
    // The plugin's `err(message)` arrives as a thrown string; anything else is a trap.
    if (typeof err === "string") post({ type: "done", ok: false, crashed: false, error: err.slice(0, 1000), logs });
    else post({ type: "done", ok: false, crashed: true, error: `the plugin code stopped: ${message(err)}`, logs });
  }
};

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

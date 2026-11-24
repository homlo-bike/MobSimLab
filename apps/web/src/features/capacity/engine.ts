import { type EngineMsg, errorWithMsg } from "../../i18n/engine";
import type { CapacityEngine, EngineLoader } from "./types";

/**
 * Purpose: load a network and its lines into a capacity run web worker.
 * Inputs: the drawn railway's topology and its lines (JSON texts).
 * Output: an engine whose calls run in the worker; `dispose` ends the worker.
 * Dependencies: apps/web/src/wasm/rail-sim, built by tools/wasm/build-rail-sim.sh.
 */
export const loadWorkerEngine: EngineLoader = async (src) => {
  const worker = new Worker(new URL("./capacity.worker.ts", import.meta.url), { type: "module" });
  let next = 0;
  const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  worker.onmessage = (
    e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string; msg?: EngineMsg }>,
  ) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.ok(e.data.value);
    else w.fail(errorWithMsg(e.data.error ?? "the capacity run failed", e.data.msg));
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.fail(new Error(e.message || "the capacity run stopped"));
    waiting.clear();
  };
  const call = <T>(op: string, args: Record<string, unknown> = {}) =>
    new Promise<T>((ok, fail) => {
      const id = next++;
      waiting.set(id, { ok: ok as (v: unknown) => void, fail });
      worker.postMessage({ id, op, ...args });
    });
  try {
    await call("load", { network: src.topology, lines: src.lines });
  } catch (e) {
    worker.terminate();
    throw e;
  }
  const engine: CapacityEngine = {
    lines: () => call("lines"),
    notes: () => call("notes"),
    run: (params) => call("run", { params }),
    sweepHeadways: (params, line, works) => call("sweepHeadways", { params, line, works }),
    sweepPoint: (params, line, headway) => call("sweepPoint", { params, line, headway }),
    replay: (params, frame) => call("replay", { params, frame }),
    dispose: () => worker.terminate(),
  };
  return engine;
};

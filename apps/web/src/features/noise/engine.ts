import { type EngineMsg, errorWithMsg } from "../../i18n/engine";
import type { Indicator, NoiseEngine, NoiseEngineLoader, NoiseInput, NoiseView } from "./types";

let wasmModule: Promise<typeof import("../../wasm/noise/noise_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../../wasm/noise/noise_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: create the noise plugin's engine (ADR-0038, calculation `noise_estimate`).
 * Dependencies: apps/web/src/wasm/noise, built by tools/wasm/build-noise.sh.
 */
export const loadWasmNoise: NoiseEngineLoader = async () => {
  const wasm = await initWasm();
  const n = new wasm.NoiseEstimator();
  return {
    estimate: (input) => JSON.parse(n.estimate(JSON.stringify(input))),
    image: (indicator, fromDb, alpha) => n.image(indicator, fromDb, alpha),
    levels: (indicator) => n.levels(indicator),
    dispose: () => n.free(),
  } satisfies NoiseEngine;
};

/** The pictures of one estimate, RGBA pixels north row first, coloured from the given level up. */
export type NoiseImages = Record<Indicator, Uint8Array>;

/** Grid levels of one estimate per indicator, dB, rows from the south (NaN where not computed). */
export type NoiseLevels = Record<Indicator, Float32Array>;

/** What a noise run gives back: the estimate, and its pictures and levels when it has a grid. */
export interface NoiseRun {
  view: NoiseView;
  images: NoiseImages | null;
  levels?: NoiseLevels | null;
}

/**
 * Runs one estimate and draws its pictures from `fromDb` up. Rejects with the signal's reason when the
 * signal aborts, without waiting for the engine.
 */
export type NoiseRunner = (
  input: NoiseInput,
  fromDb: Record<Indicator, number>,
  signal?: AbortSignal,
) => Promise<NoiseRun>;

/** Purpose: the estimate and both pictures from an engine. */
function runOn(engine: NoiseEngine, input: NoiseInput, fromDb: Record<Indicator, number>): NoiseRun {
  const view = engine.estimate(input);
  const images = view.image
    ? { lden: engine.image("lden", fromDb.lden, 255), lnight: engine.image("lnight", fromDb.lnight, 255) }
    : null;
  const levels =
    view.image && engine.levels ? { lden: engine.levels("lden"), lnight: engine.levels("lnight") } : null;
  return { view, images, levels };
}

/**
 * Purpose: a runner that uses an engine on the page itself (tests, and browsers without module workers).
 * The engine holds the page while it computes, so a cancel takes effect once it is done.
 */
export function engineRunner(load: NoiseEngineLoader): NoiseRunner {
  return async (input, fromDb, signal) => {
    const engine = await load();
    try {
      signal?.throwIfAborted();
      const run = runOn(engine, input, fromDb);
      signal?.throwIfAborted();
      return run;
    } finally {
      engine.dispose();
    }
  };
}

/**
 * Purpose: run the estimate in a Web Worker (noise.worker.ts), so the page stays responsive and Cancel
 * stops the computation at once by ending the worker.
 * Side effects: starts a worker per run and ends it when the run finishes or is cancelled.
 */
export const workerRunner: NoiseRunner = (input, fromDb, signal) => {
  if (typeof Worker === "undefined") return engineRunner(loadWasmNoise)(input, fromDb, signal);
  return new Promise<NoiseRun>((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(new URL("./noise.worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
    const done = () => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<NoiseRun | { error: string; msg?: EngineMsg }>) => {
      done();
      if ("error" in e.data) reject(errorWithMsg(e.data.error, e.data.msg));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "the noise engine stopped"));
    };
    worker.postMessage({ input, fromDb });
  });
};

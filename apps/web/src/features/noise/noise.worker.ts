/// <reference lib="webworker" />
/**
 * The noise plugin's engine in a Web Worker: one estimate per message, answered with the estimate and
 * both pictures (see `workerRunner` in engine.ts). The page ends the worker to cancel.
 */
import init, { NoiseEstimator } from "../../wasm/noise/noise_wasm.js";
import type { Indicator, NoiseInput, NoiseView } from "./types";

self.onmessage = async (e: MessageEvent<{ input: NoiseInput; fromDb: Record<Indicator, number> }>) => {
  try {
    await init();
    const n = new NoiseEstimator();
    try {
      const view = JSON.parse(n.estimate(JSON.stringify(e.data.input))) as NoiseView;
      const images = view.image
        ? {
            lden: n.image("lden", e.data.fromDb.lden, 255),
            lnight: n.image("lnight", e.data.fromDb.lnight, 255),
          }
        : null;
      const transfer = images ? [images.lden.buffer, images.lnight.buffer] : [];
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ view, images }, transfer);
    } finally {
      n.free();
    }
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};

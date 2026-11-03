import type { NoiseEngine, NoiseEngineLoader } from "./types";

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
    dispose: () => n.free(),
  } satisfies NoiseEngine;
};

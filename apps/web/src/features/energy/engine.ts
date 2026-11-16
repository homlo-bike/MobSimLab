import type { EnergyEngine, EnergyEngineLoader } from "./types";

let wasmModule: Promise<typeof import("../../wasm/energy/energy_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../../wasm/energy/energy_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: create the energy plugin's engine (calculation `energy_emissions`).
 * Output: an engine that estimates every line at once (stateless).
 * Dependencies: apps/web/src/wasm/energy, built by tools/wasm/build-energy.sh.
 */
export const loadWasmEnergy: EnergyEngineLoader = async () => {
  const wasm = await initWasm();
  return {
    estimate: (lines) => JSON.parse(wasm.estimate_energy(JSON.stringify({ lines }))),
  } satisfies EnergyEngine;
};

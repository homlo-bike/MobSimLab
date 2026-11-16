import type { DepotEngine, DepotEngineLoader } from "./types";

let wasmModule: Promise<typeof import("../../wasm/depot-layout/depot_layout_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../../wasm/depot-layout/depot_layout_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: load the depot layout WebAssembly module (auto layout, checks, sizing, swept envelopes).
 * Dependencies: apps/web/src/wasm/depot-layout, built by tools/wasm/build-depot-layout.sh.
 */
export const loadDepotEngine: DepotEngineLoader = async () => {
  const wasm = await initWasm();
  return {
    generate: (input) => JSON.parse(wasm.generate_layout(JSON.stringify(input))),
    analyse: (input) => JSON.parse(wasm.analyse_depot(JSON.stringify(input))),
    size: (input) => JSON.parse(wasm.size_depot(JSON.stringify(input))),
    envelope: (input, lane) => JSON.parse(wasm.lane_envelope(JSON.stringify(input), lane)),
  } satisfies DepotEngine;
};

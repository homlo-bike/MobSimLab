import type { GtfsEngine, GtfsEngineLoader } from "./types";

let wasmModule: Promise<typeof import("../../wasm/gtfs/gtfs_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../../wasm/gtfs/gtfs_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: create the GTFS plugin's engine (importer `gtfs_import`, exporter `gtfs_export`).
 * Output: an engine that converts between GTFS text files and the published timetable (stateless).
 * Dependencies: apps/web/src/wasm/gtfs, built by tools/wasm/build-gtfs.sh.
 */
export const loadWasmGtfs: GtfsEngineLoader = async () => {
  const wasm = await initWasm();
  return {
    import: (files, options) => JSON.parse(wasm.import_gtfs(JSON.stringify({ files, ...options }))),
    export: (timetable, options) => JSON.parse(wasm.export_gtfs(JSON.stringify({ timetable, ...options }))),
  } satisfies GtfsEngine;
};

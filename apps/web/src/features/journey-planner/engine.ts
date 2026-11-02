import type { PlannerEngine, PlannerLoader, NetworkSummary, Plan, ProfilePoint } from "./types";

let wasmModule: Promise<typeof import("../../wasm/journey-planner/journey_planner_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../../wasm/journey-planner/journey_planner_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: compile a published timetable with the journey-planner WebAssembly module.
 * Dependencies: apps/web/src/wasm/journey-planner, built by tools/wasm/build-journey-planner.sh.
 */
export const loadWasmPlanner: PlannerLoader = async (timetable, settings) => {
  const wasm = await initWasm();
  const p = new wasm.JourneyPlanner(JSON.stringify(timetable), JSON.stringify(settings));
  const engine: PlannerEngine = {
    summary: () => JSON.parse(p.summary()) as NetworkSummary,
    plan: (q) => JSON.parse(p.plan(JSON.stringify(q))) as Plan,
    profile: (q) => JSON.parse(p.profile(JSON.stringify(q))) as ProfilePoint[],
    dispose: () => p.free(),
  };
  return engine;
};

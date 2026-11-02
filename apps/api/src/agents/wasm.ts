import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * The Rust kernels the agent tools use, compiled to WebAssembly for Node by `tools/wasm/build-api.sh`
 * (street routing, walk analysis, journey planner). The same code runs in the browser and the worker.
 */

/** Walk network analysis (crates/street-routing `walk`). Every method takes and returns JSON. */
export interface WalkAnalysisWasm {
  add_osm(xml: string): void;
  build(): void;
  ready(): boolean;
  coverage(requestJson: string): string;
  catchment(stopsJson: string, maxMinutes: number, settingsJson: string): string;
  spacing(requestJson: string): string;
  suggest_stops(requestJson: string): string;
  free(): void;
}

/** Street line router (crates/street-routing `line`), as the street line editor uses it. */
export interface StreetLineEditorWasm {
  add_osm(xml: string): void;
  rebuild(): string;
  insert_point(seq: number, lon: number, lat: number, kind: string): string;
  set_name(id: number, name: string): string;
  set_settings(profileJson: string, rulesJson: string): string;
  view(): string;
  free(): void;
}

interface StreetRoutingModule {
  WalkAnalysis: new () => WalkAnalysisWasm;
  StreetLineEditor: (new () => StreetLineEditorWasm) & {
    default_profile(mode: string): string;
    default_rules(): string;
  };
}

/** Journey planner (crates/journey-planner) over a published timetable. */
export interface JourneyPlannerWasm {
  plan(queryJson: string): string;
  summary(): string;
  free(): void;
}

interface JourneyPlannerModule {
  JourneyPlanner: (new (timetableJson: string, settingsJson: string) => JourneyPlannerWasm) & {
    default_settings(): string;
  };
}

/** The modules were not built. */
export class WasmMissingError extends Error {}

/** Purpose: the folder with the built modules: `MOBSIMLAB_WASM_DIR`, else `apps/api/wasm`. */
export function wasmDir(): string {
  if (process.env.MOBSIMLAB_WASM_DIR) return process.env.MOBSIMLAB_WASM_DIR;
  // src/agents/wasm.ts and dist/agents/wasm.js are both two levels below apps/api.
  return join(__dirname, "..", "..", "wasm");
}

const cache = new Map<string, unknown>();

function load<T>(name: string, file: string): T {
  const hit = cache.get(name);
  if (hit) return hit as T;
  const path = join(wasmDir(), name, file);
  if (!existsSync(path)) {
    throw new WasmMissingError(
      `The ${name} WebAssembly module is missing (${path}). Build it with tools/wasm/build-api.sh.`,
    );
  }
  const mod = createRequire(__filename)(path) as T;
  cache.set(name, mod);
  return mod;
}

/** Purpose: load the street routing and walk analysis module (once). Throws WasmMissingError. */
export function streetRouting(): StreetRoutingModule {
  return load<StreetRoutingModule>("street-routing", "street_routing_wasm.js");
}

/** Purpose: load the journey planner module (once). Throws WasmMissingError. */
export function journeyPlanner(): JourneyPlannerModule {
  return load<JourneyPlannerModule>("journey-planner", "journey_planner_wasm.js");
}

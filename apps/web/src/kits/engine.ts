import type { Kits, KitsLoader, SpanSystem, VesselType } from "./types";

let wasmModule: Promise<typeof import("../wasm/mode-kits/mode_kits_wasm.js")> | null = null;

/** Purpose: load and instantiate the WebAssembly module once. */
function initWasm() {
  wasmModule ??= import("../wasm/mode-kits/mode_kits_wasm.js").then(async (wasm) => {
    await wasm.default();
    return wasm;
  });
  return wasmModule;
}

/**
 * Purpose: load the mode-kits WebAssembly module (straight spans kit, water route kit, segment engine).
 * Output: the kits; each call sends the whole line and returns the built line.
 * Dependencies: apps/web/src/wasm/mode-kits, built by tools/wasm/build-mode-kits.sh.
 */
export const loadKits: KitsLoader = async () => {
  const wasm = await initWasm();
  return {
    buildSpanLine: (line) => JSON.parse(wasm.build_span_line(JSON.stringify(line))),
    buildWaterLine: (line) => JSON.parse(wasm.build_water_line(JSON.stringify(line))),
  } satisfies Kits;
};

/**
 * Purpose: a ropeway system for the straight spans kit from the plugin's parameter values
 * (`ropeway.*`, resolved for the mode and ropeway system), with the planner's overrides on top.
 */
export function spanSystem(
  id: string,
  operation: SpanSystem["operation"],
  v: Record<string, number>,
  over: Partial<SpanSystem> = {},
): SpanSystem {
  const p = (k: string, d: number) => v[`ropeway.${k}`] ?? d;
  return {
    id,
    operation,
    line_speed_ms: p("line_speed_ms", 6),
    cabin_interval_s: p("cabin_interval_s", 12),
    cabin_capacity: p("cabin_capacity", 10),
    max_span_m: p("max_span_m", 400),
    max_station_angle_deg: p("max_station_angle_deg", 30),
    min_clearance_m: p("min_clearance_m", 5),
    recommended_clearance_m: p("recommended_clearance_m", 8),
    tower_height_m: p("tower_height_m", 25),
    max_tower_height_m: p("max_tower_height_m", 50),
    station_rope_height_m: p("station_rope_height_m", 8),
    cabin_hang_m: p("cabin_hang_m", 4),
    sag_ratio: p("sag_ratio", 0.04),
    station_passage_s: p("station_passage_s", 45),
    terminal_dwell_s: p("terminal_dwell_s", 60),
    reserve_share: p("reserve_share", 0.1),
    capacity_ceiling_pphpd: p("capacity_ceiling_pphpd", 0),
    ...over,
  };
}

/** Purpose: a vessel type for the water route kit from the plugin's `ferry.*` values, with overrides. */
export function vesselType(
  id: string,
  v: Record<string, number>,
  over: Partial<VesselType> = {},
): VesselType {
  const p = (k: string, d: number) => v[`ferry.${k}`] ?? d;
  return {
    id,
    service_speed_kn: p("service_speed_kn", 12),
    berthing_s: p("berthing_s", 120),
    boarding_pax_per_min_per_gangway: p("boarding_pax_per_min_per_gangway", 30),
    min_dwell_s: p("min_dwell_s", 60),
    capacity: p("passenger_capacity", 250),
    ...over,
  };
}

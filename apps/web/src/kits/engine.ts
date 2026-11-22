import type { DispatchRules, Kits, KitsLoader, SpanSystem, VesselType, ZoneSystem } from "./types";

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
 * Purpose: load the mode-kits WebAssembly module (straight spans, water route and service zone kits,
 * segment engine).
 * Output: the kits; each call sends the whole line and returns the built line.
 * Dependencies: apps/web/src/wasm/mode-kits, built by tools/wasm/build-mode-kits.sh.
 */
export const loadKits: KitsLoader = async () => {
  const wasm = await initWasm();
  return {
    buildSpanLine: (line) => JSON.parse(wasm.build_span_line(JSON.stringify(line))),
    buildWaterLine: (line) => JSON.parse(wasm.build_water_line(JSON.stringify(line))),
    estimateZone: (zone) => JSON.parse(wasm.estimate_zone(JSON.stringify(zone))),
    simulateZone: (day) => JSON.parse(wasm.simulate_zone(JSON.stringify(day))),
  } satisfies Kits;
};

/**
 * Purpose: a system for the straight spans kit from the plugin's parameter values (`<prefix>.*`, resolved
 * for the mode and system: `ropeway.*` for cable cars), with the planner's overrides on top.
 */
export function spanSystem(
  id: string,
  operation: SpanSystem["operation"],
  v: Record<string, number>,
  over: Partial<SpanSystem> = {},
  prefix = "ropeway",
): SpanSystem {
  const p = (k: string, d: number) => v[`${prefix}.${k}`] ?? d;
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
    parameter_prefix: prefix,
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

/** Purpose: an on-demand system for the service zone kit from the plugin's `<prefix>.*` values. */
export function zoneSystem(v: Record<string, number>, prefix = "drt"): ZoneSystem {
  const p = (k: string, d: number) => v[`${prefix}.${k}`] ?? d;
  return {
    speed_kmh: p("speed_kmh", 25),
    network_factor: p("network_factor", 1.25),
    stop_dwell_s: p("stop_dwell_s", 32),
    vehicle_places: p("vehicle_places", 8),
    target_utilisation: p("target_utilisation", 0.85),
    pooling_detour_share: p("pooling_detour_share", 0.2),
    max_wait_s: p("max_wait_s", 600),
    riders_per_request: p("riders_per_request", 1.1),
  };
}

/** Purpose: the dispatcher's limits from the plugin's values (`drt.max_wait_limit_s` and the detour rule). */
export function dispatchRules(v: Record<string, number>, prefix = "drt"): DispatchRules {
  const p = (k: string, d: number) => v[`${prefix}.${k}`] ?? d;
  return {
    max_wait_s: p("max_wait_limit_s", 900),
    max_detour_share: p("max_detour_share", 0.5),
    max_detour_fixed_s: p("max_detour_fixed_s", 600),
  };
}

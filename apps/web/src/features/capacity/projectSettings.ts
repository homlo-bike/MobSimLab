import type { CapacityParams, SignallingField } from "./types";

/** Settings of a capacity run and the assumption library key each takes the project's value from. */
const KEYS: [keyof CapacityParams, string][] = [
  ["recovery_s", "stability.recovery_s"],
  ["min_buffer_s", "timetable.min_buffer_s"],
  ["occupancy_limit_share", "capacity.occupancy_limit_share"],
  ["spare_share", "mode.spare_share"],
  ["late_threshold_s", "recording.late_threshold_s"],
  ["stability_runs", "stability.runs"],
  ["delayed_share", "stability.delayed_share"],
  ["primary_delay_mean_s", "stability.primary_delay_mean_s"],
  ["primary_delay_max_s", "stability.primary_delay_max_s"],
  ["residual_delay_s", "stability.residual_delay_s"],
];

/** Signalling and driving values and their library keys. */
const SIGNALLING: [SignallingField, string][] = [
  ["route_setting_s", "signalling.route_setting_s"],
  ["sight_reaction_s", "signalling.sight_reaction_s"],
  ["release_s", "signalling.release_s"],
  ["sighting_m", "signalling.sighting_m"],
  ["overlap_release_s", "signalling.overlap_release_s"],
  ["approach_release_s", "signalling.approach_release_s"],
  ["barrier_closing_s", "level_crossing.barrier_closing_s"],
  ["signal_closing_s", "level_crossing.signal_closing_s"],
  ["moving_block_margin_m", "signalling.moving_block_margin_m"],
  ["supervision_tolerance_kmh", "signalling.supervision_tolerance_kmh"],
  ["emergency_brake_factor", "sim.emergency_brake_factor"],
  ["ato_brake_share", "sim.ato_brake_share"],
  ["terminal_separation_s", "timetable.terminal_separation_s"],
];

/**
 * Purpose: the run settings the project sets in Project preferences → All parameters (its value for every
 * mode). Settings it leaves alone are absent, so the module's defaults (the library's central values) apply.
 */
export function projectRunSettings(prefs: Record<string, number> | undefined): Partial<CapacityParams> {
  const own = (key: string) => {
    const v = prefs?.[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const out: Partial<CapacityParams> = {};
  for (const [field, key] of KEYS) {
    const v = own(key);
    if (v !== undefined) out[field] = field === "stability_runs" ? Math.max(1, Math.round(v)) : v;
  }
  const signalling: Partial<Record<SignallingField, number>> = {};
  for (const [field, key] of SIGNALLING) {
    const v = own(key);
    if (v !== undefined) signalling[field] = v;
  }
  if (Object.keys(signalling).length) out.signalling = signalling;
  return out;
}

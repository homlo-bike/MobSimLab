import type { Settings } from "./types";

/** Journey planner settings and the assumption library key each takes the project's value from. */
const KEYS: [keyof Settings, string][] = [
  ["walk_speed_kmh", "demand.walk_speed_kmh"],
  ["walk_detour_factor", "journey.walk_detour_factor"],
  ["walk_slope_k", "journey.walk_slope_k"],
  ["min_change_s", "journey.min_change_s"],
  ["level_change_s", "journey.level_change_s"],
];

/**
 * Purpose: the journey planner settings the project sets in Project preferences → All parameters (its value
 * for every mode). Settings it leaves alone are absent, so the planner's defaults (the library's) apply.
 */
export function journeySettingsFrom(
  values: Readonly<Record<string, number>> | null | undefined,
): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const [field, key] of KEYS) {
    const v = values?.[key];
    // 0 is a real choice for the slope term (walks timed as flat); the other values must be positive.
    const ok = field === "walk_slope_k" ? (v ?? -1) >= 0 : (v ?? 0) > 0;
    if (typeof v === "number" && Number.isFinite(v) && ok) (out as Record<string, number>)[field] = v;
  }
  return out;
}

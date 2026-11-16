import { AsyncLocalStorage } from "node:async_hooks";
import DEFAULTS from "./defaults.json";

/**
 * The values the agent analyses use: the assumption library's (defaults.json), or those of the project a
 * scenario is linked to, where the project changed them in Project preferences → All parameters.
 *
 * A tool call runs inside `withValues`; when it loads a scenario linked to a project it calls `useValues` with
 * that project's values, and everything the call computes afterwards reads them through `values()`.
 */

export type AgentValues = typeof DEFAULTS;
type ModeRow = AgentValues["modes"]["bus"];

/** The project's preferences document as the API stores it (numbers by id, and enum or text values). */
export interface ProjectPrefs {
  values?: Record<string, unknown>;
  choices?: Record<string, unknown>;
}

const store = new AsyncLocalStorage<{ values: AgentValues }>();

/** Purpose: the values of the current tool call: a linked project's, else the library's. */
export function values(): AgentValues {
  return store.getStore()?.values ?? DEFAULTS;
}

/** Purpose: run `fn` with its own values slot (the library's until `useValues` sets a project's). */
export function withValues<T>(fn: () => T): T {
  return store.run({ values: DEFAULTS }, fn);
}

/** Purpose: use these values for the rest of the current `withValues` call. No effect outside one. */
export function useValues(v: AgentValues): void {
  const s = store.getStore();
  if (s) s.values = v;
}

/** Purpose: use the library's values again for the rest of the current `withValues` call. */
export function useLibraryValues(): void {
  useValues(DEFAULTS);
}

/**
 * Purpose: the library's values with the project's own applied. A value for the mode (`<key>.<mode>`) wins over
 * one for every mode (`<key>`). Numbers must be finite and not negative; a range keeps its low and high around
 * the project's central value. The line colour comes from the project's text values.
 * Pure.
 */
export function projectValues(prefs: ProjectPrefs | null | undefined): AgentValues {
  const nums = prefs?.values ?? {};
  const texts = prefs?.choices ?? {};
  const num = (key: string, mode?: string): number | undefined => {
    for (const id of mode ? [`${key}.${mode}`, key] : [key]) {
      const v = nums[id];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    }
    return undefined;
  };
  const text = (key: string, mode: string): string | undefined => {
    for (const id of [`${key}.${mode}`, key]) {
      const v = texts[id];
      if (typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v)) return v;
    }
    return undefined;
  };
  const keys = DEFAULTS.keys as Record<string, string>;
  const modes = {} as Record<string, ModeRow>;
  for (const [mode, lib] of Object.entries(DEFAULTS.modes)) {
    const row = { ...lib, stop_spacing_m: [...lib.stop_spacing_m] } as ModeRow;
    for (const [field, key] of Object.entries(keys)) {
      if (field === "colour") {
        const c = text(key, mode);
        if (c) row.colour = c;
      } else if (field === "stop_spacing_m_range") {
        const v = num(key, mode);
        const [lo, , hi] = lib.stop_spacing_m as [number, number, number];
        if (v !== undefined && v > 0) row.stop_spacing_m = [Math.min(lo, v), v, Math.max(hi, v)];
      } else if (field in lib) {
        const v = num(key, mode);
        // Shares, dwell and layover may be zero; speeds, rates and distances may not.
        const zeroOk = field.endsWith("_share") || field === "dwell_s" || field === "layover_min";
        if (v !== undefined && (v > 0 || zeroOk)) (row as Record<string, unknown>)[field] = v;
      }
    }
    modes[mode] = row;
  }
  const out = { ...DEFAULTS, modes: modes as AgentValues["modes"] };
  for (const [field, key] of Object.entries(keys)) {
    if (field in DEFAULTS && field !== "modes" && field !== "keys") {
      const v = num(key);
      if (v !== undefined && v > 0) (out as Record<string, unknown>)[field] = v;
    }
  }
  return out;
}

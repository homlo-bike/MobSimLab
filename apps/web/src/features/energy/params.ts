/**
 * The energy plugin's parameter values (plugins/energy/assumptions, rendered into the plugin registry), with
 * the project's own values on top, stored in the preferences document like the cost values: the id is the
 * parameter key for every mode, or `<key>.<mode>` for one mode.
 */
import { prefId } from "../costs/params";
import type { PreferencesDoc } from "../../workspace/preferences";
import { activePlugins, pluginCalculation, type Plugin, type Range } from "../../plugins/registry";

export const ENERGY_PLUGIN = "org.mobsimlab.energy";
export const ENERGY_CALCULATION = "energy_emissions";

/** The parameters a planner sets in the energy section. */
export const GRID = "energy.grid_kg_co2e_per_kwh";
export const ELECTRIC_SHARE = "energy.electric_share";

/** Purpose: whether the energy plugin is on in the open project and offers its calculation in the Tables tab. */
export function energyInTables(plugins: readonly Plugin[] = activePlugins()): boolean {
  const c = pluginCalculation(ENERGY_CALCULATION, plugins);
  return !!c && (c.where ?? []).includes("tables");
}

/** Purpose: the library's range of an `energy.*` parameter for a mode, or null when unknown. */
export function libraryRange(
  key: string,
  mode: string,
  plugins: readonly Plugin[] = activePlugins(),
): Range | null {
  const p = plugins.find((x) => x.id === ENERGY_PLUGIN);
  return p?.defaults[mode]?.["*"]?.[key] ?? null;
}

function own(prefs: PreferencesDoc["values"] | undefined, id: string): number | undefined {
  const v = prefs?.[id];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Purpose: the project's own value of a parameter for a mode (the mode's, else every mode's), if any. */
export function ownValue(
  key: string,
  mode: string,
  prefs: PreferencesDoc["values"] | undefined,
): number | undefined {
  return own(prefs, prefId(key, mode)) ?? own(prefs, prefId(key, "*"));
}

/**
 * Purpose: the `energy.*` values a line of a mode uses: the library's central values, with the project's
 * own values on top. Output: parameter key → value; empty when the plugin or the mode is unknown.
 */
export function energyValues(
  mode: string,
  prefs: PreferencesDoc["values"] | undefined,
  plugins: readonly Plugin[] = activePlugins(),
): Record<string, number> {
  const p = plugins.find((x) => x.id === ENERGY_PLUGIN);
  const lib = p?.defaults[mode]?.["*"] ?? {};
  return Object.fromEntries(Object.entries(lib).map(([k, r]) => [k, ownValue(k, mode, prefs) ?? r.central]));
}

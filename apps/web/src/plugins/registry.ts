import bundled from "./bundled.generated.json";

/** A transport mode contributed by a plugin (contracts/plugin-mode.schema.json). */
export interface PluginMode {
  id: string;
  label: string;
  family: "street" | "rail" | "guided" | "aerial" | "water";
  colour: string;
  gtfsRouteType: number;
  kit: "straight-spans" | "water-route";
  operation: "frequency" | "shuttle" | "timetabled";
  contextKey?: string;
  contexts?: string[];
  defaultContext?: string;
}

/** An authoring tool for the Create tab: a core kit with the modes it draws. */
export interface PluginTool {
  id: string;
  label: string;
  hint?: string;
  kit: "straight-spans" | "water-route";
  modes: string[];
}

/** A calculation a bundled plugin adds (runtime `bundled-wasm`: a core crate built to WebAssembly). */
export interface PluginCalculation {
  id: string;
  label: string;
  description?: string;
  runtime: "bundled-wasm";
  module: string;
  inputs: string[];
  outputs: string[];
  where?: string[];
}

/** A map layer drawn from a calculation's output. */
export interface PluginMapLayer {
  id: string;
  label: string;
  calculation: string;
  style: unknown;
}

/** Low, central and high value of an assumption parameter. */
export interface Range {
  low: number;
  central: number;
  high: number;
}

/** One plugin as tools/plugins/check.py renders it. */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: { name: string; url?: string };
  license: string;
  dataLicense: string;
  bundled: boolean;
  tiers: string[];
  permissions: string[];
  modes: PluginMode[];
  contexts: { key: string; label: string; options: { id: string; label: string }[] }[];
  tools: PluginTool[];
  calculations?: PluginCalculation[];
  mapLayers?: PluginMapLayer[];
  parameters: Record<string, { label: string; unit: string }>;
  /** mode id → context option ("*" without one) → parameter key → range. */
  defaults: Record<string, Record<string, Record<string, Range>>>;
}

/** The plugins bundled with this build (ADR-0036 §8), from apps/web/src/plugins/bundled.generated.json. */
export const PLUGINS: readonly Plugin[] = (bundled as unknown as { plugins: Plugin[] }).plugins;

/** Purpose: every mode the plugins contribute. */
export function pluginModes(plugins: readonly Plugin[] = PLUGINS): PluginMode[] {
  return plugins.flatMap((p) => p.modes);
}

/** Purpose: a plugin mode by id, with the plugin that contributes it. */
export function findMode(
  id: string,
  plugins: readonly Plugin[] = PLUGINS,
): { plugin: Plugin; mode: PluginMode } | null {
  for (const plugin of plugins) {
    const mode = plugin.modes.find((m) => m.id === id);
    if (mode) return { plugin, mode };
  }
  return null;
}

/** Purpose: the Create tab's plugin tools, in plugin order. */
export function pluginTools(plugins: readonly Plugin[] = PLUGINS): (PluginTool & { plugin: string })[] {
  return plugins.flatMap((p) => p.tools.map((t) => ({ ...t, plugin: p.id })));
}

/** Purpose: a calculation by id, so editors show it only when its plugin is present. */
export function pluginCalculation(
  id: string,
  plugins: readonly Plugin[] = PLUGINS,
): (PluginCalculation & { plugin: string }) | null {
  for (const p of plugins) {
    const c = p.calculations?.find((x) => x.id === id);
    if (c) return { ...c, plugin: p.id };
  }
  return null;
}

/** Purpose: the map layers drawn from a calculation. */
export function pluginMapLayers(calculation: string, plugins: readonly Plugin[] = PLUGINS): PluginMapLayer[] {
  return plugins.flatMap((p) => (p.mapLayers ?? []).filter((l) => l.calculation === calculation));
}

/** Purpose: the label of a context option, such as "Tricable gondola (3S)" for `3s`. */
export function contextLabel(modeId: string, option: string, plugins: readonly Plugin[] = PLUGINS): string {
  const f = findMode(modeId, plugins);
  const key = f?.mode.contextKey;
  return f?.plugin.contexts.find((c) => c.key === key)?.options.find((o) => o.id === option)?.label ?? option;
}

/**
 * Purpose: central values of a mode's parameters for one context option (the system or vessel type).
 * Output: parameter key → central value; empty when the mode or option is unknown.
 */
export function centralValues(
  modeId: string,
  option: string,
  plugins: readonly Plugin[] = PLUGINS,
): Record<string, number> {
  const f = findMode(modeId, plugins);
  const per = f?.plugin.defaults[modeId]?.[option] ?? {};
  return Object.fromEntries(Object.entries(per).map(([k, r]) => [k, r.central]));
}

import bundled from "./bundled.generated.json";

/** A transport mode contributed by a plugin (contracts/plugin-mode.schema.json). */
export interface PluginMode {
  id: string;
  label: string;
  family: "street" | "rail" | "guided" | "aerial" | "water";
  colour: string;
  gtfsRouteType: number;
  kit: "straight-spans" | "water-route" | "service-zone";
  operation: "frequency" | "shuttle" | "timetabled" | "on_demand";
  contextKey?: string;
  contexts?: string[];
  defaultContext?: string;
  /** Prefix of the plugin parameters that feed the kit (default `ropeway` or `ferry`). */
  parameterPrefix?: string;
}

/** An authoring tool for the Create tab: a core kit with the modes it draws. */
export interface PluginTool {
  id: string;
  label: string;
  hint?: string;
  kit: "straight-spans" | "water-route" | "service-zone";
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

/** An importer or exporter a bundled plugin adds: a file format to or from a published contract. */
export interface PluginConverter {
  id: string;
  label: string;
  description?: string;
  format: string;
  extensions?: string[];
  contract: "published-timetable";
  runtime: "bundled-wasm";
  module: string;
  function: string;
  maxBytes: number;
}

/** A map layer drawn from a calculation's output. */
export interface PluginMapLayer {
  id: string;
  label: string;
  calculation: string;
  style: unknown;
}

/** A project tab a bundled plugin adds after the core tabs; `view` names a view built into the web app. */
export interface PluginTab {
  id: string;
  label: string;
  view: string;
  calculations?: string[];
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
  importers?: PluginConverter[];
  exporters?: PluginConverter[];
  mapLayers?: PluginMapLayer[];
  tabs?: PluginTab[];
  parameters: Record<string, { label: string; unit: string }>;
  /** mode id → context option ("*" without one) → parameter key → range. */
  defaults: Record<string, Record<string, Record<string, Range>>>;
}

/** The plugins bundled with this build (ADR-0036 §8), from apps/web/src/plugins/bundled.generated.json. */
export const PLUGINS: readonly Plugin[] = (bundled as unknown as { plugins: Plugin[] }).plugins;

/** One plugin as `GET /api/projects/:id/plugins` lists it (ADR-0036 §9). */
export interface ProjectPlugin {
  id: string;
  name: string;
  description: string;
  publisher: { name: string; url?: string };
  bundled: boolean;
  enabled: boolean;
  version: string;
  versions: string[];
  permissions: string[];
  contributes: {
    modes: string[];
    tools: string[];
    parameters: number;
    calculations: string[];
    mapLayers: string[];
  };
  missing: boolean;
  /** Registry entry of an installed plugin the project has turned on. */
  entry?: Plugin;
}

let active: readonly Plugin[] = PLUGINS;

/** Purpose: the plugins turned on in the open project (all bundled plugins when no project is open). */
export function activePlugins(): readonly Plugin[] {
  return active;
}

/** Purpose: set the open project's plugins; every helper below uses them by default. */
export function setActivePlugins(plugins: readonly Plugin[]): void {
  active = plugins;
}

/**
 * Purpose: the plugins a project uses: the bundled ones it has not turned off, then the installed ones it has
 * turned on (their registry entries come from the API). Output: plugins in that order.
 */
export function pluginsOfProject(list: readonly ProjectPlugin[]): Plugin[] {
  const on = new Set(list.filter((p) => p.enabled).map((p) => p.id));
  const known = new Set(list.map((p) => p.id));
  return [
    ...PLUGINS.filter((p) => on.has(p.id) || !known.has(p.id)),
    ...list.filter((p) => p.enabled && !p.bundled && p.entry).map((p) => p.entry!),
  ];
}

/** Purpose: every mode the plugins contribute. */
export function pluginModes(plugins: readonly Plugin[] = activePlugins()): PluginMode[] {
  return plugins.flatMap((p) => p.modes);
}

/** Purpose: a plugin mode by id, with the plugin that contributes it. */
export function findMode(
  id: string,
  plugins: readonly Plugin[] = activePlugins(),
): { plugin: Plugin; mode: PluginMode } | null {
  for (const plugin of plugins) {
    const mode = plugin.modes.find((m) => m.id === id);
    if (mode) return { plugin, mode };
  }
  return null;
}

/** Purpose: the Create tab's plugin tools, in plugin order. */
export function pluginTools(
  plugins: readonly Plugin[] = activePlugins(),
): (PluginTool & { plugin: string })[] {
  return plugins.flatMap((p) => p.tools.map((t) => ({ ...t, plugin: p.id })));
}

/** Purpose: the project tabs the plugins add, in plugin order. */
export function pluginTabs(plugins: readonly Plugin[] = PLUGINS): (PluginTab & { plugin: string })[] {
  return plugins.flatMap((p) => (p.tabs ?? []).map((t) => ({ ...t, plugin: p.id })));
}

/** Purpose: a calculation by id, so editors show it only when its plugin is present. */
export function pluginCalculation(
  id: string,
  plugins: readonly Plugin[] = activePlugins(),
): (PluginCalculation & { plugin: string }) | null {
  for (const p of plugins) {
    const c = p.calculations?.find((x) => x.id === id);
    if (c) return { ...c, plugin: p.id };
  }
  return null;
}

/** Purpose: an importer or exporter by id, so the app offers it only when its plugin is present. */
export function pluginConverter(
  kind: "importers" | "exporters",
  id: string,
  plugins: readonly Plugin[] = activePlugins(),
): (PluginConverter & { plugin: string }) | null {
  for (const p of plugins) {
    const c = p[kind]?.find((x) => x.id === id);
    if (c) return { ...c, plugin: p.id };
  }
  return null;
}

/** Purpose: the map layers drawn from a calculation. */
export function pluginMapLayers(
  calculation: string,
  plugins: readonly Plugin[] = activePlugins(),
): PluginMapLayer[] {
  return plugins.flatMap((p) => (p.mapLayers ?? []).filter((l) => l.calculation === calculation));
}

/** Purpose: the label of a context option, such as "Tricable gondola (3S)" for `3s`. */
export function contextLabel(
  modeId: string,
  option: string,
  plugins: readonly Plugin[] = activePlugins(),
): string {
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
  plugins: readonly Plugin[] = activePlugins(),
): Record<string, number> {
  const f = findMode(modeId, plugins);
  const per = f?.plugin.defaults[modeId]?.[option] ?? {};
  return Object.fromEntries(Object.entries(per).map(([k, r]) => [k, r.central]));
}

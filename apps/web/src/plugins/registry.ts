import bundled from "./bundled.generated.json";
import { pluginText } from "./texts";

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

/**
 * A calculation a plugin adds: runtime `bundled-wasm` (a core crate built to WebAssembly, bundled plugins) or
 * `component` (an installed plugin's own WebAssembly component, run in a sandboxed worker, ADR-0036 Phase 2).
 */
export interface PluginCalculation {
  id: string;
  label: string;
  description?: string;
  runtime: "bundled-wasm" | "component";
  /** bundled-wasm: module under apps/web/src/wasm/. */
  module?: string;
  /** component: the component's path in the package. */
  component?: string;
  inputs: string[];
  outputs: string[];
  where?: string[];
}

/** An importer or exporter a plugin adds: a file format to or from a published contract. */
export interface PluginConverter {
  id: string;
  label: string;
  description?: string;
  format: string;
  extensions?: string[];
  contract: "published-timetable";
  runtime: "bundled-wasm" | "component";
  /** bundled-wasm: module and function. */
  module?: string;
  function?: string;
  /** component: the component's path in the package. */
  component?: string;
  maxBytes: number;
}

/** A map layer drawn from a calculation's output. */
export interface PluginMapLayer {
  id: string;
  label: string;
  calculation: string;
  style: unknown;
}

/**
 * An aerial basemap a bundled plugin adds to the layer control: raster tiles under the place and street names.
 * With `date`, the tile URLs hold `{date}` and the layer control offers a day. With `server`, the tiles come
 * through the API (`/api/basemaps/<server>/tiles/...`), which holds the provider's key.
 */
export interface PluginBasemap {
  id: string;
  label: string;
  note?: string;
  tiles: string[];
  tileSize: 256 | 512;
  maxzoom: number;
  attribution: { text: string; url?: string };
  date?: { first: string; latencyDays: number };
  /** Imagery the API fetches with a key an Admin saved; offered only once it is saved. */
  server?: "esri";
}

/** A source layer of a street photo source's coverage tiles, drawn from `minzoom` on. */
export interface StreetPhotoLayer {
  sourceLayer: string;
  minzoom: number;
}

/**
 * A street-level photo source a bundled plugin adds (Panoramax): its coverage, drawn while the map's Street photos
 * panel is open, and the photos near a clicked point, which the API looks up (`/api/street-photos/<provider>`).
 * With `server`, the source needs a key an Admin saved and is offered only once it is saved.
 */
export interface PluginStreetPhotos {
  id: string;
  label: string;
  provider: string;
  note?: string;
  coverage: {
    tiles: string[];
    minzoom: number;
    maxzoom: number;
    lines: StreetPhotoLayer;
    points?: StreetPhotoLayer;
  };
  color?: string;
  attribution: { text: string; url?: string };
  pageName: string;
  server?: string;
}

/**
 * A project tab a plugin adds after the core tabs: `view` names a view built into the web app (bundled
 * plugins), `ui` the plugin's own page, shown in a sandboxed frame (installed plugins, ADR-0036 §6).
 */
export interface PluginTab {
  id: string;
  label: string;
  view?: string;
  ui?: string;
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
  basemaps?: PluginBasemap[];
  streetPhotos?: PluginStreetPhotos[];
  tabs?: PluginTab[];
  parameters: Record<string, { label: string; unit: string }>;
  /** mode id → context option ("*" without one) → parameter key → range. */
  defaults: Record<string, Record<string, Record<string, Range>>>;
  /** Installed plugins: language tag → English text → translation (bundled ones load theirs per language). */
  translations?: Record<string, Record<string, string>>;
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
    /** Labels of its aerial basemaps (older servers leave them out). */
    basemaps?: string[];
    /** Labels of its street photo sources (older servers leave them out). */
    streetPhotos?: string[];
    /** Labels of its importers, exporters and tabs (older servers leave them out). */
    importers?: string[];
    exporters?: string[];
    tabs?: string[];
  };
  missing: boolean;
  /** An Admin turned the plugin off for the whole MobSimLab: it is off here and cannot be turned on. */
  instanceOff?: boolean;
  /** Registry entry of an installed plugin the project has turned on. */
  entry?: Plugin;
  /** Package hash of an installed plugin the project has turned on: where its tab pages are served. */
  sha256?: string;
  /** Language tag → English text → translation (older servers leave it out). */
  translations?: Record<string, Record<string, string>>;
}

const localized = new WeakMap<Plugin, Map<string, Plugin>>();

/**
 * Purpose: a plugin with its texts in a language (name, description, and the labels, hints and notes of its
 * modes, contexts, tools, calculations, converters, tabs, map layers, basemaps and street photo sources).
 * Output: the same plugin for English; else a copy, made once per plugin and language.
 */
export function localizePlugin(p: Plugin, tag: string): Plugin {
  if (tag === "en") return p;
  const per = localized.get(p) ?? new Map<string, Plugin>();
  localized.set(p, per);
  const have = per.get(tag);
  if (have) return have;
  const tr = (s: string) => pluginText(p, s, tag);
  const opt = (s: string | undefined) => (s === undefined ? s : tr(s));
  const texts = <T extends { label: string; hint?: string; description?: string; note?: string }>(
    x: T,
  ): T => ({
    ...x,
    label: tr(x.label),
    ...(x.hint !== undefined ? { hint: tr(x.hint) } : {}),
    ...(x.description !== undefined ? { description: opt(x.description) } : {}),
    ...(x.note !== undefined ? { note: opt(x.note) } : {}),
  });
  const out: Plugin = {
    ...p,
    name: tr(p.name),
    description: tr(p.description),
    modes: p.modes.map(texts),
    contexts: p.contexts.map((c) => ({
      ...c,
      label: tr(c.label),
      options: c.options.map((o) => ({ ...o, label: tr(o.label) })),
    })),
    tools: p.tools.map(texts),
    ...(p.calculations ? { calculations: p.calculations.map(texts) } : {}),
    ...(p.importers ? { importers: p.importers.map(texts) } : {}),
    ...(p.exporters ? { exporters: p.exporters.map(texts) } : {}),
    ...(p.mapLayers ? { mapLayers: p.mapLayers.map(texts) } : {}),
    ...(p.basemaps ? { basemaps: p.basemaps.map(texts) } : {}),
    ...(p.streetPhotos ? { streetPhotos: p.streetPhotos.map(texts) } : {}),
    ...(p.tabs ? { tabs: p.tabs.map(texts) } : {}),
  };
  per.set(tag, out);
  return out;
}

/** Purpose: plugins with their texts in a language (see `localizePlugin`). */
export function localizePlugins(plugins: readonly Plugin[], tag: string): Plugin[] {
  return plugins.map((p) => localizePlugin(p, tag));
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

/** Purpose: the calculations of installed plugins (their own code) offered in a place such as "tables". */
export function componentCalculations(
  where: string,
  plugins: readonly Plugin[] = activePlugins(),
): (PluginCalculation & { plugin: Plugin })[] {
  return plugins.flatMap((p) =>
    (p.calculations ?? [])
      .filter((c) => c.runtime === "component" && (c.where ?? []).includes(where))
      .map((c) => ({ ...c, plugin: p })),
  );
}

/** Purpose: the importers or exporters of installed plugins (their own code), with their plugin. */
export function componentConverters(
  kind: "importers" | "exporters",
  plugins: readonly Plugin[] = activePlugins(),
): (PluginConverter & { plugin: Plugin })[] {
  return plugins.flatMap((p) =>
    (p[kind] ?? []).filter((c) => c.runtime === "component").map((c) => ({ ...c, plugin: p })),
  );
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

/** Purpose: the street photo sources the plugins add, with the plugin that adds each. */
export function pluginStreetPhotos(
  plugins: readonly Plugin[] = activePlugins(),
): (PluginStreetPhotos & { plugin: string })[] {
  return plugins.flatMap((p) => (p.streetPhotos ?? []).map((s) => ({ ...s, plugin: p.id })));
}

/** Purpose: the aerial basemaps the plugins add, with the plugin that adds each. */
export function pluginBasemaps(
  plugins: readonly Plugin[] = activePlugins(),
): (PluginBasemap & { plugin: string })[] {
  return plugins.flatMap((p) => (p.basemaps ?? []).map((b) => ({ ...b, plugin: p.id })));
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

/**
 * Purpose: the values a mode's tool uses for one context option: the library's central values, with the
 * project's own on top (Project preferences → All parameters: `<key>.<mode>` for the mode, else `<key>` for every
 * mode). Output: parameter key → value; empty when the mode or option is unknown.
 */
export function projectValues(
  modeId: string,
  option: string,
  prefs: Readonly<Record<string, number>> | null | undefined,
  plugins: readonly Plugin[] = activePlugins(),
): Record<string, number> {
  const own = (id: string) => {
    const v = prefs?.[id];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  return Object.fromEntries(
    Object.entries(centralValues(modeId, option, plugins)).map(([k, v]) => [
      k,
      own(`${k}.${modeId}`) ?? own(k) ?? v,
    ]),
  );
}

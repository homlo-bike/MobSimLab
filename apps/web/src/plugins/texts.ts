/**
 * Translations of the plugins' texts (names, descriptions, labels, hints and notes). Each plugin brings its own in
 * a `translations` folder of its manifest. The bundled plugins' translations are rendered by
 * tools/plugins/check.py into ./i18n/<tag>.generated.json and downloaded with the language's messages; an
 * installed plugin's come with its registry entry from the API. A text without a translation stays in English.
 */

/** Plugin id → English text → the text in one language. */
export type PluginTexts = Record<string, Record<string, string>>;

const LOADERS = import.meta.glob<PluginTexts>("./i18n/*.generated.json", { import: "default" });

const loaded: Record<string, PluginTexts | undefined> = {};

/**
 * Purpose: download the bundled plugins' translations into one language once and keep them.
 * Output: resolves when they are there (at once for English or a language without a file).
 */
export function loadPluginTexts(tag: string): Promise<void> {
  if (loaded[tag]) return Promise.resolve();
  const load = LOADERS[`./i18n/${tag}.generated.json`];
  if (!load) return Promise.resolve();
  return load().then((texts) => {
    loaded[tag] = texts;
  });
}

/** Something a plugin text belongs to: the plugin's id, and its own translations when it is installed. */
export interface TextOwner {
  id: string;
  translations?: Record<string, Record<string, string>>;
}

/**
 * Purpose: a plugin's English text in a language: the plugin's own translation, else the bundled plugins'
 * translation, else the English text.
 */
export function pluginText(owner: TextOwner, text: string, tag: string): string {
  if (tag === "en" || !text) return text;
  return owner.translations?.[tag]?.[text] ?? loaded[tag]?.[owner.id]?.[text] ?? text;
}

/** What Project Preferences and Administration list of a plugin: its name, description and contributions. */
interface Summary extends TextOwner {
  name: string;
  description: string;
  contributes: {
    modes: string[];
    tools: string[];
    calculations: string[];
    mapLayers: string[];
    basemaps?: string[];
    streetPhotos?: string[];
    importers?: string[];
    exporters?: string[];
    tabs?: string[];
  };
}

/** Purpose: a plugin as a list shows it, with its name, description and contributions in a language. */
export function localizeSummary<T extends Summary>(p: T, tag: string): T {
  if (tag === "en") return p;
  const tr = (s: string) => pluginText(p, s, tag);
  const list = (xs: string[] | undefined) => xs?.map(tr);
  const c = p.contributes;
  return {
    ...p,
    name: tr(p.name),
    description: tr(p.description),
    contributes: {
      ...c,
      modes: c.modes.map(tr),
      tools: c.tools.map(tr),
      calculations: c.calculations.map(tr),
      mapLayers: c.mapLayers.map(tr),
      basemaps: list(c.basemaps),
      streetPhotos: list(c.streetPhotos),
      importers: list(c.importers),
      exporters: list(c.exporters),
      tabs: list(c.tabs),
    },
  };
}

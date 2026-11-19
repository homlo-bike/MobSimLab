/**
 * Translations of the parameter library's names and units (assumptions/parameters), shown in Project preferences →
 * Parameters, the assumptions report and the Tables tab's settings. Each language has a file in ./params/<tag>.json,
 * downloaded with the language's messages: parameter id → name, and English unit → unit. A parameter or unit
 * without a translation stays in English; a plugin's parameters are translated with its other texts.
 */

/** One language's parameter texts. */
export interface ParamTexts {
  /** Parameter id → its name in the language. */
  labels: Record<string, string>;
  /** English unit → the unit in the language. */
  units: Record<string, string>;
}

const LOADERS = import.meta.glob<ParamTexts>("./params/*.json", { import: "default" });

const loaded: Record<string, ParamTexts | undefined> = {};

/**
 * Purpose: download the parameter texts of one language once and keep them.
 * Output: resolves when they are there (at once for English or a language without a file).
 */
export function loadParamTexts(tag: string): Promise<void> {
  if (loaded[tag]) return Promise.resolve();
  const load = LOADERS[`./params/${tag}.json`];
  if (!load) return Promise.resolve();
  return load().then((texts) => {
    loaded[tag] = texts;
  });
}

/** Purpose: a parameter's name in a language. Inputs: language tag, parameter id, English name. */
export function paramLabel(tag: string, id: string, english: string): string {
  return loaded[tag]?.labels[id] ?? english;
}

/** Purpose: a parameter's unit in a language. Inputs: language tag, English unit. */
export function paramUnit(tag: string, unit: string): string {
  return (unit && loaded[tag]?.units[unit]) || unit;
}

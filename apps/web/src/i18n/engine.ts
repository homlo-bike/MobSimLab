/**
 * Messages of the engines (railway design checks and others) in the app language. An engine sends each finding
 * as its English text and as a message: a key of the engine message catalog (crates/engine-msg/messages/en.json)
 * with values. Each language has a file in ./engine/<tag>.json, downloaded when it is first needed: key → text
 * with `{name}` placeholders. A message whose key, or the key of a part inside it, has no text in the language
 * shows in English.
 */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./i18n";

/** A message of an engine: a catalog key and the values to put into its text. */
export interface EngineMsg {
  key: string;
  /** Values by placeholder name: text shown as it is, or a part of the sentence that is itself a message. */
  args?: Record<string, string | EngineMsg>;
}

/** A finding with its English text and, from engines that send it, the message. */
export interface EngineText {
  text: string;
  msg?: EngineMsg | null;
}

const LOADERS = import.meta.glob<Record<string, string>>("./engine/*.json", { import: "default" });

const loaded: Record<string, Record<string, string> | undefined> = {};

/**
 * Purpose: download the engine messages of one language once and keep them.
 * Output: resolves when they are there (at once for English or a language without a file).
 */
export function loadEngineTexts(tag: string): Promise<void> {
  if (loaded[tag]) return Promise.resolve();
  const load = LOADERS[`./engine/${tag}.json`];
  if (!load) return Promise.resolve();
  return load().then((texts) => {
    loaded[tag] = texts;
  });
}

/** Purpose: a message in a catalog with its values filled in. Output: null when a key is not in the catalog. */
export function fillEngineMsg(catalog: Record<string, string>, m: EngineMsg): string | null {
  const text = catalog[m.key];
  if (text === undefined) return null;
  let missing = false;
  const out = text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const v = m.args?.[name];
    if (v === undefined) return whole;
    if (typeof v === "string") return v;
    const part = fillEngineMsg(catalog, v);
    if (part === null) missing = true;
    return part ?? "";
  });
  return missing ? null : out;
}

/** Purpose: a finding in a language: its message from the language's catalog, else its English text. */
export function engineText(tag: string, finding: EngineText): string {
  const catalog = loaded[tag];
  if (!catalog || !finding.msg) return finding.text;
  return fillEngineMsg(catalog, finding.msg) ?? finding.text;
}

/**
 * Purpose: a function that shows engine findings in the app language; it shows them in English until the
 * language's messages are downloaded, then the component shows them again.
 */
export function useEngineText(): (finding: EngineText) => string {
  const { language } = useI18n();
  const [ready, setReady] = useState(() => (loaded[language] ? language : ""));
  useEffect(() => {
    let live = true;
    loadEngineTexts(language).then(
      () => live && setReady(language),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [language]);
  const shown = ready === language ? language : "en";
  return useCallback((finding: EngineText) => engineText(shown, finding), [shown]);
}

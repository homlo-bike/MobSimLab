import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { type MessageKey, MESSAGES, type PluralKey } from "./messages";

/** Languages the app shell is translated into, with their own names (shown in the picker). */
export const LANGUAGES = [
  { tag: "en", native: "English", english: "English" },
  { tag: "ar", native: "العربية", english: "Arabic", dir: "rtl" },
  { tag: "de", native: "Deutsch", english: "German" },
  { tag: "es", native: "Español", english: "Spanish" },
  { tag: "fr", native: "Français", english: "French" },
  { tag: "nl", native: "Nederlands", english: "Dutch" },
  { tag: "pt", native: "Português", english: "Portuguese" },
  { tag: "ru", native: "Русский", english: "Russian" },
  { tag: "zh", native: "中文（简体）", english: "Chinese (Simplified)" },
  { tag: "sw", native: "Kiswahili", english: "Swahili" },
  { tag: "ha", native: "Hausa", english: "Hausa" },
  { tag: "am", native: "አማርኛ", english: "Amharic" },
  { tag: "yo", native: "Yorùbá", english: "Yoruba" },
  { tag: "ig", native: "Igbo", english: "Igbo" },
  { tag: "zu", native: "isiZulu", english: "Zulu" },
  { tag: "hi", native: "हिन्दी", english: "Hindi" },
  { tag: "bn", native: "বাংলা", english: "Bengali" },
  { tag: "ur", native: "اردو", english: "Urdu", dir: "rtl" },
  { tag: "mr", native: "मराठी", english: "Marathi" },
  { tag: "te", native: "తెలుగు", english: "Telugu" },
  { tag: "ta", native: "தமிழ்", english: "Tamil" },
  { tag: "uz", native: "Oʻzbekcha", english: "Uzbek" },
  { tag: "kk", native: "Қазақша", english: "Kazakh" },
  { tag: "ja", native: "日本語", english: "Japanese" },
  { tag: "ko", native: "한국어", english: "Korean" },
  { tag: "id", native: "Bahasa Indonesia", english: "Indonesian" },
  { tag: "vi", native: "Tiếng Việt", english: "Vietnamese" },
  { tag: "fa", native: "فارسی", english: "Persian", dir: "rtl" },
  { tag: "tr", native: "Türkçe", english: "Turkish" },
  { tag: "it", native: "Italiano", english: "Italian" },
  { tag: "pl", native: "Polski", english: "Polish" },
  { tag: "uk", native: "Українська", english: "Ukrainian" },
] as const;
export type Language = (typeof LANGUAGES)[number]["tag"];

/** "system" follows the browser or device language; anything else pins one language. */
export type LanguageChoice = "system" | Language;

/** Purpose: the writing direction of a language: "rtl" for Arabic and other right-to-left scripts, else "ltr". */
export function directionOf(tag: string): "ltr" | "rtl" {
  const l = LANGUAGES.find((x) => x.tag === tag);
  return l && "dir" in l ? l.dir : "ltr";
}

const FALLBACK: Language = "en";
const STORAGE_KEY = "mobsimlab.language";

/**
 * Purpose: the language to show for a choice.
 * Inputs: the person's choice ("system" or a tag) and the browser's preferred languages, best first.
 * Output: the first supported match (by full tag, then by primary subtag), else English.
 */
export function resolveLanguage(choice: string | undefined, preferred: readonly string[]): Language {
  const supported = (tag: string): Language | null => {
    const primary = tag.toLowerCase().split("-")[0];
    return LANGUAGES.find((l) => l.tag === primary)?.tag ?? null;
  };
  if (choice && choice !== "system") return supported(choice) ?? FALLBACK;
  for (const tag of preferred) {
    const hit = supported(tag);
    if (hit) return hit;
  }
  return FALLBACK;
}

/** Purpose: the browser's preferred languages, best first. */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}

/**
 * Purpose: the choice remembered on this device, for the sign-in page, before an account is known.
 * Signed-in people's choice is stored on their account; this copy only bridges the signed-out pages.
 */
export function storedChoice(): LanguageChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "system" || LANGUAGES.some((l) => l.tag === v)) return v as LanguageChoice;
  } catch {
    // storage blocked: follow the browser
  }
  return "system";
}

/** Purpose: remember the choice on this device. */
export function storeChoice(choice: LanguageChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // storage blocked: the choice still applies until the page reloads
  }
}

type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

export type TranslatePlural = (key: PluralKey, count: number, vars?: Vars) => string;

interface I18n {
  language: Language;
  choice: LanguageChoice;
  t: Translate;
  /** Translate a message that depends on a number, with the language's plural form; `{count}` is filled in. */
  tn: TranslatePlural;
  /** Change the language: "system" or a fixed one. */
  choose: (choice: LanguageChoice) => void;
}

/** Purpose: whether a string is a message key, for labels that are a key or plain text (such as "+1"). */
export function hasMessage(key: string): key is MessageKey {
  return key in MESSAGES.en;
}

/**
 * Purpose: look up a message in a language, falling back to English, and fill `{name}` placeholders.
 */
export function translate(language: Language, key: MessageKey, vars?: Vars): string {
  const text = (MESSAGES[language] as Record<string, string | undefined>)[key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/**
 * Purpose: a translated message with React nodes in its `{name}` placeholders, so a translation can move
 * emphasised parts (a bold name, a code host) to where its grammar puts them.
 */
export function withNodes(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name && name in nodes ? <span key={i}>{nodes[name]}</span> : part;
    })
    .filter((p) => p !== "");
}

/**
 * Purpose: a message for a number in the language's plural form (Intl.PluralRules: one, few, many and so on),
 * else the `other` form, with `{count}` filled in as a number formatted for the language. A `zero` form, where
 * a language has one, is used for 0.
 */
export function translatePlural(language: Language, key: PluralKey, count: number, vars?: Vars): string {
  const table = MESSAGES[language] as Record<string, string | undefined>;
  const rule = new Intl.PluralRules(language).select(count);
  const form =
    [count === 0 ? "zero" : null, rule].find((f) => f && table[`${key}.${f}`] !== undefined) ?? "other";
  // Latin digits everywhere, so counts match the other figures on screen (lengths, speeds, times).
  const shown = new Intl.NumberFormat(language, { numberingSystem: "latn" }).format(count);
  return translate(language, `${key}.${form}` as MessageKey, { count: shown, ...vars });
}

/** The language shown now, for text made outside components (errors thrown by loaders, for example). */
let active: Language = FALLBACK;

/** Purpose: translate in the language shown now, for code outside React components. */
/** Purpose: a date and time in the active language, in Latin digits. */
export function formatDateTime(iso: string | number | Date): string {
  return new Date(iso).toLocaleString(active, { numberingSystem: "latn" });
}

/** Purpose: a whole number with the active language's digit grouping, in Latin digits. */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString(active, { numberingSystem: "latn" });
}

export function tNow(key: MessageKey, vars?: Vars): string {
  return translate(active, key, vars);
}

const Ctx = createContext<I18n>({
  language: FALLBACK,
  choice: "system",
  t: (key, vars) => translate(FALLBACK, key, vars),
  tn: (key, count, vars) => translatePlural(FALLBACK, key, count, vars),
  choose: () => {},
});

/** Provides the language and `t` to the app, and keeps `<html lang>` and `<html dir>` in step. */
export function I18nProvider({
  choice,
  onChoose,
  children,
}: {
  choice: LanguageChoice;
  onChoose: (choice: LanguageChoice) => void;
  children: ReactNode;
}) {
  const language = resolveLanguage(choice, browserLanguages());
  active = language;
  const value = useMemo<I18n>(
    () => ({
      language,
      choice,
      t: (key, vars) => translate(language, key, vars),
      tn: (key, count, vars) => translatePlural(language, key, count, vars),
      choose: onChoose,
    }),
    [language, choice, onChoose],
  );
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = directionOf(language);
  }, [language]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Purpose: the current language, the person's choice and the translate function. */
export function useI18n(): I18n {
  return useContext(Ctx);
}

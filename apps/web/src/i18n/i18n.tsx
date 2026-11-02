import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { type MessageKey, MESSAGES } from "./messages";

/** Languages the app shell is translated into, with their own names (shown in the picker). */
export const LANGUAGES = [
  { tag: "en", native: "English", english: "English" },
  { tag: "de", native: "Deutsch", english: "German" },
  { tag: "es", native: "Español", english: "Spanish" },
  { tag: "fr", native: "Français", english: "French" },
  { tag: "nl", native: "Nederlands", english: "Dutch" },
] as const;
export type Language = (typeof LANGUAGES)[number]["tag"];

/** "system" follows the browser or device language; anything else pins one language. */
export type LanguageChoice = "system" | Language;

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

interface I18n {
  language: Language;
  choice: LanguageChoice;
  t: Translate;
  /** Change the language: "system" or a fixed one. */
  choose: (choice: LanguageChoice) => void;
}

/**
 * Purpose: look up a message in a language, falling back to English, and fill `{name}` placeholders.
 */
export function translate(language: Language, key: MessageKey, vars?: Vars): string {
  const text = MESSAGES[language][key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

const Ctx = createContext<I18n>({
  language: FALLBACK,
  choice: "system",
  t: (key, vars) => translate(FALLBACK, key, vars),
  choose: () => {},
});

/** Provides the language and `t` to the app, and keeps `<html lang>` in step. */
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
  const value = useMemo<I18n>(
    () => ({ language, choice, t: (key, vars) => translate(language, key, vars), choose: onChoose }),
    [language, choice, onChoose],
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Purpose: the current language, the person's choice and the translate function. */
export function useI18n(): I18n {
  return useContext(Ctx);
}

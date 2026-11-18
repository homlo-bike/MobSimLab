import { useSyncExternalStore } from "react";

/** The theme a person picks in App settings: follow the device ("auto"), or always light or dark. */
export type ThemeChoice = "auto" | "light" | "dark";

const STORAGE_KEY = "mobsimlab.theme";
const QUERY = "(prefers-color-scheme: dark)";

/** Purpose: the choice last used in this browser, so the page opens in it before the account has loaded. */
export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function deviceDark(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(QUERY).matches);
}

let choice: ThemeChoice = "auto";
let listening = false;
const listeners = new Set<() => void>();

function apply(): void {
  const dark = choice === "dark" || (choice === "auto" && deviceDark());
  const scheme = dark ? "dark" : "light";
  const html = document.documentElement;
  if (html.classList.contains("dark") === dark && html.style.colorScheme === scheme) return;
  html.classList.toggle("dark", dark);
  html.style.colorScheme = scheme;
  for (const l of listeners) l();
}

/**
 * Purpose: use a theme choice on this page and remember it in this browser.
 * Side effects: sets the `dark` class and `color-scheme` on `<html>`; with "auto", follows the device as it
 * changes; tells the maps, diagrams and charts that draw their own colours.
 */
export function setTheme(next: ThemeChoice): void {
  choice = next;
  try {
    if (next === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: the account's choice still applies once it has loaded.
  }
  if (!listening && typeof window !== "undefined" && window.matchMedia) {
    listening = true;
    window.matchMedia(QUERY).addEventListener?.("change", () => {
      if (choice === "auto") apply();
    });
  }
  apply();
}

/** Purpose: whether the page is dark now. */
export function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Purpose: whether the page is dark, for parts that draw their own colours (maps, diagrams, charts). */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

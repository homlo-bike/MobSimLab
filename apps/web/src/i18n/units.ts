/**
 * Unit symbols in the app language.
 *
 * Numbers with units are built in code ("240 s", "12 min") and by the engines. In a language written in
 * another script (Arabic, Russian, Hindi...) a Latin "s" or "min" inside a sentence reads as untranslated,
 * so there the symbol comes from the language's own (CLDR) short unit names. Latin-script languages keep the
 * international symbols, as their translations do.
 */
import { activeLanguage } from "./i18n";

/** The symbols the code writes, with their CLDR unit names. */
const UNITS = {
  s: "second",
  min: "minute",
  h: "hour",
  m: "meter",
  km: "kilometer",
  "km/h": "kilometer-per-hour",
  mm: "millimeter",
  "m/s": "meter-per-second",
} as const;

export type UnitSymbol = keyof typeof UNITS;

/** Languages not written in Latin script: their unit symbols follow the language. */
const OWN_SCRIPT = new Set([
  "ar",
  "fa",
  "ur",
  "ru",
  "uk",
  "kk",
  "hi",
  "bn",
  "mr",
  "te",
  "ta",
  "am",
  "zh",
  "ja",
  "ko",
]);

/** Where the language's translators chose a shorter symbol than CLDR's, theirs wins. */
const PREFERRED: Record<string, Partial<Record<UnitSymbol, string>>> = {
  ar: { m: "# م", mm: "# مم" },
};

const templates = new Map<string, string | null>();

/**
 * Purpose: "# د" for minutes in Arabic, with # where the number goes.
 * Output: null when the language keeps the Latin symbol (Latin script, or no own symbol for this unit).
 */
function template(lang: string, unit: UnitSymbol): string | null {
  const id = `${lang}|${unit}`;
  if (templates.has(id)) return templates.get(id) ?? null;
  let out: string | null = null;
  if (OWN_SCRIPT.has(lang)) {
    out = PREFERRED[lang]?.[unit] ?? null;
    if (out === null) {
      try {
        const text = new Intl.NumberFormat(lang, {
          style: "unit",
          unit: UNITS[unit],
          unitDisplay: "short",
          numberingSystem: "latn",
        }).format(12.5);
        const t = text.replace(/12[.,٫]5/, "#").replace(/[‎‏]/g, "");
        // A Latin symbol (such as "km/h" in Persian) is no better than the one we have.
        out = t.includes("#") && !/[A-Za-z]/.test(t) ? t : null;
      } catch {
        out = null;
      }
    }
  }
  templates.set(id, out);
  return out;
}

/** Purpose: a number with its unit in a language, such as "240 ث" in Arabic; the number is kept as written. */
export function unitIn(lang: string, value: string | number, unit: UnitSymbol): string {
  const t = template(lang, unit);
  return t === null ? `${value} ${unit}` : t.replace("#", String(value));
}

/** Purpose: a number with its unit in the language shown now. */
export function withUnit(value: string | number, unit: UnitSymbol): string {
  return unitIn(activeLanguage(), value, unit);
}

const SYMBOLS = /(\d(?:[\d.,:]*\d)?) (km\/h|m\/s|min|mm|km|s|h|m)(?![\p{L}\p{N}/²³])/gu;

/** Purpose: every "number unit" in a text (such as an engine's "240 s") with the language's unit symbol. */
export function localizeUnits(lang: string, text: string): string {
  if (!OWN_SCRIPT.has(lang)) return text;
  return text.replace(SYMBOLS, (whole, n: string, unit: UnitSymbol) => {
    const t = template(lang, unit);
    return t === null ? whole : t.replace("#", n);
  });
}

/**
 * Translations of the assumption library's notes: the reasoning behind each value and the "Used by" lines, shown
 * in the assumptions report. Each language has a file in ./notes/<tag>.json, downloaded when the report is shown:
 * a short key of the English text → the text in the language. The key is taken from the English text itself, so a
 * note whose English changes shows in English until it is translated again.
 */

/** One language's note texts. */
export interface NoteTexts {
  /** Key of an English "Used by" entry → the entry in the language. */
  usedBy: Record<string, string>;
  /** Key of an English reasoning → the reasoning in the language. */
  rationale: Record<string, string>;
}

const LOADERS = import.meta.glob<NoteTexts>("./notes/*.json", { import: "default" });

const loaded: Record<string, NoteTexts | undefined> = {};

/** Purpose: the key of an English note: FNV-1a (32 bits) of its UTF-16 code units, as 8 hex digits. */
export function noteKey(english: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < english.length; i++) {
    h ^= english.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Purpose: download the note texts of one language once and keep them.
 * Output: resolves when they are there (at once for English or a language without a file).
 */
export function loadNoteTexts(tag: string): Promise<void> {
  if (loaded[tag]) return Promise.resolve();
  const load = LOADERS[`./notes/${tag}.json`];
  if (!load) return Promise.resolve();
  return load().then((texts) => {
    loaded[tag] = texts;
  });
}

/** Purpose: a "Used by" entry in a language, or the English one without a translation. */
export function usedByText(tag: string, english: string): string {
  return (english && loaded[tag]?.usedBy[noteKey(english)]) || english;
}

/** Purpose: a value's reasoning in a language, or the English one without a translation. */
export function rationaleText(tag: string, english: string): string {
  return (english && loaded[tag]?.rationale[noteKey(english)]) || english;
}

import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (mr). */
export const resultsMr = {
  "results.saved": "प्रकल्पासोबत जतन केले.",
  "results.savedAt": "प्रकल्पासोबत जतन केले, {when} रोजी गणना केली.",
  "results.stale": "कालबाह्य: गणनेनंतर ज्यावर हे अवलंबून आहे त्यात बदल झाला आहे.",
  "results.staleAt": "कालबाह्य: {when} रोजीच्या गणनेनंतर ज्यावर हे अवलंबून आहे त्यात बदल झाला आहे.",
  "results.recalculate": "पुन्हा गणना करा",
  "results.recalculating": "पुन्हा गणना होत आहे…",
  "results.saveFailed": "प्रकल्पासोबत जतन करता आले नाही: {error}",
} satisfies ResultsMessages;

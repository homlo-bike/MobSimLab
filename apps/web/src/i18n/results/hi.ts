import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (hi). */
export const resultsHi = {
  "results.saved": "प्रोजेक्ट के साथ सहेजा गया।",
  "results.savedAt": "प्रोजेक्ट के साथ सहेजा गया, {when} को गणना की गई।",
  "results.stale": "पुराना: गणना के बाद से जिस पर यह निर्भर है उसमें बदलाव हुआ है।",
  "results.staleAt": "पुराना: {when} की गणना के बाद से जिस पर यह निर्भर है उसमें बदलाव हुआ है।",
  "results.recalculate": "फिर से गणना करें",
  "results.recalculating": "फिर से गणना हो रही है…",
  "results.saveFailed": "प्रोजेक्ट के साथ सहेजा नहीं जा सका: {error}",
} satisfies ResultsMessages;

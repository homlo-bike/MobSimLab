import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (am). */
export const resultsAm = {
  "results.saved": "ከፕሮጀክቱ ጋር ተቀምጧል።",
  "results.savedAt": "ከፕሮጀክቱ ጋር ተቀምጧል፣ በ{when} ተሰልቷል።",
  "results.stale": "ጊዜው ያለፈበት፡ ከተሰላ በኋላ የሚመሠረትበት ነገር ተቀይሯል።",
  "results.staleAt": "ጊዜው ያለፈበት፡ በ{when} ከተሰላ በኋላ የሚመሠረትበት ነገር ተቀይሯል።",
  "results.recalculate": "እንደገና አስላ",
  "results.recalculating": "እንደገና በማስላት ላይ…",
  "results.saveFailed": "ከፕሮጀክቱ ጋር ማስቀመጥ አልተቻለም፡ {error}",
} satisfies ResultsMessages;

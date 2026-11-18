import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (de). */
export const resultsDe = {
  "results.saved": "Mit dem Projekt gespeichert.",
  "results.savedAt": "Mit dem Projekt gespeichert, berechnet am {when}.",
  "results.stale": "Veraltet: Etwas, wovon es abhängt, hat sich seit der Berechnung geändert.",
  "results.staleAt": "Veraltet: Etwas, wovon es abhängt, hat sich seit der Berechnung am {when} geändert.",
  "results.recalculate": "Neu berechnen",
  "results.recalculating": "Wird neu berechnet…",
  "results.saveFailed": "Konnte nicht mit dem Projekt gespeichert werden: {error}",
} satisfies ResultsMessages;

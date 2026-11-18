import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (it). */
export const resultsIt = {
  "results.saved": "Salvato con il progetto.",
  "results.savedAt": "Salvato con il progetto, calcolato il {when}.",
  "results.stale": "Non aggiornato: qualcosa da cui dipende è cambiato dopo il calcolo.",
  "results.staleAt": "Non aggiornato: qualcosa da cui dipende è cambiato dopo il calcolo del {when}.",
  "results.recalculate": "Ricalcola",
  "results.recalculating": "Ricalcolo in corso…",
  "results.saveFailed": "Impossibile salvarlo con il progetto: {error}",
} satisfies ResultsMessages;

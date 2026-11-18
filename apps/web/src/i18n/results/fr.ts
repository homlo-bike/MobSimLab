import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (fr). */
export const resultsFr = {
  "results.saved": "Enregistré avec le projet.",
  "results.savedAt": "Enregistré avec le projet, calculé le {when}.",
  "results.stale": "Obsolète : un élément dont il dépend a changé depuis son calcul.",
  "results.staleAt": "Obsolète : un élément dont il dépend a changé depuis son calcul le {when}.",
  "results.recalculate": "Recalculer",
  "results.recalculating": "Recalcul en cours…",
  "results.saveFailed": "Impossible de l’enregistrer avec le projet : {error}",
} satisfies ResultsMessages;

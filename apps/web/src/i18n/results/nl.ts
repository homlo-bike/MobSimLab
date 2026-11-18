import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (nl). */
export const resultsNl = {
  "results.saved": "Opgeslagen bij het project.",
  "results.savedAt": "Opgeslagen bij het project, berekend op {when}.",
  "results.stale": "Verouderd: iets waarvan het afhangt is gewijzigd sinds de berekening.",
  "results.staleAt": "Verouderd: iets waarvan het afhangt is gewijzigd sinds de berekening op {when}.",
  "results.recalculate": "Opnieuw berekenen",
  "results.recalculating": "Wordt opnieuw berekend…",
  "results.saveFailed": "Kon niet bij het project worden opgeslagen: {error}",
} satisfies ResultsMessages;

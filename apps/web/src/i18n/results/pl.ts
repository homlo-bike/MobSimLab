import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (pl). */
export const resultsPl = {
  "results.saved": "Zapisano z projektem.",
  "results.savedAt": "Zapisano z projektem, obliczono {when}.",
  "results.stale": "Nieaktualne: od obliczenia zmieniło się coś, od czego to zależy.",
  "results.staleAt": "Nieaktualne: od obliczenia {when} zmieniło się coś, od czego to zależy.",
  "results.recalculate": "Przelicz ponownie",
  "results.recalculating": "Przeliczanie…",
  "results.saveFailed": "Nie udało się zapisać z projektem: {error}",
} satisfies ResultsMessages;

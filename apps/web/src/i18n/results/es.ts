import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (es). */
export const resultsEs = {
  "results.saved": "Guardado con el proyecto.",
  "results.savedAt": "Guardado con el proyecto, calculado el {when}.",
  "results.stale": "Desactualizado: algo de lo que depende ha cambiado desde que se calculó.",
  "results.staleAt": "Desactualizado: algo de lo que depende ha cambiado desde que se calculó el {when}.",
  "results.recalculate": "Recalcular",
  "results.recalculating": "Recalculando…",
  "results.saveFailed": "No se pudo guardar con el proyecto: {error}",
} satisfies ResultsMessages;

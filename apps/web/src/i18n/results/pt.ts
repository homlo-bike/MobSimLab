import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (pt). */
export const resultsPt = {
  "results.saved": "Guardado com o projeto.",
  "results.savedAt": "Guardado com o projeto, calculado em {when}.",
  "results.stale": "Desatualizado: algo de que depende mudou desde que foi calculado.",
  "results.staleAt": "Desatualizado: algo de que depende mudou desde que foi calculado em {when}.",
  "results.recalculate": "Recalcular",
  "results.recalculating": "A recalcular…",
  "results.saveFailed": "Não foi possível guardar com o projeto: {error}",
} satisfies ResultsMessages;

import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (ru). */
export const resultsRu = {
  "results.saved": "Сохранено в проекте.",
  "results.savedAt": "Сохранено в проекте, рассчитано {when}.",
  "results.stale": "Устарело: с момента расчёта изменилось то, от чего это зависит.",
  "results.staleAt": "Устарело: с момента расчёта {when} изменилось то, от чего это зависит.",
  "results.recalculate": "Пересчитать",
  "results.recalculating": "Пересчёт…",
  "results.saveFailed": "Не удалось сохранить в проекте: {error}",
} satisfies ResultsMessages;

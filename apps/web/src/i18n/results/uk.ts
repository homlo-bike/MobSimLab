import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (uk). */
export const resultsUk = {
  "results.saved": "Збережено разом із проєктом.",
  "results.savedAt": "Збережено разом із проєктом, обчислено {when}.",
  "results.stale": "Застаріло: відтоді, як це обчислено, змінилося те, від чого воно залежить.",
  "results.staleAt": "Застаріло: відтоді, як це обчислено {when}, змінилося те, від чого воно залежить.",
  "results.recalculate": "Перерахувати",
  "results.recalculating": "Перерахунок…",
  "results.saveFailed": "Не вдалося зберегти разом із проєктом: {error}",
} satisfies ResultsMessages;

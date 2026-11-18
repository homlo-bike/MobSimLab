/**
 * English messages for calculated results saved with the project (apps/web/src/projects/SavedResultNotice.tsx):
 * when a result was worked out, whether it is out of date, and recalculating it. Merged into each language's
 * dictionary like the editor messages; every language has its own file next to this one.
 */
export const resultsEn = {
  "results.saved": "Saved with the project.",
  "results.savedAt": "Saved with the project, worked out {when}.",
  "results.stale": "Out of date: something it depends on has changed since it was worked out.",
  "results.staleAt": "Out of date: something it depends on has changed since it was worked out {when}.",
  "results.recalculate": "Recalculate",
  "results.recalculating": "Recalculating…",
  "results.saveFailed": "Could not be saved with the project: {error}",
};

export type ResultsMessages = Record<keyof typeof resultsEn, string>;

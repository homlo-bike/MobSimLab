import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (id). */
export const resultsId = {
  "results.saved": "Disimpan bersama proyek.",
  "results.savedAt": "Disimpan bersama proyek, dihitung pada {when}.",
  "results.stale": "Kedaluwarsa: sesuatu yang menjadi dasarnya telah berubah sejak dihitung.",
  "results.staleAt": "Kedaluwarsa: sesuatu yang menjadi dasarnya telah berubah sejak dihitung pada {when}.",
  "results.recalculate": "Hitung ulang",
  "results.recalculating": "Menghitung ulang…",
  "results.saveFailed": "Tidak dapat disimpan bersama proyek: {error}",
} satisfies ResultsMessages;

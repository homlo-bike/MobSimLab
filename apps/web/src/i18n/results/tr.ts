import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (tr). */
export const resultsTr = {
  "results.saved": "Projeyle birlikte kaydedildi.",
  "results.savedAt": "Projeyle birlikte kaydedildi, {when} tarihinde hesaplandı.",
  "results.stale": "Güncel değil: hesaplandığından beri bağlı olduğu bir şey değişti.",
  "results.staleAt": "Güncel değil: {when} tarihinde hesaplandığından beri bağlı olduğu bir şey değişti.",
  "results.recalculate": "Yeniden hesapla",
  "results.recalculating": "Yeniden hesaplanıyor…",
  "results.saveFailed": "Projeyle birlikte kaydedilemedi: {error}",
} satisfies ResultsMessages;

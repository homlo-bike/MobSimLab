import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (ja). */
export const resultsJa = {
  "results.saved": "プロジェクトに保存済み。",
  "results.savedAt": "プロジェクトに保存済み（{when} に計算）。",
  "results.stale": "古くなっています：計算後に依存する内容が変更されました。",
  "results.staleAt": "古くなっています：{when} の計算後に依存する内容が変更されました。",
  "results.recalculate": "再計算",
  "results.recalculating": "再計算中…",
  "results.saveFailed": "プロジェクトに保存できませんでした：{error}",
} satisfies ResultsMessages;

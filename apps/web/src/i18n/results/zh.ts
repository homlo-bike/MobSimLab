import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (zh). */
export const resultsZh = {
  "results.saved": "已随项目保存。",
  "results.savedAt": "已随项目保存，计算于 {when}。",
  "results.stale": "已过时：计算后，其依赖的内容已更改。",
  "results.staleAt": "已过时：自 {when} 计算后，其依赖的内容已更改。",
  "results.recalculate": "重新计算",
  "results.recalculating": "正在重新计算…",
  "results.saveFailed": "无法随项目保存：{error}",
} satisfies ResultsMessages;

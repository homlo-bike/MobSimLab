import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (ko). */
export const resultsKo = {
  "results.saved": "프로젝트와 함께 저장됨.",
  "results.savedAt": "프로젝트와 함께 저장됨, {when}에 계산됨.",
  "results.stale": "오래됨: 계산 이후 의존하는 항목이 변경되었습니다.",
  "results.staleAt": "오래됨: {when}에 계산된 이후 의존하는 항목이 변경되었습니다.",
  "results.recalculate": "다시 계산",
  "results.recalculating": "다시 계산하는 중…",
  "results.saveFailed": "프로젝트와 함께 저장할 수 없습니다: {error}",
} satisfies ResultsMessages;

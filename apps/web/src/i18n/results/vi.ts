import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (vi). */
export const resultsVi = {
  "results.saved": "Đã lưu cùng dự án.",
  "results.savedAt": "Đã lưu cùng dự án, tính lúc {when}.",
  "results.stale": "Đã lỗi thời: điều mà nó phụ thuộc đã thay đổi kể từ khi tính.",
  "results.staleAt": "Đã lỗi thời: điều mà nó phụ thuộc đã thay đổi kể từ khi tính lúc {when}.",
  "results.recalculate": "Tính lại",
  "results.recalculating": "Đang tính lại…",
  "results.saveFailed": "Không thể lưu cùng dự án: {error}",
} satisfies ResultsMessages;

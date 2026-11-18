import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (ar). */
export const resultsAr = {
  "results.saved": "محفوظ مع المشروع.",
  "results.savedAt": "محفوظ مع المشروع، حُسب في {when}.",
  "results.stale": "قديم: تغيّر شيء يعتمد عليه منذ حسابه.",
  "results.staleAt": "قديم: تغيّر شيء يعتمد عليه منذ حسابه في {when}.",
  "results.recalculate": "إعادة الحساب",
  "results.recalculating": "جارٍ إعادة الحساب…",
  "results.saveFailed": "تعذّر الحفظ مع المشروع: {error}",
} satisfies ResultsMessages;

import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (bn). */
export const resultsBn = {
  "results.saved": "প্রকল্পের সাথে সংরক্ষিত।",
  "results.savedAt": "প্রকল্পের সাথে সংরক্ষিত, {when} তারিখে গণনা করা হয়েছে।",
  "results.stale": "পুরনো: গণনার পর থেকে এটি যার উপর নির্ভর করে তা বদলেছে।",
  "results.staleAt": "পুরনো: {when} তারিখের গণনার পর থেকে এটি যার উপর নির্ভর করে তা বদলেছে।",
  "results.recalculate": "আবার গণনা করুন",
  "results.recalculating": "আবার গণনা হচ্ছে…",
  "results.saveFailed": "প্রকল্পের সাথে সংরক্ষণ করা যায়নি: {error}",
} satisfies ResultsMessages;

import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (bn). */
export const pluginCodeBn = {
  "pcode.title": "প্লাগইন গণনা",
  "pcode.intro":
    "ইনস্টল করা প্লাগইনের গণনা। এগুলো আপনার ব্রাউজারে একটি স্যান্ডবক্সে চলে, ইন্টারনেট বা অন্য প্রকল্পে প্রবেশ ছাড়াই।",
  "pcode.by": "{plugin} · {publisher}-এর",
  "pcode.run": "গণনা করুন",
  "pcode.running": "গণনা চলছে…",
  "pcode.failed": "{plugin} গণনা করতে পারেনি: {error}",
  "pcode.noRows": "কোনো সারি নেই।",
  "pcode.log": "প্লাগইন লগ ({count} লাইন)",
  "pcode.import": "{label} ইমপোর্ট করুন ({plugin})",
  "pcode.export": "{label} হিসেবে ডাউনলোড করুন ({plugin})",
  "pcode.importFailed": "{plugin} ফাইলটি পড়তে পারেনি: {error}",
  "pcode.exportFailed": "{plugin} ফাইলটি লিখতে পারেনি: {error}",
  "pcode.frameTitle": "{tab}, {plugin} প্লাগইনের একটি পাতা",
  "pcode.frameNote":
    "এই পাতাটি {publisher}-এর {plugin} প্লাগইন থেকে এসেছে। এটি ইন্টারনেট বা আপনার অ্যাকাউন্টে পৌঁছাতে পারে না।",
  "pcode.runsCode": "নিজের কোড স্যান্ডবক্সে চালায়",
  "pcode.limits": "প্লাগইন কোডের সীমা",
  "pcode.limitsIntro": "প্লাগইন কোডের প্রতিটি কল ব্রাউজারে ও সার্ভারে সর্বোচ্চ এতটা মেমরি ও সময় পায়।",
  "pcode.memory": "মেমরি (MB)",
  "pcode.time": "সময় (সেকেন্ড)",
  "pcode.saveLimits": "সীমা সংরক্ষণ করুন",
  "pcode.saved": "সংরক্ষিত।",
  "pcode.installIntro":
    "একটি .msplugin ফাইল আপলোড করুন। MobSimLab এটি যাচাই করে এবং ইনস্টলের আগে দেখায় এটি কী যোগ করে। প্লাগইন পরিবহন মাধ্যম, টুল, প্যারামিটার ও উৎস যোগ করতে পারে এবং নিজের কোড (গণনা, ইমপোর্ট, এক্সপোর্ট ও ট্যাব পাতা) ইন্টারনেট ছাড়া স্যান্ডবক্সে চালাতে পারে।",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "প্রতি পিক্সেলে প্রায় ০.৩ থেকে ১ মিটারের আকাশচিত্র। Esri-র জন্য ArcGIS Location Platform অ্যাকাউন্টের ArcGIS API কী এবং শর্তে সম্মতি লাগে। টাইলগুলো এই MobSimLab হয়ে আসে, তাই ব্রাউজার কখনো কী দেখে না, আর টাইল সংরক্ষিত হয় না।",
  "esri.key": "ArcGIS API কী",
  "esri.accept": "আমি এই MobSimLab-এর জন্য Esri-র ব্যবহারের শর্ত মেনে নিচ্ছি",
  "esri.terms": "Esri-র শর্ত",
  "esri.save": "কী সংরক্ষণ করুন",
  "esri.remove": "কী সরান",
  "esri.saved":
    "{end} দিয়ে শেষ হওয়া কী {name} {date}-এ সংরক্ষণ করেছেন। মানচিত্রের স্তর নিয়ন্ত্রণে Esri World Imagery পাওয়া যাচ্ছে।",
  "esri.none": "কোনো কী সংরক্ষিত নেই: Esri World Imagery দেওয়া হচ্ছে না।",
} satisfies PluginCodeMessages;

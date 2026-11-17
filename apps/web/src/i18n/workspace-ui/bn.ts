import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (bn). */
export const workspaceUiBn = {
  "checks.menu": "পরীক্ষা",
  "checks.menuCount": "পরীক্ষা: {errors}টি ত্রুটি, {warnings}টি সতর্কতা",
  "checks.title": "সব মোডের পরীক্ষা",
  "checks.none": "এখনও পরীক্ষার কিছু নেই। একটি লাইন, রেলপথ বা ডিপো আঁকুন, তার পরীক্ষাগুলো এখানে দেখা যাবে।",
  "checks.lastOpened": "শেষবার খোলার সময়ের মতো",
  "checks.streetLine": "সড়ক লাইন · {name}",
  "checks.railway": "রেলপথ",
  "checks.depot": "ডিপো · {name}",
  "undo.undo": "পূর্বাবস্থায় ফেরান",
  "undo.redo": "আবার করুন",
  "tour.checks.title": "পরীক্ষা",
  "tour.checks.body":
    "ঘণ্টাটি সব মোডের পরীক্ষা দেখায়, আগে ত্রুটি: সড়ক লাইন, রেলপথ, ডিপো এবং প্লাগইনের লাইন। কোথায় আছে দেখতে একটি বেছে নিন।",
  "settings.serverTab": "সার্ভার",
  "settings.pluginsTab": "প্লাগইন",
  "settings.server.local":
    "MobSimLab এই কম্পিউটারে চলছে। এর বদলে আপনি এই অ্যাপটিকে পটভূমিতে চলা একটি MobSimLab সার্ভারের সঙ্গে যুক্ত করতে পারেন, যেমন Docker সার্ভার।",
  "settings.server.address": "সার্ভারের ঠিকানা",
  "settings.server.connect": "যুক্ত করুন",
  "settings.server.note":
    "অ্যাপটি সার্ভার পরীক্ষা করে এবং বদলানোর আগে জিজ্ঞেস করে। এই কম্পিউটারের প্রকল্পগুলো এখানেই থাকে: সেগুলো .mslab ফাইল হিসেবে সংরক্ষণ করে সরান। অ্যাপের সেটিংসে (⌘, বা Ctrl+,) ফিরে যেতে পারেন।",
  "settings.plugins.intro":
    "এই MobSimLab-এর জন্য প্লাগইন ইনস্টল করুন। তারপর প্রতিটি প্রকল্প তার প্রকল্প পছন্দে সেগুলো চালু বা বন্ধ করে।",
} satisfies WorkspaceUiMessages;

import type { PluginKey } from "../plugins";

/** Plugin messages (bn). */
export const pluginsBn = {
  "admin.plugins": "প্লাগইন",
  "plugins.title": "প্লাগইন",
  "plugins.intro":
    "প্লাগইন পরিবহন মাধ্যম, টুল ও গণনা যোগ করে। এই প্রকল্প যেগুলো ব্যবহার করে সেগুলো চালু করুন; বন্ধ করলে টুল লুকিয়ে যায় এবং আঁকা কাজ থেকে যায়।",
  "plugins.bundled": "MobSimLab-এর সঙ্গে আসে",
  "plugins.by": "প্রকাশক: {publisher}",
  "plugins.versionN": "সংস্করণ {version}",
  "plugins.adds": "যোগ করে: {list}",
  "plugins.uses": "ব্যবহার করে: {list}",
  "plugins.parameters": "{count}টি অনুমান মান",
  "plugins.missing":
    "সংস্করণ {version} এই MobSimLab থেকে সরানো হয়েছে। আবার ব্যবহার করতে অন্য সংস্করণ বেছে নিন।",
  "plugins.versionOf": "{name}-এর সংস্করণ",
  "plugins.useIn": "এই প্রকল্পে {name} ব্যবহার করুন",
  "plugins.ownerOnly": "শুধু প্রকল্পের মালিক প্লাগইন চালু বা বন্ধ করতে পারেন।",
  "plugins.perm.readNetwork": "প্রকল্পের নেটওয়ার্ক",
  "plugins.perm.readTimetable": "সময়সূচি",
  "plugins.perm.readFleet": "যানবাহন ও বহর",
  "plugins.perm.readGeodata": "আমদানি করা মানচিত্র ডেটা",
  "plugins.perm.readResults": "সিমুলেশনের ফলাফল",
  "plugins.perm.writeResults": "নিজের ফলাফল সংরক্ষণ করে",
  "plugins.perm.writeScenario": "পরিস্থিতিতে পরিবর্তন প্রস্তাব করে",
  "plugins.installTitle": "প্লাগইন ইনস্টল করুন",
  "plugins.installIntro":
    ".msplugin ফাইল আপলোড করুন। MobSimLab সেটি যাচাই করে এবং ইনস্টলের আগে দেখায় এটি কী যোগ করে। ইনস্টল করা প্লাগইন মাধ্যম, টুল, প্যারামিটার ও উৎস যোগ করতে পারে; নিজস্ব কোডসহ প্লাগইন পরে আসবে।",
  "plugins.choose": ".msplugin ফাইল বেছে নিন",
  "plugins.problems": "এই প্লাগইন ইনস্টল করা যাবে না:",
  "plugins.install": "ইনস্টল করুন",
  "plugins.installed": "ইনস্টল করা প্লাগইন",
  "plugins.none": "এখনও কোনো প্লাগইন ইনস্টল নেই।",
  "plugins.removeOne": "{name} {version} সরান",
  "plugins.inProjects": "{count}টি প্রকল্পে ব্যবহৃত",
  "plugins.bundledTitle": "MobSimLab-এর সঙ্গে আসা",
  "plugins.keys": "বিশ্বস্ত প্রকাশক",
  "plugins.keysIntro":
    "প্রকাশক এই কীগুলোর একটি দিয়ে স্বাক্ষর করলে তবেই প্লাগইন ইনস্টল হয় (ECDSA P-256 বা Ed25519, PEM)।",
  "plugins.noKeys": "এখনও কোনো বিশ্বস্ত কী নেই।",
  "plugins.removeKey": "{name}-এর ওপর আস্থা তুলে নিন",
  "plugins.addKey": "কী যোগ করুন",
  "plugins.keyName": "প্রকাশকের নাম",
  "plugins.keyPem": "পাবলিক কী",
  "plugins.allowUnsigned": "স্বাক্ষরহীন প্লাগইনের অনুমতি (ডেভেলপমেন্ট মোড, শুধু মালিক)",
  "plugins.signedBy": "স্বাক্ষর করেছেন {name}",
  "plugins.untrusted": "এমন কী দিয়ে স্বাক্ষরিত যাতে এই ইনস্ট্যান্স আস্থা রাখে না",
  "plugins.unsigned": "স্বাক্ষরহীন",
  "plugins.licences": "লাইসেন্স: কোড {code}, ডেটা {data}",
  "plugins.removeConfirm":
    "{name} {count}টি প্রকল্পে চালু। তবুও সরাবেন? সেখানে এটি বন্ধ হবে এবং আঁকা থেকে যাবে।",
} satisfies Record<PluginKey, string>;

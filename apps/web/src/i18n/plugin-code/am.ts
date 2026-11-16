import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (am). */
export const pluginCodeAm = {
  "pcode.title": "የተሰኪ ስሌቶች",
  "pcode.intro": "የተጫኑ ተሰኪዎች ስሌቶች። በአሳሽዎ ውስጥ በተገለለ አካባቢ ይሄዳሉ፣ ኢንተርኔትን ወይም ሌሎች ፕሮጀክቶችን ሳይደርሱ።",
  "pcode.by": "{plugin} · በ{publisher}",
  "pcode.run": "አስላ",
  "pcode.running": "በማስላት ላይ…",
  "pcode.failed": "{plugin} ማስላት አልቻለም፦ {error}",
  "pcode.noRows": "ምንም ረድፍ የለም።",
  "pcode.log": "የተሰኪ ምዝግብ ({count} መስመሮች)",
  "pcode.import": "{label} አስመጣ ({plugin})",
  "pcode.export": "እንደ {label} አውርድ ({plugin})",
  "pcode.importFailed": "{plugin} ፋይሉን ማንበብ አልቻለም፦ {error}",
  "pcode.exportFailed": "{plugin} ፋይሉን መጻፍ አልቻለም፦ {error}",
  "pcode.frameTitle": "{tab}፣ የ{plugin} ተሰኪ ገጽ",
  "pcode.frameNote": "ይህ ገጽ ከ{publisher} {plugin} ተሰኪ የመጣ ነው። ኢንተርኔትን ወይም መለያዎን መድረስ አይችልም።",
  "pcode.runsCode": "የራሱን ኮድ በተገለለ አካባቢ ያስኬዳል",
  "pcode.limits": "የተሰኪ ኮድ ገደቦች",
  "pcode.limitsIntro": "እያንዳንዱ የተሰኪ ኮድ ጥሪ በአሳሹም በአገልጋዩም ቢበዛ ይህን ያህል ማህደረ ትውስታና ጊዜ ያገኛል።",
  "pcode.memory": "ማህደረ ትውስታ (MB)",
  "pcode.time": "ጊዜ (ሰከንዶች)",
  "pcode.saveLimits": "ገደቦችን አስቀምጥ",
  "pcode.saved": "ተቀምጧል።",
  "pcode.installIntro":
    "የ.msplugin ፋይል ይስቀሉ። MobSimLab ይፈትሸዋል፣ ከመጫኑ በፊትም ምን እንደሚጨምር ያሳያል። ተሰኪዎች የትራንስፖርት ዘዴዎችን፣ መሣሪያዎችን፣ መለኪያዎችንና ምንጮችን ሊጨምሩ፣ የራሳቸውንም ኮድ (ስሌቶች፣ ማስመጣት፣ መላክና የትር ገጾች) ኢንተርኔት በሌለው የተገለለ አካባቢ ሊያስኬዱ ይችላሉ።",
} satisfies PluginCodeMessages;

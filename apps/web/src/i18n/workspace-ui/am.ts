import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (am). */
export const workspaceUiAm = {
  "checks.menu": "ፍተሻዎች",
  "checks.menuCount": "ፍተሻዎች፦ {errors} ስህተቶች፣ {warnings} ማስጠንቀቂያዎች",
  "checks.title": "የሁሉም ሁነታዎች ፍተሻዎች",
  "checks.none": "ገና የሚፈተሽ የለም። መስመር፣ የባቡር ሐዲድ ወይም ዴፖ ይሳሉ፣ ፍተሻዎቹ እዚህ ይታያሉ።",
  "checks.lastOpened": "ለመጨረሻ ጊዜ ሲከፈት እንደነበረው",
  "checks.streetLine": "የመንገድ መስመር · {name}",
  "checks.railway": "የባቡር ሐዲድ",
  "checks.depot": "ዴፖ · {name}",
  "undo.undo": "ቀልብስ",
  "undo.redo": "ድገም",
  "tour.checks.title": "ፍተሻዎች",
  "tour.checks.body":
    "ደወሉ የሁሉንም ሁነታዎች ፍተሻዎች ይዘረዝራል፣ ስህተቶች መጀመሪያ፦ የመንገድ መስመሮች፣ የባቡር ሐዲድ፣ ዴፖዎች እና የተሰኪዎች መስመሮች። የት እንዳለ ለማየት አንዱን ይምረጡ።",
  "settings.serverTab": "አገልጋይ",
  "settings.pluginsTab": "ተሰኪዎች",
  "settings.server.local":
    "MobSimLab በዚህ ኮምፒውተር ላይ እየሰራ ነው። በምትኩ ይህን መተግበሪያ ከበስተጀርባ ከሚሰራ የMobSimLab አገልጋይ፣ ለምሳሌ ከDocker አገልጋይ ጋር ማገናኘት ይችላሉ።",
  "settings.server.address": "የአገልጋይ አድራሻ",
  "settings.server.connect": "አገናኝ",
  "settings.server.note":
    "መተግበሪያው አገልጋዩን ይፈትሻል እና ከመቀየሩ በፊት ይጠይቃል። በዚህ ኮምፒውተር ላይ ያሉ ፕሮጀክቶች እዚህ ይቆያሉ፦ እንደ .mslab ፋይሎች በማስቀመጥ ያንቀሳቅሷቸው። በመተግበሪያው ቅንብሮች (⌘, ወይም Ctrl+,) ውስጥ መመለስ ይችላሉ።",
  "settings.plugins.intro": "ለዚህ MobSimLab ተሰኪዎችን ይጫኑ። ከዚያ እያንዳንዱ ፕሮጀክት በፕሮጀክት ምርጫዎቹ ውስጥ ያበራቸዋል ወይም ያጠፋቸዋል።",
} satisfies WorkspaceUiMessages;

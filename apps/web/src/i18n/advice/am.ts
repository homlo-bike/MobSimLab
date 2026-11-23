import type { AdviceMessages } from "./en";

/** Advice messages (am). */
export const adviceAm = {
  "advice.title": "ምን ማሻሻል ይቻላል",
  "advice.intro": "ይህ ሩጫ ያገኛቸው ችግሮች፣ በጣም ከባዱ መጀመሪያ፣ እና ለእያንዳንዳቸው ምን ማድረግ እንደሚችሉ።",
  "advice.none": "የሚሻሻል ነገር የለም፦ ይህ ሩጫ ምንም ማነቆ ወይም ችግር አላገኘም።",
  "advice.show": "በካርታው ላይ አሳይ",
  "advice.more": "ሌሎች {n} አልታዩም።",
  "advice.severity.problem": "ችግር",
  "advice.severity.warning": "ማስጠንቀቂያ",
  "advice.crowdMap": "ተሽከርካሪዎች ምን ያህል እንደሞሉ በካርታው ላይ አሳይ (የእያንዳንዱ መስመር በጣም የተጨናነቀ ሰዓት)",
  "advice.cap.stopped": "{line}፦ ሩጫው ቆመ፦ {problem}",
  "advice.cap.stoppedFix": "ይህን በባቡር መሣሪያው ውስጥ ያስተካክሉ፣ ከዚያ ሙከራውን እንደገና ያሂዱ።",
  "advice.cap.unplaced": "{line}፦ በሀዲዱ ላይ የማይገቡ ጉዞዎች፦ {n}",
  "advice.cap.unplacedFix":
    "በዚህ ጊዜ መስመሩን ያነሰ ያሂዱ፣ ወይም ባቡሮቹ በሚገናኙበት ቦታ ተጨማሪ ቦታ ይስጡ፦ በ{terminal} ተጨማሪ የመድረክ ሀዲዶች ወይም መሻገሪያዎች፣ ወይም በነጠላ ሀዲድ ላይ የመተላለፊያ ቀለበት።",
  "advice.cap.terminal": "{line}፦ የመጨረሻ ጣቢያ {terminal} ማነቆ ነው፣ በጣም የተጨናነቀው ሰዓት {share} በጥቅም ላይ (ገደብ {limit})",
  "advice.cap.terminalFix":
    "ባቡሮች መድረኮቹን ብዙ ጊዜ ይይዛሉ። መመለሻውን ያሳጥሩ (አጭር ቆይታ፣ ወይም በእያንዳንዱ ጫፍ የሚጠብቅ ሾፌር)፣ የመድረክ ሀዲድ ይጨምሩ፣ ወይም ባቡሮች ቶሎ እንዲለቁት መሻገሪያውን ወደ መድረኮቹ ያቅርቡ።",
  "advice.cap.section": "{line}፦ የሀዲድ ክፍል {section} ማነቆ ነው፣ በጣም የተጨናነቀው ሰዓት {share} በጥቅም ላይ (ገደብ {limit})",
  "advice.cap.sectionFix":
    "ባቡሮች ይህን ክፍል ከማንኛውም ሌላ ክፍል በላይ ይይዛሉ። በውስጡ ከፍ ያለ ፍጥነት ቶሎ እንዲለቁት ያደርጋል፤ አለዚያ እዚህ ጥቂት ባቡሮችን ያሂዱ።",
  "advice.cap.sectionPlatform":
    "ይህ ክፍል የመድረክ ሀዲድ ነው፦ ባቡሮች በመድረኩ ላይ እስከቆሙ ድረስ ይይዙታል። እዚያ አጭር ቆይታ፣ ወይም ለዚህ አቅጣጫ ሁለተኛ የመድረክ ሀዲድ፣ ቀጣዩን ባቡር ቶሎ ያስገባል።",
  "advice.cap.sectionSwitches":
    "ይህ ክፍል የመቀየሪያ አካባቢ ነው፦ በመቀየሪያዎቹ በኩል መንገዳቸው ሲዘጋጅና ሲለቀቅ ባቡሮች ይይዙታል። በሚታጠፈው ቅርንጫፍ ላይ ከፍ ያለ ፍጥነት ያላቸው መቀየሪያዎች፣ ወይም ሁለቱ አቅጣጫዎች እንዳይቋረጡ የተቀመጡ፣ ቶሎ ይለቁታል።",
  "advice.cap.signalAdd":
    "ይህ የክፍት መስመር ክፍል {length} ሜ ርዝመት አለው፣ ነገር ግን በ{speed} ኪሜ/ሰ አንድ ብሎክ {block} ሜ ብቻ ያስፈልገዋል። ቀጣዩ ባቡር ወደ መጀመሪያው ግማሽ ቶሎ እንዲገባ በሀዲድ {track} ላይ በግምት {at} ሜ ላይ የብሎክ ምልክት ይጨምሩ።",
  "advice.cap.signalShort":
    "ይህ ክፍል {length} ሜ ነው፣ በ{speed} ኪሜ/ሰ ከሁለት {block} ሜ ብሎኮች ያነሰ፣ ስለዚህ ሌላ ምልክት ለመቆም በጣም ትንሽ ቦታ ይተዋል። ባቡሮች በካቢን ምልክት (CBTC ወይም ETCS ደረጃ 2)፣ ወይም እዚህ በዝቅተኛ ፍጥነት፣ ይበልጥ ተቀራርበው መከተል ይችላሉ።",
  "advice.cap.sectionCab":
    "በካቢን ምልክት ባቡሮች አስቀድመው በፍሬን ርቀት ({speed} ኪሜ/ሰ ላይ {block} ሜ) ይከተላሉ፤ ክፍተቱን ምልክቶች አይወስኑም። በክፍሉ ከፍ ያለ ፍጥነት፣ ወይም ጥቂት ባቡሮች፣ ቶሎ ይለቁታል።",
  "advice.cap.sectionSight":
    "ትራሞች እዚህ በዕይታ ይሄዳሉ፣ ስለዚህ ክፍተቱን ምልክቶች አይወስኑም። በአቅራቢያ አጭር ቆይታዎች፣ ወይም ከመንገድ ትራፊክ የራቀ የራሳቸው ሀዲድ፣ ቶሎ ይለቁታል።",
  "advice.cap.nearNote": "አሁንም ይሠራል፣ ግን ባቡሮችን ለመጨመር ትንሽ ቦታ ብቻ አለ።",
  "advice.cap.pileUp": "{line}፦ መዘግየቶች ይከማቻሉ እና ጊዜው ሲያልቅ በአማካይ አሁንም {late} ናቸው",
  "advice.cap.pileUpFix": "የዘገየ ባቡር ቀጣዩን እንዳይይዝ በመጨረሻ ጣቢያዎች የማገገሚያ ጊዜ ይጨምሩ፣ ወይም ትንሽ ያነሰ ያሂዱ።",
  "advice.cap.full": "{line}፦ ተሽከርካሪዎች ከ{from} እስከ {to} {share} ሞልተዋል፣ {time}",
  "advice.cap.fullMore":
    "በዚህ ጊዜ {left} ሰዎች ይቀራሉ። ሀዲዱ በእያንዳንዱ አቅጣጫ በሰዓት እስከ {n} ባቡሮች ይፈቅዳል፦ በብዛት ያሂዱ፣ ወይም ረዘም ያሉ ባቡሮችን ይጠቀሙ።",
  "advice.cap.fullLonger": "በዚህ ጊዜ {left} ሰዎች ይቀራሉ። ሀዲዱ ከፈቀደ በብዛት ያሂዱ፣ ወይም ረዘም ያሉ ተሽከርካሪዎችን ይጠቀሙ።",
  "advice.cap.streetPileUp": "{line}፦ መዘግየቶች በመንገድ ላይ ይከማቻሉ እና በመጨረሻ አሁንም {late} ናቸው",
  "advice.cap.streetPileUpFix":
    "ተሽከርካሪዎች እንዲያካክሱ ለዙሩ ተጨማሪ ጊዜ ወይም በመጨረሻ ፌርማታዎች ረዘም ያለ እረፍት ያቅዱ፤ ከትራፊክ ጋር በሚገናኙበት የራሳቸው መስመር በጣም ይረዳል።",
  "advice.road.cannotRun": "{line} መሮጥ አልቻለም",
  "advice.road.cannotRunFix": "{problem}። በፍጠር → የመንገድ መስመር ውስጥ ያስተካክሉ፣ ከዚያ እንደገና ያሂዱ።",
  "advice.road.late": "{line}፦ የመነሻዎቹ {share} ብቻ በሰዓቱ ({limit} በታች ምክር)",
  "advice.road.mostlySignals":
    "እያንዳንዱ ጉዞ በቀይ መብራት {signals} ደቂቃ እና በትራፊክ {traffic} ደቂቃ ያጣል፣ ስለዚህ አብዛኛው እዚህ በተዘረዘሩት የትራፊክ መብራቶች ላይ ነው።",
  "advice.road.mostlyTraffic":
    "እያንዳንዱ ጉዞ በትራፊክ {traffic} ደቂቃ እና በቀይ መብራት {signals} ደቂቃ ያጣል፣ ስለዚህ አብዛኛው እዚህ በተዘረዘሩት መንገዶች ላይ ነው።",
  "advice.road.moreTime": "ዙሩ ከታቀደው {planned} ደቂቃ ይልቅ {run} ደቂቃ ወሰደ፦ ተጨማሪ የጉዞ ጊዜ ያቅዱ፣ ወይም አንድ ተሽከርካሪ ይጨምሩ።",
  "advice.road.bunched": "{line}፦ የመነሻዎቹ {share} ተሰባስበው ይመጣሉ",
  "advice.road.bunchedFix":
    "ተሽከርካሪዎች እርስ በርስ ይደራረሳሉ። በመጨረሻ ፌርማታዎች በሰሌዳው መሠረት ያቆዩዋቸው፣ እዚያ ረዘም ያለ እረፍት ይስጡ፣ ወይም መስመሩ ጊዜ በሚያጣበት የራሱ መስመር ይስጡት።",
  "advice.road.ranOut": "{line}፦ ኃይላቸው ያለቀ ተሽከርካሪዎች፦ {n}",
  "advice.road.ranOutFix": "ትልቅ ባትሪ ይጠቀሙ፣ በመጨረሻ ፌርማታዎች ይሙሉ፣ ወይም በቀን ውስጥ ተሽከርካሪዎችን ይቀያይሩ።",
  "advice.road.stuck": "{line}፦ 5 ደቂቃ ወይም ከዚያ በላይ የተጣበቁ ተሽከርካሪዎች፦ {n}",
  "advice.road.stuckFix":
    "በGIS ትሩ ውስጥ በዚህ ቦታ ያለውን የመንገድ አቀማመጥና የትራፊክ መብራቶች ይመልከቱ፦ መታጠፊያ ሊጎድል ይችላል፣ ወይም ትራፊክ መገናኛውን ዘግቷል።",
  "advice.road.notBack": "{line}፦ በመጨረሻ ወደ ዴፖ ያልተመለሱ ተሽከርካሪዎች፦ {n}",
  "advice.road.notBackFix": "በመስመሩና በዴፖው መካከል ያለውን መንገድ ይመልከቱ፣ ወይም ከመጨረሻው ጉዞ በኋላ ተጨማሪ ጊዜ ይተዉ።",
  "advice.road.unnamedStreet": "ስም የሌለው መንገድ",
  "advice.road.unnamedJunction": "መገናኛ",
  "advice.road.spot.signal": "ቀይ መብራት፣ {place}፦ በድምሩ {min} ደቂቃ ጠፍቷል ({lines})",
  "advice.road.spot.signalFix":
    "መስመሮቹ እዚህ ከማንኛውም ቦታ በላይ ይጠብቃሉ። በዚህ መብራት ቅድሚያ፣ ወይም የሚስማማቸው የመብራት ጊዜ፣ ይጠይቁላቸው። የመንገድ ማስመሰያው ቅድሚያን ገና አያስመስልም፣ ስለዚህ ጥቅሙን ማሳየት አይችልም።",
  "advice.road.spot.street": "ትራፊክ፣ {place}፦ በድምሩ {min} ደቂቃ ጠፍቷል ({lines})",
  "advice.road.spot.streetFix":
    "በዚህ መንገድ ላይ ለመስመሮቹ የራሳቸውን መስመር ይስጡ (GIS ትር፣ የመንገድ አቀማመጥ፦ የአውቶቡስ መስመር)፣ ወይም በሌላ መንገድ ያሳልፏቸው።",
  "advice.road.spot.junction": "መቆም፣ {place}፦ በድምሩ {min} ደቂቃ ጠፍቷል ({lines})",
  "advice.road.spot.junctionFix":
    "ተሽከርካሪዎች በዚህ መገናኛ ውስጥ ለመታጠፍ ወይም መውጫው እስኪከፈት ይቆማሉ። እስከዚያ ድረስ የራሳቸው መስመር፣ ወይም በመብራቶቹ የተለየ የመታጠፊያ ደረጃ፣ ይረዳል።",
} satisfies AdviceMessages;

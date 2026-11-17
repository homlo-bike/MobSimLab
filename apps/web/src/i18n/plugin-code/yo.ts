import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (yo). */
export const pluginCodeYo = {
  "pcode.title": "Ìṣirò àwọn plugin",
  "pcode.intro":
    "Ìṣirò àwọn plugin tí a ti fi sí. Wọ́n ń ṣiṣẹ́ nínú àyè àdádó nínú aṣàwákiri rẹ, láìsí ìwọlé sí íntánẹ́ẹ̀tì tàbí àwọn iṣẹ́ àkànṣe mìíràn.",
  "pcode.by": "{plugin} · láti ọwọ́ {publisher}",
  "pcode.run": "Ṣírò",
  "pcode.running": "Ó ń ṣírò…",
  "pcode.failed": "{plugin} kò lè ṣírò: {error}",
  "pcode.noRows": "Kò sí ìlà.",
  "pcode.log": "Àkọsílẹ̀ plugin (ìlà {count})",
  "pcode.import": "Gbé {label} wọlé ({plugin})",
  "pcode.export": "Ṣe ìgbàsílẹ̀ bí {label} ({plugin})",
  "pcode.importFailed": "{plugin} kò lè ka fáìlì náà: {error}",
  "pcode.exportFailed": "{plugin} kò lè kọ fáìlì náà: {error}",
  "pcode.frameTitle": "{tab}, ojú-ewé kan ti plugin {plugin}",
  "pcode.frameNote": "Ojú-ewé yìí wá láti plugin {plugin} ti {publisher}. Kò lè dé íntánẹ́ẹ̀tì tàbí àkáǹtì rẹ.",
  "pcode.runsCode": "Ó ń ṣiṣẹ́ kóòdù tirẹ̀ nínú àyè àdádó",
  "pcode.limits": "Ààlà kóòdù plugin",
  "pcode.limitsIntro":
    "Ìpè kọ̀ọ̀kan sí kóòdù plugin ń gba ìrántí àti àkókò tí kò ju èyí lọ, nínú aṣàwákiri àti lórí olupin.",
  "pcode.memory": "Ìrántí (MB)",
  "pcode.time": "Àkókò (ìṣẹ́jú-àáyá)",
  "pcode.saveLimits": "Fi àwọn ààlà pamọ́",
  "pcode.saved": "A ti fi pamọ́.",
  "pcode.installIntro":
    "Gbé fáìlì .msplugin sókè. MobSimLab yóò ṣàyẹ̀wò rẹ̀, yóò sì fi ohun tí ó ń fi kún hàn kí o tó fi sí. Àwọn plugin lè fi ọ̀nà ìrìnàjò, irinṣẹ́, pàrámítà àti orísun kún, kí wọ́n sì ṣiṣẹ́ kóòdù tiwọn (ìṣirò, gbígbé wọlé, gbígbé jáde àti ojú-ewé táàbù) nínú àyè àdádó láìsí íntánẹ́ẹ̀tì.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Àwọn fọ́tò láti ojú ọ̀run tí ó tó nǹkan bí mítà 0.3 sí 1 fún píkísẹ́lì kọ̀ọ̀kan. Esri nílò kọ́kọ́rọ́ ArcGIS API láti àkáǹtì ArcGIS Location Platform àti gbígba àwọn òfin rẹ̀. Àwọn tiles ń kọjá nínú MobSimLab yìí, nítorí náà àwọn aṣàwákiri kò rí kọ́kọ́rọ́ náà rí, a kò sì tọ́jú wọn.",
  "esri.key": "Kọ́kọ́rọ́ ArcGIS API",
  "esri.accept": "Mo gba àwọn òfin lílo Esri fún MobSimLab yìí",
  "esri.terms": "Àwọn òfin Esri",
  "esri.save": "Fi kọ́kọ́rọ́ pamọ́",
  "esri.remove": "Yọ kọ́kọ́rọ́ kúrò",
  "esri.saved":
    "Kọ́kọ́rọ́ tí ó parí sí {end} ni {name} fi pamọ́ ní {date}. Esri World Imagery wà nínú àṣàyàn ìpele máàpù.",
  "esri.none": "Kò sí kọ́kọ́rọ́ tí a fi pamọ́: a kò pèsè Esri World Imagery.",
} satisfies PluginCodeMessages;

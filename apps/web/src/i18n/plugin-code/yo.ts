import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (yo). */
export const pluginCodeYo = {
  "pcode.title": "Ìṣirò àwọn plugin",
  "pcode.intro": "Ìṣirò àwọn plugin tí a ti fi sí. Wọ́n ń ṣiṣẹ́ nínú àyè àdádó nínú aṣàwákiri rẹ, láìsí ìwọlé sí íntánẹ́ẹ̀tì tàbí àwọn iṣẹ́ àkànṣe mìíràn.",
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
  "pcode.limitsIntro": "Ìpè kọ̀ọ̀kan sí kóòdù plugin ń gba ìrántí àti àkókò tí kò ju èyí lọ, nínú aṣàwákiri àti lórí olupin.",
  "pcode.memory": "Ìrántí (MB)",
  "pcode.time": "Àkókò (ìṣẹ́jú-àáyá)",
  "pcode.saveLimits": "Fi àwọn ààlà pamọ́",
  "pcode.saved": "A ti fi pamọ́.",
  "pcode.installIntro": "Gbé fáìlì .msplugin sókè. MobSimLab yóò ṣàyẹ̀wò rẹ̀, yóò sì fi ohun tí ó ń fi kún hàn kí o tó fi sí. Àwọn plugin lè fi ọ̀nà ìrìnàjò, irinṣẹ́, pàrámítà àti orísun kún, kí wọ́n sì ṣiṣẹ́ kóòdù tiwọn (ìṣirò, gbígbé wọlé, gbígbé jáde àti ojú-ewé táàbù) nínú àyè àdádó láìsí íntánẹ́ẹ̀tì.",
} satisfies PluginCodeMessages;

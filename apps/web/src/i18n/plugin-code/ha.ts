import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ha). */
export const pluginCodeHa = {
  "pcode.title": "Lissafin plugin",
  "pcode.intro":
    "Lissafin plugin da aka girka. Suna gudana a cikin keɓantaccen wuri a burauzarka, ba tare da shiga intanet ko wasu ayyuka ba.",
  "pcode.by": "{plugin} · daga {publisher}",
  "pcode.run": "Lissafa",
  "pcode.running": "Ana lissafawa…",
  "pcode.failed": "{plugin} bai iya lissafawa ba: {error}",
  "pcode.noRows": "Babu layuka.",
  "pcode.log": "Rajistar plugin (layuka {count})",
  "pcode.import": "Shigo da {label} ({plugin})",
  "pcode.export": "Sauke a matsayin {label} ({plugin})",
  "pcode.importFailed": "{plugin} bai iya karanta fayil ɗin ba: {error}",
  "pcode.exportFailed": "{plugin} bai iya rubuta fayil ɗin ba: {error}",
  "pcode.frameTitle": "{tab}, shafi na plugin {plugin}",
  "pcode.frameNote":
    "Wannan shafin ya fito daga plugin {plugin} na {publisher}. Ba zai iya shiga intanet ko asusunka ba.",
  "pcode.runsCode": "Yana gudanar da lambarsa a cikin keɓantaccen wuri",
  "pcode.limits": "Iyakokin lambar plugin",
  "pcode.limitsIntro":
    "Kowane kira na lambar plugin yana samun ƙwaƙwalwa da lokaci da bai wuce wannan ba, a burauza da kan sabar.",
  "pcode.memory": "Ƙwaƙwalwa (MB)",
  "pcode.time": "Lokaci (daƙiƙoƙi)",
  "pcode.saveLimits": "Ajiye iyakoki",
  "pcode.saved": "An ajiye.",
  "pcode.installIntro":
    "Ɗora fayil na .msplugin. MobSimLab zai duba shi kuma ya nuna abin da yake ƙarawa kafin ka girka shi. Plugin na iya ƙara hanyoyin sufuri, kayan aiki, sigogi da tushe, kuma su gudanar da lambarsu (lissafi, shigo da, fitarwa da shafukan shafi) a cikin keɓantaccen wuri ba tare da intanet ba.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Hotunan sama na kusan mita 0.3 zuwa 1 a kowane pixel. Esri tana bukatar mabuɗin ArcGIS API daga asusun ArcGIS Location Platform da amincewa da sharuɗɗanta. Tayal ɗin suna wucewa ta wannan MobSimLab, don haka masu bincike ba sa ganin mabuɗin, kuma ba a adana su.",
  "esri.key": "Mabuɗin ArcGIS API",
  "esri.accept": "Na amince da sharuɗɗan amfani na Esri don wannan MobSimLab",
  "esri.terms": "Sharuɗɗan Esri",
  "esri.save": "Adana mabuɗi",
  "esri.remove": "Cire mabuɗi",
  "esri.saved":
    "{name} ya adana mabuɗin da ya ƙare da {end} a ranar {date}. Ana bayar da Esri World Imagery a zaɓin layukan taswira.",
  "esri.none": "Babu mabuɗin da aka adana: ba a bayar da Esri World Imagery.",
} satisfies PluginCodeMessages;

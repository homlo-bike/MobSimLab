import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (sw). */
export const pluginCodeSw = {
  "pcode.title": "Hesabu za programu-jalizi",
  "pcode.intro":
    "Hesabu za programu-jalizi zilizosakinishwa. Zinaendeshwa kwenye mazingira yaliyotengwa ndani ya kivinjari chako, bila kufikia intaneti au miradi mingine.",
  "pcode.by": "{plugin} · na {publisher}",
  "pcode.run": "Hesabu",
  "pcode.running": "Inahesabu…",
  "pcode.failed": "{plugin} haikuweza kuhesabu: {error}",
  "pcode.noRows": "Hakuna safu.",
  "pcode.log": "Kumbukumbu ya programu-jalizi (mistari {count})",
  "pcode.import": "Leta {label} ({plugin})",
  "pcode.export": "Pakua kama {label} ({plugin})",
  "pcode.importFailed": "{plugin} haikuweza kusoma faili: {error}",
  "pcode.exportFailed": "{plugin} haikuweza kuandika faili: {error}",
  "pcode.frameTitle": "{tab}, ukurasa wa programu-jalizi {plugin}",
  "pcode.frameNote":
    "Ukurasa huu unatoka kwa programu-jalizi {plugin} ya {publisher}. Hauwezi kufikia intaneti au akaunti yako.",
  "pcode.runsCode": "Huendesha msimbo wake mwenyewe kwenye mazingira yaliyotengwa",
  "pcode.limits": "Mipaka ya msimbo wa programu-jalizi",
  "pcode.limitsIntro":
    "Kila mwito wa msimbo wa programu-jalizi hupata kumbukumbu na muda usiozidi huu, kwenye kivinjari na kwenye seva.",
  "pcode.memory": "Kumbukumbu (MB)",
  "pcode.time": "Muda (sekunde)",
  "pcode.saveLimits": "Hifadhi mipaka",
  "pcode.saved": "Imehifadhiwa.",
  "pcode.installIntro":
    "Pakia faili ya .msplugin. MobSimLab huikagua na kuonyesha inachoongeza kabla ya kusakinisha. Programu-jalizi zinaweza kuongeza njia za usafiri, zana, vigezo na vyanzo, na kuendesha msimbo wake (hesabu, uletaji, uhamishaji na kurasa za vichupo) kwenye mazingira yaliyotengwa bila intaneti.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Picha za angani za takriban mita 0.3 hadi 1 kwa pikseli. Esri inahitaji ufunguo wa ArcGIS API kutoka akaunti ya ArcGIS Location Platform na kukubali masharti yake. Vigae hupita kupitia MobSimLab hii, hivyo vivinjari havioni ufunguo, na havihifadhiwi.",
  "esri.key": "Ufunguo wa ArcGIS API",
  "esri.accept": "Ninakubali masharti ya matumizi ya Esri kwa MobSimLab hii",
  "esri.terms": "Masharti ya Esri",
  "esri.save": "Hifadhi ufunguo",
  "esri.remove": "Ondoa ufunguo",
  "esri.saved":
    "Ufunguo unaoishia {end} umehifadhiwa na {name} tarehe {date}. Esri World Imagery inapatikana kwenye uchaguzi wa tabaka za ramani.",
  "esri.none": "Hakuna ufunguo uliohifadhiwa: Esri World Imagery haitolewi.",
} satisfies PluginCodeMessages;

import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (zu). */
export const pluginCodeZu = {
  "pcode.title": "Izibalo ze-plugin",
  "pcode.intro":
    "Izibalo zama-plugin afakiwe. Zisebenza endaweni evikelekile esipheqululini sakho, ngaphandle kokufinyelela ku-inthanethi noma kwamanye amaphrojekthi.",
  "pcode.by": "{plugin} · ngu-{publisher}",
  "pcode.run": "Bala",
  "pcode.running": "Iyabala…",
  "pcode.failed": "I-{plugin} ayikwazanga ukubala: {error}",
  "pcode.noRows": "Awekho imigqa.",
  "pcode.log": "Ilogi ye-plugin (imigqa engu-{count})",
  "pcode.import": "Ngenisa i-{label} ({plugin})",
  "pcode.export": "Landa njenge-{label} ({plugin})",
  "pcode.importFailed": "I-{plugin} ayikwazanga ukufunda ifayela: {error}",
  "pcode.exportFailed": "I-{plugin} ayikwazanga ukubhala ifayela: {error}",
  "pcode.frameTitle": "{tab}, ikhasi le-plugin ye-{plugin}",
  "pcode.frameNote":
    "Leli khasi livela ku-plugin ye-{plugin} ka-{publisher}. Alikwazi ukufinyelela ku-inthanethi noma ku-akhawunti yakho.",
  "pcode.runsCode": "Iqhuba ikhodi yayo endaweni evikelekile",
  "pcode.limits": "Imikhawulo yekhodi ye-plugin",
  "pcode.limitsIntro":
    "Ukubizwa ngakunye kwekhodi ye-plugin kuthola inkumbulo nesikhathi esingeqile lokhu, esipheqululini naseseva.",
  "pcode.memory": "Inkumbulo (MB)",
  "pcode.time": "Isikhathi (imizuzwana)",
  "pcode.saveLimits": "Londoloza imikhawulo",
  "pcode.saved": "Kulondoloziwe.",
  "pcode.installIntro":
    "Layisha ifayela le-.msplugin. I-MobSimLab iyalihlola futhi ikhombise ukuthi lengezani ngaphambi kokuthi ulifake. Ama-plugin angengeza izindlela zokuhamba, amathuluzi, amapharamitha nemithombo, futhi aqhube ikhodi yawo (izibalo, ukungenisa, ukuthumela namakhasi ethebhu) endaweni evikelekile engenayo i-inthanethi.",
} satisfies PluginCodeMessages;

import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (nl). */
export const pluginCodeNl = {
  "pcode.title": "Pluginberekeningen",
  "pcode.intro":
    "Berekeningen van geïnstalleerde plugins. Ze draaien in een sandbox in uw browser, zonder toegang tot internet of andere projecten.",
  "pcode.by": "{plugin} · door {publisher}",
  "pcode.run": "Berekenen",
  "pcode.running": "Bezig met berekenen…",
  "pcode.failed": "{plugin} kon niet rekenen: {error}",
  "pcode.noRows": "Geen rijen.",
  "pcode.log": "Pluginlogboek ({count} regels)",
  "pcode.import": "{label} importeren ({plugin})",
  "pcode.export": "Downloaden als {label} ({plugin})",
  "pcode.importFailed": "{plugin} kon het bestand niet lezen: {error}",
  "pcode.exportFailed": "{plugin} kon het bestand niet schrijven: {error}",
  "pcode.frameTitle": "{tab}, een pagina van de plugin {plugin}",
  "pcode.frameNote":
    "Deze pagina komt van de plugin {plugin} van {publisher}. Ze kan niet bij internet of uw account.",
  "pcode.runsCode": "Voert eigen code uit in een sandbox",
  "pcode.limits": "Limieten voor plugincode",
  "pcode.limitsIntro":
    "Elke aanroep van plugincode krijgt hooguit zoveel geheugen en tijd, in de browser en op de server.",
  "pcode.memory": "Geheugen (MB)",
  "pcode.time": "Tijd (seconden)",
  "pcode.saveLimits": "Limieten opslaan",
  "pcode.saved": "Opgeslagen.",
  "pcode.installIntro":
    "Upload een .msplugin-bestand. MobSimLab controleert het en toont wat het toevoegt voordat u het installeert. Plugins kunnen vervoerswijzen, gereedschappen, parameters en bronnen toevoegen en eigen code (berekeningen, importen, exporten en tabbladpagina’s) uitvoeren in een sandbox zonder internettoegang.",
} satisfies PluginCodeMessages;

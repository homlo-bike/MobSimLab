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
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Luchtfoto's van ongeveer 0,3 tot 1 m per pixel. Esri vraagt een ArcGIS-API-sleutel van een ArcGIS Location Platform-account en akkoord met zijn voorwaarden. De tegels lopen via deze MobSimLab, dus browsers zien de sleutel nooit, en ze worden niet bewaard.",
  "esri.key": "ArcGIS-API-sleutel",
  "esri.accept": "Ik ga akkoord met de gebruiksvoorwaarden van Esri voor deze MobSimLab",
  "esri.terms": "Voorwaarden van Esri",
  "esri.save": "Sleutel opslaan",
  "esri.remove": "Sleutel verwijderen",
  "esri.saved":
    "Sleutel eindigend op {end} opgeslagen door {name} op {date}. Esri World Imagery staat in de laagkeuze van de kaart.",
  "esri.none": "Geen sleutel opgeslagen: Esri World Imagery wordt niet aangeboden.",
} satisfies PluginCodeMessages;

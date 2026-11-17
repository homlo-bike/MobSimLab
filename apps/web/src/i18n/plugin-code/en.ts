/**
 * English messages for plugins that run their own code (ADR-0036 Phase 2): their calculations in the Tables tab,
 * their importers and exporters, their tab pages, and the Admin's limits. Merged into each language's dictionary;
 * every language has its own file next to this one.
 */
export const pluginCodeEn = {
  "pcode.title": "Plugin calculations",
  "pcode.intro":
    "Calculations of installed plugins. They run in a sandbox in your browser, with no access to the internet or to other projects.",
  "pcode.by": "{plugin} · by {publisher}",
  "pcode.run": "Calculate",
  "pcode.running": "Calculating…",
  "pcode.failed": "{plugin} could not calculate: {error}",
  "pcode.noRows": "No rows.",
  "pcode.log": "Plugin log ({count} lines)",
  "pcode.import": "Import {label} ({plugin})",
  "pcode.export": "Download as {label} ({plugin})",
  "pcode.importFailed": "{plugin} could not read the file: {error}",
  "pcode.exportFailed": "{plugin} could not write the file: {error}",
  "pcode.frameTitle": "{tab}, a page of the {plugin} plugin",
  "pcode.frameNote":
    "This page comes from the {plugin} plugin by {publisher}. It cannot reach the internet or your account.",
  "pcode.runsCode": "Runs its own code in a sandbox",
  "pcode.limits": "Limits for plugin code",
  "pcode.limitsIntro":
    "Each call of a plugin's code gets at most this much memory and time, in the browser and on the server.",
  "pcode.memory": "Memory (MB)",
  "pcode.time": "Time (seconds)",
  "pcode.saveLimits": "Save limits",
  "pcode.saved": "Saved.",
  "pcode.installIntro":
    "Upload a .msplugin file. MobSimLab checks it and shows what it adds before you install it. Plugins can add modes, tools, parameters and sources, and run their own code (calculations, importers, exporters and tab pages) in a sandbox without internet access.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Aerial photos at about 0.3 to 1 m per pixel. Esri needs an ArcGIS API key from an ArcGIS Location Platform account and acceptance of its terms. The tiles come through this MobSimLab, so browsers never see the key, and they are not stored.",
  "esri.key": "ArcGIS API key",
  "esri.accept": "I accept Esri's terms of use for this MobSimLab",
  "esri.terms": "Esri's terms",
  "esri.save": "Save key",
  "esri.remove": "Remove key",
  "esri.saved":
    "Key ending {end} saved by {name} on {date}. Esri World Imagery is offered in the map's layer control.",
  "esri.none": "No key saved: Esri World Imagery is not offered.",
} as const;

export type PluginCodeMessages = Record<keyof typeof pluginCodeEn, string>;

import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (de). */
export const pluginCodeDe = {
  "pcode.title": "Plugin-Berechnungen",
  "pcode.intro":
    "Berechnungen installierter Plugins. Sie laufen in einer Sandbox in Ihrem Browser, ohne Zugriff auf das Internet oder andere Projekte.",
  "pcode.by": "{plugin} · von {publisher}",
  "pcode.run": "Berechnen",
  "pcode.running": "Wird berechnet…",
  "pcode.failed": "{plugin} konnte nicht rechnen: {error}",
  "pcode.noRows": "Keine Zeilen.",
  "pcode.log": "Plugin-Protokoll ({count} Zeilen)",
  "pcode.import": "{label} importieren ({plugin})",
  "pcode.export": "Als {label} herunterladen ({plugin})",
  "pcode.importFailed": "{plugin} konnte die Datei nicht lesen: {error}",
  "pcode.exportFailed": "{plugin} konnte die Datei nicht schreiben: {error}",
  "pcode.frameTitle": "{tab}, eine Seite des Plugins {plugin}",
  "pcode.frameNote":
    "Diese Seite stammt vom Plugin {plugin} von {publisher}. Sie hat keinen Zugang zum Internet oder zu Ihrem Konto.",
  "pcode.runsCode": "Führt eigenen Code in einer Sandbox aus",
  "pcode.limits": "Grenzen für Plugin-Code",
  "pcode.limitsIntro":
    "Jeder Aufruf von Plugin-Code erhält höchstens so viel Speicher und Zeit, im Browser und auf dem Server.",
  "pcode.memory": "Speicher (MB)",
  "pcode.time": "Zeit (Sekunden)",
  "pcode.saveLimits": "Grenzen speichern",
  "pcode.saved": "Gespeichert.",
  "pcode.installIntro":
    "Laden Sie eine .msplugin-Datei hoch. MobSimLab prüft sie und zeigt vor der Installation, was sie hinzufügt. Plugins können Verkehrsmittel, Werkzeuge, Parameter und Quellen hinzufügen und eigenen Code (Berechnungen, Importe, Exporte und Tab-Seiten) in einer Sandbox ohne Internetzugang ausführen.",
} satisfies PluginCodeMessages;

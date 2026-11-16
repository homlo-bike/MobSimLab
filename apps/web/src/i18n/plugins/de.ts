import type { PluginKey } from "../plugins";

/** Plugin messages (de). */
export const pluginsDe = {
  "admin.plugins": "Plugins",
  "plugins.title": "Plugins",
  "plugins.intro":
    "Plugins fügen Verkehrsmittel, Werkzeuge und Berechnungen hinzu. Schalten Sie die ein, die dieses Projekt nutzt; ausgeschaltet verschwinden ihre Werkzeuge, Gezeichnetes bleibt erhalten.",
  "plugins.bundled": "Gehört zu MobSimLab",
  "plugins.by": "Von {publisher}",
  "plugins.versionN": "Version {version}",
  "plugins.adds": "Fügt hinzu: {list}",
  "plugins.uses": "Nutzt: {list}",
  "plugins.parameters": "{count} Annahmewerte",
  "plugins.missing":
    "Version {version} wurde aus diesem MobSimLab entfernt. Wählen Sie eine andere Version, um es wieder zu nutzen.",
  "plugins.versionOf": "Version von {name}",
  "plugins.useIn": "{name} in diesem Projekt nutzen",
  "plugins.ownerOnly":
    "Nur die Eigentümerin oder der Eigentümer des Projekts kann Plugins ein- oder ausschalten.",
  "plugins.perm.readNetwork": "das Netz des Projekts",
  "plugins.perm.readTimetable": "den Fahrplan",
  "plugins.perm.readFleet": "Fahrzeuge und Flotte",
  "plugins.perm.readGeodata": "importierte Kartendaten",
  "plugins.perm.readResults": "Simulationsergebnisse",
  "plugins.perm.writeResults": "speichert eigene Ergebnisse",
  "plugins.perm.writeScenario": "schlägt Änderungen am Szenario vor",
  "plugins.installTitle": "Plugin installieren",
  "plugins.installIntro":
    "Laden Sie eine .msplugin-Datei hoch. MobSimLab prüft sie und zeigt vor der Installation, was sie hinzufügt. Installierte Plugins können Verkehrsmittel, Werkzeuge, Parameter und Quellen hinzufügen; Plugins mit eigenem Code folgen später.",
  "plugins.choose": "Eine .msplugin-Datei wählen",
  "plugins.problems": "Dieses Plugin kann nicht installiert werden:",
  "plugins.install": "Installieren",
  "plugins.installed": "Installierte Plugins",
  "plugins.none": "Noch keine Plugins installiert.",
  "plugins.removeOne": "{name} {version} entfernen",
  "plugins.inProjects": "In {count} Projekten genutzt",
  "plugins.bundledTitle": "Mit MobSimLab geliefert",
  "plugins.keys": "Vertrauenswürdige Herausgeber",
  "plugins.keysIntro":
    "Ein Plugin wird nur installiert, wenn sein Herausgeber es mit einem dieser Schlüssel signiert hat (ECDSA P-256 oder Ed25519, PEM).",
  "plugins.noKeys": "Noch keine vertrauenswürdigen Schlüssel.",
  "plugins.removeKey": "{name} nicht mehr vertrauen",
  "plugins.addKey": "Schlüssel hinzufügen",
  "plugins.keyName": "Name des Herausgebers",
  "plugins.keyPem": "Öffentlicher Schlüssel",
  "plugins.allowUnsigned": "Unsignierte Plugins erlauben (Entwicklungsmodus, nur Eigentümer)",
  "plugins.signedBy": "Signiert von {name}",
  "plugins.untrusted": "Mit einem Schlüssel signiert, dem diese Instanz nicht vertraut",
  "plugins.unsigned": "Nicht signiert",
  "plugins.licences": "Lizenzen: Code {code}, Daten {data}",
  "plugins.removeConfirm":
    "{name} ist in {count} Projekten eingeschaltet. Trotzdem entfernen? Es wird dort ausgeschaltet, die Zeichnungen bleiben erhalten.",
} satisfies Record<PluginKey, string>;

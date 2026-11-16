import type { MslabMessages } from "./en";

/** .mslab project file messages (de). */
export const mslabDe = {
  "menu.saveMslab": "Als .mslab-Datei speichern",
  "home.openMslab": ".mslab-Datei öffnen",
  "home.openingMslab": "Datei wird geöffnet…",
  "home.openedMslab": "„{name}“ als neues Projekt geöffnet.",
  "home.leftOut": "Nicht übernommen: {list}",
  "mslab.body":
    "Speichert Zeichnungen, Einstellungen, Szenarien und Plugins des Projekts in einer Datei, die sich in jedem MobSimLab wieder öffnen lässt.",
  "mslab.runs": "Gespeicherte Simulationsläufe einschließen (Datei wird größer)",
  "mslab.map":
    "Kartendaten für den statischen Viewer einschließen: Straßen, Gebäude, Bevölkerung und Länderdaten des Projektgebiets (größere Datei; kann einige Minuten dauern)",
  "static.empty":
    "Diese Website enthält noch keine Projekte. Legen Sie .mslab-Dateien in ihren Ordner projects und führen Sie tools/add-projects.mjs aus.",
  "mslab.save": "Datei speichern",
} satisfies MslabMessages;

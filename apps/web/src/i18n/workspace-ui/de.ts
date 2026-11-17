import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (de). */
export const workspaceUiDe = {
  "checks.menu": "Prüfungen",
  "checks.menuCount": "Prüfungen: {errors} Fehler, {warnings} Warnungen",
  "checks.title": "Prüfungen aller Modi",
  "checks.none":
    "Noch nichts zu prüfen. Zeichnen Sie eine Linie, eine Bahnstrecke oder ein Depot, dann erscheinen die Prüfungen hier.",
  "checks.lastOpened": "Stand beim letzten Öffnen",
  "checks.streetLine": "Straßenlinie · {name}",
  "checks.railway": "Bahn",
  "checks.depot": "Depot · {name}",
  "undo.undo": "Rückgängig",
  "undo.redo": "Wiederholen",
  "tour.checks.title": "Prüfungen",
  "tour.checks.body":
    "Die Glocke listet die Prüfungen aller Modi auf, Fehler zuerst: Straßenlinien, Bahn, Depots und die Linien der Plugins. Wählen Sie eine aus, um zu sehen, wo sie liegt.",
  "settings.serverTab": "Server",
  "settings.pluginsTab": "Plugins",
  "settings.server.local":
    "MobSimLab läuft auf diesem Computer. Sie können diese App stattdessen mit einem MobSimLab-Server verbinden, der im Hintergrund läuft, etwa dem Docker-Server.",
  "settings.server.address": "Serveradresse",
  "settings.server.connect": "Verbinden",
  "settings.server.note":
    "Die App prüft den Server und fragt vor dem Wechsel nach. Projekte auf diesem Computer bleiben hier: Übertragen Sie sie als .mslab-Dateien. Zurückwechseln können Sie in den Einstellungen der App (⌘, oder Strg+,).",
  "settings.plugins.intro":
    "Installieren Sie Plugins für dieses MobSimLab. Jedes Projekt schaltet sie dann in seinen Projekteinstellungen ein oder aus.",
} satisfies WorkspaceUiMessages;

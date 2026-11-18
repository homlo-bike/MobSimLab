import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (nl). */
export const workspaceUiNl = {
  "checks.menu": "Controles",
  "checks.menuCount": "Controles: {errors} fouten, {warnings} waarschuwingen",
  "checks.title": "Controles van alle modi",
  "checks.none":
    "Nog niets te controleren. Teken een lijn, een spoorlijn of een depot en de controles verschijnen hier.",
  "checks.lastOpened": "stand bij laatste keer openen",
  "checks.streetLine": "Straatlijn · {name}",
  "checks.railway": "Spoorweg",
  "checks.depot": "Depot · {name}",
  "undo.undo": "Ongedaan maken",
  "undo.redo": "Opnieuw",
  "tour.checks.title": "Controles",
  "tour.checks.body":
    "De bel toont de controles van alle modi, fouten eerst: straatlijnen, de spoorweg, depots en de lijnen van plug-ins. Kies er een om te zien waar het is.",
  "settings.serverTab": "Server",
  "settings.server.local":
    "MobSimLab draait op deze computer. U kunt deze app in plaats daarvan verbinden met een MobSimLab-server die op de achtergrond draait, zoals de Docker-server.",
  "settings.server.address": "Serveradres",
  "settings.server.connect": "Verbinden",
  "settings.server.note":
    "De app controleert de server en vraagt het voordat hij overschakelt. Projecten op deze computer blijven hier: verplaats ze door ze als .mslab-bestanden op te slaan. Terugschakelen kan in de Instellingen van de app (⌘, of Ctrl+,).",
} satisfies WorkspaceUiMessages;

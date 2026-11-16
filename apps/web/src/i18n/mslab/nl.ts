import type { MslabMessages } from "./en";

/** .mslab project file messages (nl). */
export const mslabNl = {
  "menu.saveMslab": "Opslaan als .mslab-bestand",
  "home.openMslab": ".mslab-bestand openen",
  "home.openingMslab": "Bestand wordt geopend…",
  "home.openedMslab": "‘{name}’ geopend als nieuw project.",
  "home.leftOut": "Niet overgenomen: {list}",
  "mslab.body":
    "Slaat de tekeningen, voorkeuren, scenario’s en plug-ins van het project op in één bestand dat je in elke MobSimLab weer kunt openen.",
  "mslab.runs": "Opgeslagen simulaties meenemen (bestand wordt groter)",
  "mslab.map":
    "Kaartgegevens voor de statische viewer toevoegen: straten, gebouwen, bevolking en landcijfers van het projectgebied (groter bestand; kan enkele minuten duren)",
  "static.empty":
    "Deze site heeft nog geen projecten. Zet .mslab-bestanden in de map projects en voer tools/add-projects.mjs uit.",
  "mslab.save": "Bestand opslaan",
} satisfies MslabMessages;

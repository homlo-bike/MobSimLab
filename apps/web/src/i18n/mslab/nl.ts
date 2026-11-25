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
  "savedFiles.title": "Opgeslagen projectbestanden",
  "savedFiles.intro":
    "Kies wat een opgeslagen .mslab-bestand bevat. Een project dat uit het bestand wordt geopend, gebruikt deze gegevens meteen. Groottes zijn vóór compressie van het bestand.",
  "savedFiles.refresh": "Vernieuwen",
  "savedFiles.loadFailed": "De groottes konden niet worden geladen.",
  "savedFiles.whenSaving": "Gemaakt bij het opslaan van het bestand",
  "savedFiles.none": "Nog geen",
  "savedFiles.from": "Van {source}",
  "savedFiles.at": "Laatst bijgewerkt {date}",
  "savedFiles.update": "Bijwerken",
  "savedFiles.updateOf": "{name} bijwerken",
  "savedFiles.always": "Altijd opgeslagen",
  "savedFiles.later": "Nog niet in bestanden opgeslagen: komt in een latere update",
  "savedFiles.include": "{name} opnemen in opgeslagen bestanden",
  "savedFiles.total": "Nu in bestanden opgeslagen: {size} vóór compressie",
  "savedFiles.design": "Tekeningen en instellingen",
  "savedFiles.vehicles": "Eigen voertuigen en vloot",
  "savedFiles.processed": "Berekende resultaten (dienstregelingen, tabellen, GIS, schema)",
  "savedFiles.runs": "Simulatie- en vraagberekeningen (met HB-matrices)",
  "savedFiles.comments": "Opmerkingen en discussies",
  "savedFiles.history": "Wijzigingsgeschiedenis",
  "savedFiles.osm": "OpenStreetMap-gegevens van het projectgebied",
  "savedFiles.liveTiles": "Kaarttegels die de tools live ophaalden",
  "savedFiles.elevation": "Hoogte",
  "savedFiles.population": "Bevolking",
  "savedFiles.uploads": "Uw geüploade kaart-, hoogte- en bevolkingsbestanden",
  "savedFiles.facts": "Locatiegegevens (land, feestdagen, klimaat)",
  "savedFiles.economy": "Economische gegevens (Wereldbank)",
  "savedFiles.otherFetched": "Andere opgehaalde gegevens (deelfietsen, waterdiepten, plaatsen)",
  "savedFiles.viewerMap": "Kaartgegevens voor de statische viewer",
  "mslab.results":
    "Neem de door de tools berekende resultaten op (het project opent zonder ze opnieuw te berekenen)",
  "mslab.vehicles": "Neem de eigen voertuigen en vloot van het project op",
  "mslab.fromPrefs": "Deze keuzes beginnen bij Projectvoorkeuren → Opgeslagen projectbestanden.",
  "mslab.comments": "Opmerkingen en discussies opnemen",
  "mslab.history": "Geschiedenis van gewijzigde waarden opnemen",
  "mslab.fetched":
    "Gedownloade gegevens opnemen (kaarttegels, hoogte, bevolking, klimaat- en economiecijfers), zoals gekozen in de projectvoorkeuren",
  "mslab.fromFile": "uit het projectbestand",
} satisfies MslabMessages;

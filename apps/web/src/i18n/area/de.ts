import type { AreaMessages } from "./en";

/** Project area messages (de). */
export const areaDe = {
  "aw.title": "Projektgebiet",
  "aw.editing": "Gebiet von {name} bearbeiten",
  "aw.search": "Ort suchen, um die Karte zu verschieben, z. B. Homs",
  "aw.tools": "Zeichenwerkzeuge",
  "aw.draw": "Polygon zeichnen",
  "aw.edit": "Punkte bearbeiten",
  "aw.pan": "Verschieben",
  "aw.hint.draw":
    "Klicken Sie, um Ecken zu setzen. Klicken Sie auf die erste Ecke oder drücken Sie die Eingabetaste, um das Polygon zu schließen. Die Rücktaste entfernt die letzte Ecke.",
  "aw.hint.edit":
    "Klicken Sie auf ein Polygon, um es auszuwählen. Ziehen Sie eine Ecke, um sie zu verschieben, ziehen Sie einen Mittelpunkt, um eine Ecke hinzuzufügen, doppelklicken Sie auf eine Ecke, um sie zu entfernen.",
  "aw.hint.pan": "Ziehen Sie, um die Karte zu verschieben. Klicken Sie auf ein Polygon, um es auszuwählen.",
  "aw.statArea": "Fläche",
  "aw.statDownload": "Geschätzter Download",
  "aw.mb": "{mb} MB",
  "aw.limit": "Grenze {mb} MB",
  "aw.overLimit":
    "Das Gebiet enthält mehr Kartendaten als die {mb} MB, die ein Projekt haben darf. Verkleinern Sie es oder stellen Sie Polygone entlang von Strecken auf „Nur Hauptstraßen und Bahnstrecken“.",
  "aw.polygons": "Polygone",
  "aw.empty":
    "Noch keine Polygone. Zeichnen Sie eines um jeden Ort, den das Projekt abdeckt, und ein schmales entlang jeder Fernverbindung.",
  "aw.detail.full": "Vollständig",
  "aw.detail.main": "Nur Hauptstraßen und Bahnstrecken",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Name",
  "aw.detail": "Detailgrad",
  "aw.fullHelp": "Straßen, Wege, Gebäude, Schulen und Krankenhäuser, Bevölkerung in 100 m, Gelände.",
  "aw.mainHelp":
    "Autobahnen, Fern- und Hauptstraßen, Bahnstrecken, Gelände, Bevölkerung in 1 km. Keine Gebäude: Zeichnen Sie Orte entlang der Strecke als „Vollständig“ für die Lärmkarte und die Fußwege.",
  "aw.delete": "Polygon löschen",
  "aw.newName": "Gebiet {n}",
  "aw.save": "Gebiet speichern",
  "aw.confirm.title": "Kartendaten für die neuen Teile herunterladen?",
  "aw.confirm.body":
    "Neu oder geändert: {list}. Sie brauchen etwa {mb} MB. Entfernte Teile werden nicht mehr genutzt. Es wird nichts heruntergeladen, bevor Sie bestätigen.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Zurück zur Karte",
  "aw.confirm.save": "Speichern und {mb} MB herunterladen",
  "aw.select": "Gebiet wählen",
  "aw.selectHint":
    "Zeichnen Sie die Grenzen des Projekts auf einer Karte. Kartendaten werden nur innerhalb davon heruntergeladen.",
  "aw.change": "Gebiet ändern",
  "aw.download": "etwa {mb} MB Kartendaten",
  "aw.outline": "Umriss des Projektgebiets",
  "aw.prefsIntro":
    "Die um das Projekt gezeichneten Polygone. Kartendaten werden nur innerhalb davon heruntergeladen, im Detailgrad des jeweiligen Polygons.",
  "aw.dataFrom": "Kartendaten vom {date}",
  "aw.noData": "Kartendaten noch nicht heruntergeladen",
  "aw.editArea": "Gebiet bearbeiten",
  "aw.drawArea": "Gebiet zeichnen",
  "aw.refresh": "Kartendaten aktualisieren",
  "aw.refreshHelp":
    "Aktualisieren lädt die aktuellen OpenStreetMap-Daten für dasselbe Gebiet herunter; bis dahin behält die Planung ihren Datenstand.",
  "aw.none": "Noch kein Projektgebiet. Zeichnen Sie eines, damit die Werkzeuge Kartendaten haben.",
  "aw.saved": "Gebiet gespeichert.",
  "aw.data.noArea":
    "Zeichnen Sie zuerst das Projektgebiet in den Projekteinstellungen: Die Importe decken es ab.",
  "aw.data.area": "Projektgebiet: {names}. Die Importe decken das Rechteck darum ab, {area} km².",
  "aw.pop.none": "Noch kein Projektgebiet. Zeichnen Sie es in den Projekteinstellungen.",
  "aw.pop.box": "Das Rechteck um das Projektgebiet: {km2} km².",
  "aw.tiles.one": "{count} Kartenkachel",
  "aw.tiles.other": "{count} Kartenkacheln",
  "aw.count.one": "{count} Polygon",
  "aw.count.other": "{count} Polygone",
} satisfies AreaMessages;

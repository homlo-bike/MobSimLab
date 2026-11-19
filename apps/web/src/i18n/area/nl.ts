import type { AreaMessages } from "./en";

/** Project area messages (nl). */
export const areaNl = {
  "aw.title": "Projectgebied",
  "aw.editing": "Gebied van {name} bewerken",
  "aw.search": "Zoek een plaats om de kaart te verplaatsen, zoals Homs",
  "aw.tools": "Tekengereedschap",
  "aw.draw": "Polygoon tekenen",
  "aw.edit": "Punten bewerken",
  "aw.pan": "Verschuiven",
  "aw.hint.draw":
    "Klik om hoekpunten toe te voegen. Klik op het eerste hoekpunt of druk op Enter om de polygoon te sluiten. Backspace verwijdert het laatste hoekpunt.",
  "aw.hint.edit":
    "Klik op een polygoon om hem te selecteren. Sleep een hoekpunt om het te verplaatsen, sleep een middenpunt om een hoekpunt toe te voegen, dubbelklik op een hoekpunt om het te verwijderen.",
  "aw.hint.pan": "Sleep om de kaart te verschuiven. Klik op een polygoon om hem te selecteren.",
  "aw.statArea": "Oppervlakte",
  "aw.statDownload": "Geschatte download",
  "aw.mb": "{mb} MB",
  "aw.limit": "Grens {mb} MB",
  "aw.overLimit":
    "Het gebied bevat meer kaartgegevens dan de {mb} MB die een project mag hebben. Maak het kleiner, of zet polygonen langs routes op alleen hoofdwegen en spoorlijnen.",
  "aw.polygons": "Polygonen",
  "aw.empty":
    "Nog geen polygonen. Teken er een rond elke plaats die het project beslaat, en een smalle langs elke intercityroute.",
  "aw.detail.full": "Volledig",
  "aw.detail.main": "Alleen hoofdwegen en spoorlijnen",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Naam",
  "aw.detail": "Detail",
  "aw.fullHelp": "Straten, paden, gebouwen, scholen en ziekenhuizen, bevolking per 100 m, terrein.",
  "aw.mainHelp":
    "Snelwegen, autowegen en hoofdwegen, spoorlijnen, terrein, bevolking per 1 km. Geen gebouwen: teken plaatsen langs de route als Volledig voor de geluidskaart en looptoegang.",
  "aw.delete": "Polygoon verwijderen",
  "aw.newName": "Gebied {n}",
  "aw.save": "Gebied opslaan",
  "aw.confirm.title": "Kaartgegevens voor de nieuwe delen downloaden?",
  "aw.confirm.body":
    "Nieuw of gewijzigd: {list}. Ze hebben ongeveer {mb} MB nodig. Verwijderde delen worden niet meer gebruikt. Er wordt niets gedownload tot u bevestigt.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Terug naar de kaart",
  "aw.confirm.save": "Opslaan en {mb} MB downloaden",
  "aw.select": "Gebied kiezen",
  "aw.selectHint":
    "Teken de grenzen van het project op een kaart. Kaartgegevens worden alleen daarbinnen gedownload.",
  "aw.change": "Gebied wijzigen",
  "aw.download": "ongeveer {mb} MB kaartgegevens",
  "aw.outline": "Omtrek van het projectgebied",
  "aw.prefsIntro":
    "De polygonen rond het project. Kaartgegevens worden alleen daarbinnen gedownload, met het detail van elke polygoon.",
  "aw.dataFrom": "Kaartgegevens van {date}",
  "aw.noData": "Kaartgegevens nog niet gedownload",
  "aw.editArea": "Gebied bewerken",
  "aw.drawArea": "Gebied tekenen",
  "aw.refresh": "Kaartgegevens vernieuwen",
  "aw.refreshHelp":
    "Vernieuwen downloadt de huidige OpenStreetMap-gegevens voor hetzelfde gebied; tot dan houdt het plan de datum van zijn gegevens.",
  "aw.none": "Nog geen projectgebied. Teken er een zodat de gereedschappen kaartgegevens hebben.",
  "aw.saved": "Gebied opgeslagen.",
  "aw.data.noArea": "Teken eerst het projectgebied in Projectvoorkeuren: de imports beslaan het.",
  "aw.data.area": "Projectgebied: {names}. De imports beslaan de rechthoek eromheen, {area} km².",
  "aw.pop.none": "Nog geen projectgebied. Teken het in Projectvoorkeuren.",
  "aw.pop.box": "De rechthoek rond het projectgebied: {km2} km².",
  "aw.tiles.one": "{count} kaarttegel",
  "aw.tiles.other": "{count} kaarttegels",
  "aw.count.one": "{count} polygoon",
  "aw.count.other": "{count} polygonen",
  "aw.out.title": "Kaartgegevens buiten het projectgebied downloaden?",
  "aw.out.note":
    "De regio {name} reikt buiten het projectgebied. Het deel daarbuiten heeft nieuwe kaartgegevens nodig.",
  "aw.out.part": "Deel daarbuiten",
  "aw.out.km2": "ongeveer {km2} km²",
  "aw.out.detail": "Detail voor het deel daarbuiten",
  "aw.out.overLimit":
    "Daarmee bevat het projectgebied meer kaartgegevens dan de {mb} MB die een project mag hebben. Kies alleen hoofdwegen en spoorlijnen, of maak het gebied kleiner in de projectvoorkeuren.",
  "aw.out.adds":
    "Downloaden voegt de regio als nieuwe polygoon toe aan het projectgebied; u kunt die later in het gebiedsvenster bewerken.",
  "aw.out.keep": "Regio houden, niet downloaden",
  "aw.out.download": "{mb} MB downloaden",
  "aw.out.downloading": "Bezig met downloaden…",
} satisfies AreaMessages;

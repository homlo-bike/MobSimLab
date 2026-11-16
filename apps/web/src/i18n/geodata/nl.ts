import type { GeodataMessages } from "./en";

/** Map data view messages (nl). */
export const geodataNl = {
  "gis.dataView": "Kaartgegevens",
  "data.title": "Kaartgegevens",
  "data.intro":
    "OpenStreetMap en hoogtegegevens voor dit project, bewaard bij het project. De straat-, spoor-, gebouw-, water- en terreintools lezen ze in plaats van telkens OpenStreetMap en de hoogteserver te vragen.",
  "data.noArea":
    "Teken eerst iets in het project: de import omvat de rechthoek om alles wat getekend is, plus een buffer.",
  "data.area": "Gebied: {area} km², de rechthoek om alles wat getekend is plus {buffer} km",
  "data.osm": "OpenStreetMap",
  "data.dem": "Hoogte",
  "data.notImported": "Nog niet geïmporteerd.",
  "data.imported": "Geïmporteerd {date}",
  "data.dataDate": "gegevens van {date}",
  "data.outside":
    "De tekening reikt nu buiten het geïmporteerde gebied. Vernieuw om het nieuwe gebied te importeren.",
  "data.method": "Gegevens ophalen uit",
  "data.method.overpass": "Overpass (gebieden tot {max} km²)",
  "data.method.geofabrik": "Een Geofabrik-regio",
  "data.method.upload": "Een .osm.pbf-bestand",
  "data.region": "Regio",
  "data.regionsLoading": "Regio’s zoeken…",
  "data.noRegions": "Geen Geofabrik-regio bevat het hele gebied.",
  "data.planned": "Geplande wegen behouden (gepland en in aanleg)",
  "data.import": "Importeren",
  "data.refresh": "Vernieuwen",
  "data.chooseFile": "Kies een .osm.pbf-bestand (tot {max} MB)",
  "data.cancel": "Annuleren",
  "data.queued": "Wacht tot een andere import klaar is…",
  "data.step.download": "Downloaden…",
  "data.step.downloadN": "Downloaden: {done} van {total}…",
  "data.step.merge": "Tegels samenvoegen…",
  "data.step.extract": "Projectgebied uitsnijden…",
  "data.step.database": "Naar de database schrijven…",
  "data.failed": "De laatste import is mislukt: {error}",
  "data.cancelled": "De laatste import is geannuleerd.",
  "data.counts": "{roads} wegen, {rails} sporen, {buildings} gebouwen, {stops} haltes",
  "data.demFacts": "Copernicus GLO-30, raster van {res} m, hoogtes binnen ±{acc} m",
  "data.demNoData": "{n} van de 1°-cellen van het gebied hebben geen hoogtegegevens (open zee).",
  "data.tooLarge":
    "Het gebied is {area} km², meer dan Overpass dekt. Kies een Geofabrik-regio of upload een bestand.",
  "data.readOnly": "Eigenaren en bewerkers kunnen gegevens importeren.",
  "data.licence": "© OpenStreetMap contributors, ODbL 1.0",
} satisfies GeodataMessages;

import type { streetPhotosEn } from "./en";

/** Deutsch: messages of the map's Street photos panel. */
export const streetPhotosDe: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Straßenfotos",
  "photos.title": "Straßenfotos",
  "photos.source": "Quelle",
  "photos.hint":
    "Linien auf der Karte zeigen, wo Fotos aufgenommen wurden. Klicken Sie auf einen Punkt der Karte, um die Fotos in seiner Nähe zu sehen.",
  "photos.zoomIn":
    "Zoomen Sie hinein, um zu sehen, wo Fotos aufgenommen wurden, und klicken Sie dann auf einen Punkt der Karte.",
  "photos.searching": "Fotos werden gesucht …",
  "photos.none": "Keine Fotos im Umkreis von {radius} m um diesen Punkt. Klicken Sie näher an eine Linie.",
  "photos.failed": "Die Fotos konnten nicht geladen werden: {error}",
  "photos.count": "Foto {n} von {count}",
  "photos.previous": "Zurück",
  "photos.next": "Weiter",
  "photos.thumbs": "Fotos in der Nähe dieses Punkts",
  "photos.alt": "Straßenfoto {n} nahe dem angeklickten Punkt",
  "photos.imageFailed": "Dieses Foto konnte nicht geladen werden.",
  "photos.panorama": "360°-Foto",
  "photos.distance": "{m} m vom Punkt",
  "photos.taken": "aufgenommen am {date}",
  "photos.by": "Von {author}",
  "photos.licence": "Lizenz: {licence}",
  "photos.open": "In {name} öffnen",
  "photos.notSaved": "Die Fotos kommen von {name} und werden nicht mit dem Projekt gespeichert.",
};

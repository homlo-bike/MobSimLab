import type { streetPhotosEn } from "./en";

/** Nederlands: messages of the map's Street photos panel. */
export const streetPhotosNl: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Straatfoto's",
  "photos.title": "Straatfoto's",
  "photos.source": "Bron",
  "photos.hint":
    "Lijnen op de kaart tonen waar foto's zijn gemaakt. Klik op een punt op de kaart om de foto's in de buurt te zien.",
  "photos.zoomIn": "Zoom in om te zien waar foto's zijn gemaakt en klik dan op een punt op de kaart.",
  "photos.searching": "Foto's zoeken…",
  "photos.none": "Geen foto's binnen {radius} m van dit punt. Klik dichter bij een lijn.",
  "photos.failed": "De foto's konden niet worden geladen: {error}",
  "photos.count": "Foto {n} van {count}",
  "photos.previous": "Vorige",
  "photos.next": "Volgende",
  "photos.thumbs": "Foto's bij dit punt",
  "photos.alt": "Straatfoto {n} bij het aangeklikte punt",
  "photos.imageFailed": "Deze foto kon niet worden geladen.",
  "photos.panorama": "360°-foto",
  "photos.distance": "{m} m van het punt",
  "photos.taken": "gemaakt op {date}",
  "photos.by": "Door {author}",
  "photos.licence": "Licentie: {licence}",
  "photos.open": "Openen in {name}",
  "photos.notSaved": "De foto's komen van {name} en worden niet met het project opgeslagen.",
};

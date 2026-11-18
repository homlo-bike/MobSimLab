import type { streetPhotosEn } from "./en";

/** Italiano: messages of the map's Street photos panel. */
export const streetPhotosIt: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Foto stradali",
  "photos.title": "Foto stradali",
  "photos.source": "Fonte",
  "photos.hint":
    "Le linee sulla mappa mostrano dove sono state scattate foto. Fai clic su un punto della mappa per vedere le foto scattate vicino.",
  "photos.zoomIn":
    "Ingrandisci per vedere dove sono state scattate foto, poi fai clic su un punto della mappa.",
  "photos.searching": "Ricerca delle foto…",
  "photos.none": "Nessuna foto entro {radius} m da questo punto. Fai clic più vicino a una linea.",
  "photos.failed": "Impossibile caricare le foto: {error}",
  "photos.count": "Foto {n} di {count}",
  "photos.previous": "Precedente",
  "photos.next": "Successiva",
  "photos.thumbs": "Foto vicino a questo punto",
  "photos.alt": "Foto stradale {n} vicino al punto cliccato",
  "photos.imageFailed": "Impossibile caricare questa foto.",
  "photos.panorama": "Foto a 360°",
  "photos.distance": "a {m} m dal punto",
  "photos.taken": "scattata il {date}",
  "photos.by": "Di {author}",
  "photos.licence": "Licenza: {licence}",
  "photos.open": "Apri in {name}",
  "photos.notSaved": "Le foto provengono da {name} e non vengono salvate con il progetto.",
};

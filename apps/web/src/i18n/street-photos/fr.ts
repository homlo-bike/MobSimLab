import type { streetPhotosEn } from "./en";

/** Français: messages of the map's Street photos panel. */
export const streetPhotosFr: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Photos de rue",
  "photos.title": "Photos de rue",
  "photos.source": "Source",
  "photos.hint":
    "Les lignes sur la carte montrent où des photos ont été prises. Cliquez sur un point de la carte pour voir les photos prises à proximité.",
  "photos.zoomIn": "Zoomez pour voir où des photos ont été prises, puis cliquez sur un point de la carte.",
  "photos.searching": "Recherche de photos…",
  "photos.none": "Aucune photo à moins de {radius} m de ce point. Cliquez plus près d’une ligne.",
  "photos.failed": "Les photos n’ont pas pu être chargées : {error}",
  "photos.count": "Photo {n} sur {count}",
  "photos.previous": "Précédente",
  "photos.next": "Suivante",
  "photos.thumbs": "Photos près de ce point",
  "photos.alt": "Photo de rue {n} près du point cliqué",
  "photos.imageFailed": "Cette photo n’a pas pu être chargée.",
  "photos.panorama": "Photo à 360°",
  "photos.distance": "à {m} m du point",
  "photos.taken": "prise le {date}",
  "photos.by": "Par {author}",
  "photos.licence": "Licence : {licence}",
  "photos.open": "Ouvrir dans {name}",
  "photos.notSaved": "Les photos viennent de {name} et ne sont pas enregistrées avec le projet.",
};

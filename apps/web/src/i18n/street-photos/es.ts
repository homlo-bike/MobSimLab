import type { streetPhotosEn } from "./en";

/** Español: messages of the map's Street photos panel. */
export const streetPhotosEs: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Fotos de calle",
  "photos.title": "Fotos de calle",
  "photos.source": "Fuente",
  "photos.hint":
    "Las líneas del mapa muestran dónde se tomaron fotos. Haga clic en un punto del mapa para ver las fotos tomadas cerca.",
  "photos.zoomIn": "Acerque el mapa para ver dónde se tomaron fotos y luego haga clic en un punto del mapa.",
  "photos.searching": "Buscando fotos…",
  "photos.none": "No hay fotos a menos de {radius} m de este punto. Haga clic más cerca de una línea.",
  "photos.failed": "No se pudieron cargar las fotos: {error}",
  "photos.count": "Foto {n} de {count}",
  "photos.previous": "Anterior",
  "photos.next": "Siguiente",
  "photos.thumbs": "Fotos cerca de este punto",
  "photos.alt": "Foto de calle {n} cerca del punto pulsado",
  "photos.imageFailed": "No se pudo cargar esta foto.",
  "photos.panorama": "Foto de 360°",
  "photos.distance": "a {m} m del punto",
  "photos.taken": "tomada el {date}",
  "photos.by": "De {author}",
  "photos.licence": "Licencia: {licence}",
  "photos.open": "Abrir en {name}",
  "photos.notSaved": "Las fotos vienen de {name} y no se guardan con el proyecto.",
};

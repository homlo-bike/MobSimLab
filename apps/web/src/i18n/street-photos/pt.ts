import type { streetPhotosEn } from "./en";

/** Português: messages of the map's Street photos panel. */
export const streetPhotosPt: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Fotos de rua",
  "photos.title": "Fotos de rua",
  "photos.source": "Fonte",
  "photos.hint":
    "As linhas no mapa mostram onde foram tiradas fotos. Clique num ponto do mapa para ver as fotos tiradas perto dele.",
  "photos.zoomIn": "Aproxime o mapa para ver onde foram tiradas fotos e depois clique num ponto do mapa.",
  "photos.searching": "A procurar fotos…",
  "photos.none": "Não há fotos a menos de {radius} m deste ponto. Clique mais perto de uma linha.",
  "photos.failed": "Não foi possível carregar as fotos: {error}",
  "photos.count": "Foto {n} de {count}",
  "photos.previous": "Anterior",
  "photos.next": "Seguinte",
  "photos.thumbs": "Fotos perto deste ponto",
  "photos.alt": "Foto de rua {n} perto do ponto clicado",
  "photos.imageFailed": "Não foi possível carregar esta foto.",
  "photos.panorama": "Foto de 360°",
  "photos.distance": "a {m} m do ponto",
  "photos.taken": "tirada em {date}",
  "photos.by": "De {author}",
  "photos.licence": "Licença: {licence}",
  "photos.open": "Abrir em {name}",
  "photos.notSaved": "As fotos vêm de {name} e não são guardadas com o projeto.",
};

import type { streetPhotosEn } from "./en";

/** Русский: messages of the map's Street photos panel. */
export const streetPhotosRu: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Фото улиц",
  "photos.title": "Фото улиц",
  "photos.source": "Источник",
  "photos.hint":
    "Линии на карте показывают, где были сделаны фото. Нажмите на точку карты, чтобы увидеть фото, сделанные рядом с ней.",
  "photos.zoomIn": "Приблизьте карту, чтобы увидеть, где были сделаны фото, затем нажмите на точку карты.",
  "photos.searching": "Поиск фото…",
  "photos.none": "Нет фото в радиусе {radius} м от этой точки. Нажмите ближе к линии.",
  "photos.failed": "Не удалось загрузить фото: {error}",
  "photos.count": "Фото {n} из {count}",
  "photos.previous": "Назад",
  "photos.next": "Далее",
  "photos.thumbs": "Фото рядом с этой точкой",
  "photos.alt": "Фото улицы {n} рядом с выбранной точкой",
  "photos.imageFailed": "Не удалось загрузить это фото.",
  "photos.panorama": "Фото 360°",
  "photos.distance": "{m} м от точки",
  "photos.taken": "снято {date}",
  "photos.by": "Автор: {author}",
  "photos.licence": "Лицензия: {licence}",
  "photos.open": "Открыть в {name}",
  "photos.notSaved": "Фото берутся из {name} и не сохраняются в проекте.",
};

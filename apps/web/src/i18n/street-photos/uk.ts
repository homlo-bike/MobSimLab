import type { streetPhotosEn } from "./en";

/** Українська: messages of the map's Street photos panel. */
export const streetPhotosUk: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Фото вулиць",
  "photos.title": "Фото вулиць",
  "photos.source": "Джерело",
  "photos.hint":
    "Лінії на мапі показують, де були зроблені фото. Натисніть на точку мапи, щоб побачити фото, зроблені поруч.",
  "photos.zoomIn": "Наблизьте мапу, щоб побачити, де були зроблені фото, потім натисніть на точку мапи.",
  "photos.searching": "Пошук фото…",
  "photos.none": "Немає фото в радіусі {radius} м від цієї точки. Натисніть ближче до лінії.",
  "photos.failed": "Не вдалося завантажити фото: {error}",
  "photos.count": "Фото {n} з {count}",
  "photos.previous": "Назад",
  "photos.next": "Далі",
  "photos.thumbs": "Фото поруч із цією точкою",
  "photos.alt": "Фото вулиці {n} поруч із вибраною точкою",
  "photos.imageFailed": "Не вдалося завантажити це фото.",
  "photos.panorama": "Фото 360°",
  "photos.distance": "{m} м від точки",
  "photos.taken": "знято {date}",
  "photos.by": "Автор: {author}",
  "photos.licence": "Ліцензія: {licence}",
  "photos.open": "Відкрити в {name}",
  "photos.notSaved": "Фото беруться з {name} і не зберігаються в проєкті.",
};

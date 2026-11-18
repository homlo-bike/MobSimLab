import type { streetPhotosEn } from "./en";

/** Polski: messages of the map's Street photos panel. */
export const streetPhotosPl: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Zdjęcia ulic",
  "photos.title": "Zdjęcia ulic",
  "photos.source": "Źródło",
  "photos.hint":
    "Linie na mapie pokazują, gdzie zrobiono zdjęcia. Kliknij punkt na mapie, aby zobaczyć zdjęcia zrobione w pobliżu.",
  "photos.zoomIn": "Przybliż mapę, aby zobaczyć, gdzie zrobiono zdjęcia, a potem kliknij punkt na mapie.",
  "photos.searching": "Szukanie zdjęć…",
  "photos.none": "Brak zdjęć w promieniu {radius} m od tego punktu. Kliknij bliżej linii.",
  "photos.failed": "Nie udało się wczytać zdjęć: {error}",
  "photos.count": "Zdjęcie {n} z {count}",
  "photos.previous": "Poprzednie",
  "photos.next": "Następne",
  "photos.thumbs": "Zdjęcia w pobliżu tego punktu",
  "photos.alt": "Zdjęcie ulicy {n} w pobliżu klikniętego punktu",
  "photos.imageFailed": "Nie udało się wczytać tego zdjęcia.",
  "photos.panorama": "Zdjęcie 360°",
  "photos.distance": "{m} m od punktu",
  "photos.taken": "zrobione {date}",
  "photos.by": "Autor: {author}",
  "photos.licence": "Licencja: {licence}",
  "photos.open": "Otwórz w {name}",
  "photos.notSaved": "Zdjęcia pochodzą z {name} i nie są zapisywane w projekcie.",
};

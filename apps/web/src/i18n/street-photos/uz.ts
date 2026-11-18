import type { streetPhotosEn } from "./en";

/** Oʻzbekcha: messages of the map's Street photos panel. */
export const streetPhotosUz: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Koʻcha suratlari",
  "photos.title": "Koʻcha suratlari",
  "photos.source": "Manba",
  "photos.hint":
    "Xaritadagi chiziqlar suratlar qayerda olinganini koʻrsatadi. Yaqinida olingan suratlarni koʻrish uchun xaritadagi nuqtani bosing.",
  "photos.zoomIn":
    "Suratlar qayerda olinganini koʻrish uchun kattalashtiring, soʻng xaritadagi nuqtani bosing.",
  "photos.searching": "Suratlar qidirilmoqda…",
  "photos.none": "Bu nuqtadan {radius} m ichida surat yoʻq. Chiziqqa yaqinroq bosing.",
  "photos.failed": "Suratlarni yuklab boʻlmadi: {error}",
  "photos.count": "Surat {n} / {count}",
  "photos.previous": "Oldingi",
  "photos.next": "Keyingi",
  "photos.thumbs": "Shu nuqta yaqinidagi suratlar",
  "photos.alt": "Bosilgan nuqta yaqinidagi koʻcha surati {n}",
  "photos.imageFailed": "Bu suratni yuklab boʻlmadi.",
  "photos.panorama": "360° surat",
  "photos.distance": "nuqtadan {m} m",
  "photos.taken": "{date} da olingan",
  "photos.by": "Muallif: {author}",
  "photos.licence": "Litsenziya: {licence}",
  "photos.open": "{name} da ochish",
  "photos.notSaved": "Suratlar {name} dan olinadi va loyiha bilan saqlanmaydi.",
};

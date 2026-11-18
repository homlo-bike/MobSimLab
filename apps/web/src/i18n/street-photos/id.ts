import type { streetPhotosEn } from "./en";

/** Bahasa Indonesia: messages of the map's Street photos panel. */
export const streetPhotosId: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Foto jalan",
  "photos.title": "Foto jalan",
  "photos.source": "Sumber",
  "photos.hint":
    "Garis di peta menunjukkan tempat foto diambil. Klik satu titik di peta untuk melihat foto yang diambil di dekatnya.",
  "photos.zoomIn": "Perbesar peta untuk melihat tempat foto diambil, lalu klik satu titik di peta.",
  "photos.searching": "Mencari foto…",
  "photos.none": "Tidak ada foto dalam {radius} m dari titik ini. Klik lebih dekat ke sebuah garis.",
  "photos.failed": "Foto tidak dapat dimuat: {error}",
  "photos.count": "Foto {n} dari {count}",
  "photos.previous": "Sebelumnya",
  "photos.next": "Berikutnya",
  "photos.thumbs": "Foto di dekat titik ini",
  "photos.alt": "Foto jalan {n} di dekat titik yang diklik",
  "photos.imageFailed": "Foto ini tidak dapat dimuat.",
  "photos.panorama": "Foto 360°",
  "photos.distance": "{m} m dari titik",
  "photos.taken": "diambil pada {date}",
  "photos.by": "Oleh {author}",
  "photos.licence": "Lisensi: {licence}",
  "photos.open": "Buka di {name}",
  "photos.notSaved": "Foto berasal dari {name} dan tidak disimpan bersama proyek.",
};

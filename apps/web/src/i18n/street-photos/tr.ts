import type { streetPhotosEn } from "./en";

/** Türkçe: messages of the map's Street photos panel. */
export const streetPhotosTr: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Sokak fotoğrafları",
  "photos.title": "Sokak fotoğrafları",
  "photos.source": "Kaynak",
  "photos.hint":
    "Haritadaki çizgiler fotoğrafların nerede çekildiğini gösterir. Yakında çekilen fotoğrafları görmek için haritada bir noktaya tıklayın.",
  "photos.zoomIn":
    "Fotoğrafların nerede çekildiğini görmek için yakınlaştırın, sonra haritada bir noktaya tıklayın.",
  "photos.searching": "Fotoğraflar aranıyor…",
  "photos.none": "Bu noktanın {radius} m yakınında fotoğraf yok. Bir çizgiye daha yakın tıklayın.",
  "photos.failed": "Fotoğraflar yüklenemedi: {error}",
  "photos.count": "Fotoğraf {n} / {count}",
  "photos.previous": "Önceki",
  "photos.next": "Sonraki",
  "photos.thumbs": "Bu noktanın yakınındaki fotoğraflar",
  "photos.alt": "Tıklanan noktanın yakınındaki sokak fotoğrafı {n}",
  "photos.imageFailed": "Bu fotoğraf yüklenemedi.",
  "photos.panorama": "360° fotoğraf",
  "photos.distance": "noktaya {m} m",
  "photos.taken": "çekilme tarihi {date}",
  "photos.by": "Çeken: {author}",
  "photos.licence": "Lisans: {licence}",
  "photos.open": "{name} içinde aç",
  "photos.notSaved": "Fotoğraflar {name} kaynağından gelir ve projeyle kaydedilmez.",
};

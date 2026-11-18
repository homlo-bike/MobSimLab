import type { streetPhotosEn } from "./en";

/** 日本語: messages of the map's Street photos panel. */
export const streetPhotosJa: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "ストリート写真",
  "photos.title": "ストリート写真",
  "photos.source": "提供元",
  "photos.hint":
    "地図上の線は写真が撮影された場所を示します。地図上の地点をクリックすると、その近くで撮影された写真が表示されます。",
  "photos.zoomIn": "拡大して写真が撮影された場所を確認し、地図上の地点をクリックしてください。",
  "photos.searching": "写真を検索しています…",
  "photos.none": "この地点から {radius} m 以内に写真はありません。線の近くをクリックしてください。",
  "photos.failed": "写真を読み込めませんでした: {error}",
  "photos.count": "写真 {n} / {count}",
  "photos.previous": "前へ",
  "photos.next": "次へ",
  "photos.thumbs": "この地点の近くの写真",
  "photos.alt": "クリックした地点の近くのストリート写真 {n}",
  "photos.imageFailed": "この写真を読み込めませんでした。",
  "photos.panorama": "360° 写真",
  "photos.distance": "地点から {m} m",
  "photos.taken": "撮影日 {date}",
  "photos.by": "撮影者: {author}",
  "photos.licence": "ライセンス: {licence}",
  "photos.open": "{name} で開く",
  "photos.notSaved": "写真は {name} から表示され、プロジェクトには保存されません。",
};

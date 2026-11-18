import type { streetPhotosEn } from "./en";

/** 한국어: messages of the map's Street photos panel. */
export const streetPhotosKo: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "거리 사진",
  "photos.title": "거리 사진",
  "photos.source": "출처",
  "photos.hint":
    "지도 위의 선은 사진을 찍은 곳을 보여 줍니다. 지도에서 한 지점을 클릭하면 그 근처에서 찍은 사진을 볼 수 있습니다.",
  "photos.zoomIn": "사진을 찍은 곳을 보려면 확대한 다음 지도에서 한 지점을 클릭하세요.",
  "photos.searching": "사진을 찾는 중…",
  "photos.none": "이 지점에서 {radius}m 안에 사진이 없습니다. 선에 더 가까이 클릭하세요.",
  "photos.failed": "사진을 불러올 수 없습니다: {error}",
  "photos.count": "사진 {n}/{count}",
  "photos.previous": "이전",
  "photos.next": "다음",
  "photos.thumbs": "이 지점 근처의 사진",
  "photos.alt": "클릭한 지점 근처의 거리 사진 {n}",
  "photos.imageFailed": "이 사진을 불러올 수 없습니다.",
  "photos.panorama": "360° 사진",
  "photos.distance": "지점에서 {m}m",
  "photos.taken": "{date} 촬영",
  "photos.by": "촬영자: {author}",
  "photos.licence": "라이선스: {licence}",
  "photos.open": "{name}에서 열기",
  "photos.notSaved": "사진은 {name}에서 오며 프로젝트에 저장되지 않습니다.",
};

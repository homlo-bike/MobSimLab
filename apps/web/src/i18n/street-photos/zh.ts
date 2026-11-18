import type { streetPhotosEn } from "./en";

/** 中文: messages of the map's Street photos panel. */
export const streetPhotosZh: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "街景照片",
  "photos.title": "街景照片",
  "photos.source": "来源",
  "photos.hint": "地图上的线条显示拍摄照片的位置。点击地图上的一个点，查看在其附近拍摄的照片。",
  "photos.zoomIn": "放大地图以查看拍摄照片的位置，然后点击地图上的一个点。",
  "photos.searching": "正在查找照片…",
  "photos.none": "此点 {radius} 米范围内没有照片。请点击更靠近线条的位置。",
  "photos.failed": "无法加载照片：{error}",
  "photos.count": "第 {n} 张，共 {count} 张",
  "photos.previous": "上一张",
  "photos.next": "下一张",
  "photos.thumbs": "此点附近的照片",
  "photos.alt": "所点位置附近的街景照片 {n}",
  "photos.imageFailed": "无法加载此照片。",
  "photos.panorama": "360° 照片",
  "photos.distance": "距该点 {m} 米",
  "photos.taken": "拍摄于 {date}",
  "photos.by": "作者：{author}",
  "photos.licence": "许可：{licence}",
  "photos.open": "在 {name} 中打开",
  "photos.notSaved": "照片来自 {name}，不会随项目保存。",
};

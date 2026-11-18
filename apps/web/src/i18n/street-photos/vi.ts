import type { streetPhotosEn } from "./en";

/** Tiếng Việt: messages of the map's Street photos panel. */
export const streetPhotosVi: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Ảnh đường phố",
  "photos.title": "Ảnh đường phố",
  "photos.source": "Nguồn",
  "photos.hint":
    "Các đường trên bản đồ cho thấy nơi đã chụp ảnh. Nhấp vào một điểm trên bản đồ để xem các ảnh chụp gần đó.",
  "photos.zoomIn": "Phóng to để xem nơi đã chụp ảnh, rồi nhấp vào một điểm trên bản đồ.",
  "photos.searching": "Đang tìm ảnh…",
  "photos.none": "Không có ảnh nào trong bán kính {radius} m quanh điểm này. Hãy nhấp gần một đường hơn.",
  "photos.failed": "Không tải được ảnh: {error}",
  "photos.count": "Ảnh {n} / {count}",
  "photos.previous": "Trước",
  "photos.next": "Tiếp",
  "photos.thumbs": "Ảnh gần điểm này",
  "photos.alt": "Ảnh đường phố {n} gần điểm đã nhấp",
  "photos.imageFailed": "Không tải được ảnh này.",
  "photos.panorama": "Ảnh 360°",
  "photos.distance": "cách điểm {m} m",
  "photos.taken": "chụp ngày {date}",
  "photos.by": "Của {author}",
  "photos.licence": "Giấy phép: {licence}",
  "photos.open": "Mở trong {name}",
  "photos.notSaved": "Ảnh lấy từ {name} và không được lưu cùng dự án.",
};

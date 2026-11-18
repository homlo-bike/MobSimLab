import type { streetPhotosEn } from "./en";

/** فارسی: messages of the map's Street photos panel. */
export const streetPhotosFa: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "عکس‌های خیابانی",
  "photos.title": "عکس‌های خیابانی",
  "photos.source": "منبع",
  "photos.hint":
    "خط‌های روی نقشه نشان می‌دهند کجا عکس گرفته شده است. روی نقطه‌ای از نقشه کلیک کنید تا عکس‌های گرفته‌شده در نزدیکی آن را ببینید.",
  "photos.zoomIn": "بزرگ‌نمایی کنید تا ببینید کجا عکس گرفته شده، سپس روی نقطه‌ای از نقشه کلیک کنید.",
  "photos.searching": "در حال جست‌وجوی عکس‌ها…",
  "photos.none": "در فاصلهٔ {radius} متری این نقطه عکسی نیست. نزدیک‌تر به یک خط کلیک کنید.",
  "photos.failed": "عکس‌ها بارگیری نشدند: {error}",
  "photos.count": "عکس {n} از {count}",
  "photos.previous": "قبلی",
  "photos.next": "بعدی",
  "photos.thumbs": "عکس‌های نزدیک این نقطه",
  "photos.alt": "عکس خیابانی {n} نزدیک نقطهٔ کلیک‌شده",
  "photos.imageFailed": "این عکس بارگیری نشد.",
  "photos.panorama": "عکس ۳۶۰ درجه",
  "photos.distance": "{m} متر از نقطه",
  "photos.taken": "گرفته‌شده در {date}",
  "photos.by": "از {author}",
  "photos.licence": "مجوز: {licence}",
  "photos.open": "باز کردن در {name}",
  "photos.notSaved": "عکس‌ها از {name} می‌آیند و با پروژه ذخیره نمی‌شوند.",
};

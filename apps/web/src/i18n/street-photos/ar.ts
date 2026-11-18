import type { streetPhotosEn } from "./en";

/** العربية: messages of the map's Street photos panel. */
export const streetPhotosAr: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "صور الشوارع",
  "photos.title": "صور الشوارع",
  "photos.source": "المصدر",
  "photos.hint":
    "تُظهر الخطوط على الخريطة أماكن التقاط الصور. انقر على نقطة في الخريطة لرؤية الصور الملتقطة بالقرب منها.",
  "photos.zoomIn": "كبّر الخريطة لترى أماكن التقاط الصور، ثم انقر على نقطة في الخريطة.",
  "photos.searching": "جارٍ البحث عن الصور…",
  "photos.none": "لا توجد صور ضمن {radius} م من هذه النقطة. انقر أقرب إلى خط.",
  "photos.failed": "تعذّر تحميل الصور: {error}",
  "photos.count": "الصورة {n} من {count}",
  "photos.previous": "السابقة",
  "photos.next": "التالية",
  "photos.thumbs": "صور قرب هذه النقطة",
  "photos.alt": "صورة الشارع {n} قرب النقطة التي نقرت عليها",
  "photos.imageFailed": "تعذّر تحميل هذه الصورة.",
  "photos.panorama": "صورة 360°",
  "photos.distance": "على بعد {m} م من النقطة",
  "photos.taken": "التُقطت في {date}",
  "photos.by": "بواسطة {author}",
  "photos.licence": "الترخيص: {licence}",
  "photos.open": "فتح في {name}",
  "photos.notSaved": "تأتي الصور من {name} ولا تُحفظ مع المشروع.",
};

import type { streetPhotosEn } from "./en";

/** हिन्दी: messages of the map's Street photos panel. */
export const streetPhotosHi: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "सड़क की तस्वीरें",
  "photos.title": "सड़क की तस्वीरें",
  "photos.source": "स्रोत",
  "photos.hint":
    "नक्शे पर रेखाएँ दिखाती हैं कि तस्वीरें कहाँ ली गईं। पास में ली गई तस्वीरें देखने के लिए नक्शे पर किसी बिंदु पर क्लिक करें।",
  "photos.zoomIn":
    "तस्वीरें कहाँ ली गईं यह देखने के लिए ज़ूम इन करें, फिर नक्शे पर किसी बिंदु पर क्लिक करें।",
  "photos.searching": "तस्वीरें खोजी जा रही हैं…",
  "photos.none": "इस बिंदु से {radius} मी के भीतर कोई तस्वीर नहीं। किसी रेखा के पास क्लिक करें।",
  "photos.failed": "तस्वीरें लोड नहीं हो सकीं: {error}",
  "photos.count": "तस्वीर {n} / {count}",
  "photos.previous": "पिछली",
  "photos.next": "अगली",
  "photos.thumbs": "इस बिंदु के पास की तस्वीरें",
  "photos.alt": "क्लिक किए गए बिंदु के पास सड़क की तस्वीर {n}",
  "photos.imageFailed": "यह तस्वीर लोड नहीं हो सकी।",
  "photos.panorama": "360° तस्वीर",
  "photos.distance": "बिंदु से {m} मी",
  "photos.taken": "{date} को ली गई",
  "photos.by": "{author} द्वारा",
  "photos.licence": "लाइसेंस: {licence}",
  "photos.open": "{name} में खोलें",
  "photos.notSaved": "तस्वीरें {name} से आती हैं और प्रोजेक्ट के साथ सहेजी नहीं जातीं।",
};

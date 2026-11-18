import type { streetPhotosEn } from "./en";

/** বাংলা: messages of the map's Street photos panel. */
export const streetPhotosBn: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "রাস্তার ছবি",
  "photos.title": "রাস্তার ছবি",
  "photos.source": "উৎস",
  "photos.hint":
    "মানচিত্রের রেখাগুলো দেখায় কোথায় ছবি তোলা হয়েছে। কাছাকাছি তোলা ছবি দেখতে মানচিত্রে একটি বিন্দুতে ক্লিক করুন।",
  "photos.zoomIn": "কোথায় ছবি তোলা হয়েছে দেখতে জুম ইন করুন, তারপর মানচিত্রে একটি বিন্দুতে ক্লিক করুন।",
  "photos.searching": "ছবি খোঁজা হচ্ছে…",
  "photos.none": "এই বিন্দুর {radius} মি-এর মধ্যে কোনো ছবি নেই। একটি রেখার কাছে ক্লিক করুন।",
  "photos.failed": "ছবিগুলো লোড করা যায়নি: {error}",
  "photos.count": "ছবি {n} / {count}",
  "photos.previous": "আগের",
  "photos.next": "পরের",
  "photos.thumbs": "এই বিন্দুর কাছের ছবি",
  "photos.alt": "ক্লিক করা বিন্দুর কাছে রাস্তার ছবি {n}",
  "photos.imageFailed": "এই ছবিটি লোড করা যায়নি।",
  "photos.panorama": "360° ছবি",
  "photos.distance": "বিন্দু থেকে {m} মি",
  "photos.taken": "{date} তারিখে তোলা",
  "photos.by": "{author}-এর তোলা",
  "photos.licence": "লাইসেন্স: {licence}",
  "photos.open": "{name}-এ খুলুন",
  "photos.notSaved": "ছবিগুলো {name} থেকে আসে এবং প্রকল্পের সঙ্গে সংরক্ষিত হয় না।",
};

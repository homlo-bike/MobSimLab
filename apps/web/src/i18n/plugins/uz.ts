import type { PluginKey } from "../plugins";

/** Plugin messages (uz). */
export const pluginsUz = {
  "admin.plugins": "Plaginlar",
  "plugins.title": "Plaginlar",
  "plugins.intro":
    "Plaginlar transport turlari, vositalar va hisob-kitoblarni qo'shadi. Bu loyiha ishlatadiganlarini yoqing; o'chirilganda vositalari yashiriladi, chizilganlar saqlanadi.",
  "plugins.bundled": "MobSimLab bilan keladi",
  "plugins.by": "Nashriyotchi: {publisher}",
  "plugins.versionN": "Versiya {version}",
  "plugins.adds": "Qo'shadi: {list}",
  "plugins.uses": "Foydalanadi: {list}",
  "plugins.parameters": "Taxmin qiymatlari: {count}",
  "plugins.missing":
    "{version} versiyasi bu MobSimLab'dan olib tashlandi. Qayta ishlatish uchun boshqa versiyani tanlang.",
  "plugins.versionOf": "{name} versiyasi",
  "plugins.useIn": "{name} plaginini bu loyihada ishlatish",
  "plugins.ownerOnly": "Plaginlarni faqat loyiha egasi yoqishi yoki o'chirishi mumkin.",
  "plugins.perm.readNetwork": "loyiha tarmog'i",
  "plugins.perm.readTimetable": "jadval",
  "plugins.perm.readFleet": "transport vositalari va park",
  "plugins.perm.readGeodata": "import qilingan xarita ma'lumotlari",
  "plugins.perm.readResults": "simulyatsiya natijalari",
  "plugins.perm.writeResults": "o'z natijalarini saqlaydi",
  "plugins.perm.writeScenario": "ssenariyga o'zgarishlar taklif qiladi",
  "plugins.installTitle": "Plagin o'rnatish",
  "plugins.installIntro":
    ".msplugin faylini yuklang. MobSimLab uni tekshiradi va o'rnatishdan oldin nimani qo'shishini ko'rsatadi. O'rnatilgan plaginlar transport turlari, vositalar, parametrlar va manbalar qo'sha oladi; o'z kodiga ega plaginlar keyinroq keladi.",
  "plugins.choose": ".msplugin faylini tanlang",
  "plugins.problems": "Bu plaginni o'rnatib bo'lmaydi:",
  "plugins.install": "O'rnatish",
  "plugins.installed": "O'rnatilgan plaginlar",
  "plugins.none": "Hali plagin o'rnatilmagan.",
  "plugins.removeOne": "{name} {version} ni olib tashlash",
  "plugins.inProjects": "{count} ta loyihada ishlatiladi",
  "plugins.bundledTitle": "MobSimLab bilan kelganlar",
  "plugins.keys": "Ishonchli nashriyotchilar",
  "plugins.keysIntro":
    "Plagin faqat nashriyotchi uni shu kalitlardan biri bilan imzolagan bo'lsa o'rnatiladi (ECDSA P-256 yoki Ed25519, PEM).",
  "plugins.noKeys": "Hali ishonchli kalitlar yo'q.",
  "plugins.removeKey": "{name} ga ishonchni bekor qilish",
  "plugins.addKey": "Kalit qo'shish",
  "plugins.keyName": "Nashriyotchi nomi",
  "plugins.keyPem": "Ochiq kalit",
  "plugins.allowUnsigned": "Imzosiz plaginlarga ruxsat (ishlab chiqish rejimi, faqat egalar)",
  "plugins.signedBy": "{name} imzolagan",
  "plugins.untrusted": "Bu nusxa ishonmaydigan kalit bilan imzolangan",
  "plugins.unsigned": "Imzolanmagan",
  "plugins.licences": "Litsenziyalar: kod {code}, ma'lumotlar {data}",
  "plugins.removeConfirm":
    "{name} {count} ta loyihada yoqilgan. Baribir olib tashlansinmi? U yerda o'chiriladi, chizmalar saqlanadi.",
} satisfies Record<PluginKey, string>;

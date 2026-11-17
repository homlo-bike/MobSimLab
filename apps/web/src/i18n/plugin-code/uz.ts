import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (uz). */
export const pluginCodeUz = {
  "pcode.title": "Plagin hisoblari",
  "pcode.intro":
    "O‘rnatilgan plaginlar hisoblari. Ular brauzeringizdagi qum qutisida ishlaydi, internetga yoki boshqa loyihalarga kirishsiz.",
  "pcode.by": "{plugin} · {publisher}",
  "pcode.run": "Hisoblash",
  "pcode.running": "Hisoblanmoqda…",
  "pcode.failed": "{plugin} hisoblay olmadi: {error}",
  "pcode.noRows": "Qatorlar yo‘q.",
  "pcode.log": "Plagin jurnali ({count} qator)",
  "pcode.import": "{label} import qilish ({plugin})",
  "pcode.export": "{label} sifatida yuklab olish ({plugin})",
  "pcode.importFailed": "{plugin} faylni o‘qiy olmadi: {error}",
  "pcode.exportFailed": "{plugin} faylni yoza olmadi: {error}",
  "pcode.frameTitle": "{tab}, {plugin} plaginining sahifasi",
  "pcode.frameNote":
    "Bu sahifa {publisher} tomonidan chiqarilgan {plugin} plaginidan. U internetga yoki hisobingizga kira olmaydi.",
  "pcode.runsCode": "O‘z kodini qum qutisida ishga tushiradi",
  "pcode.limits": "Plagin kodi chegaralari",
  "pcode.limitsIntro":
    "Plagin kodining har bir chaqiruvi brauzerda va serverda ko‘pi bilan shuncha xotira va vaqt oladi.",
  "pcode.memory": "Xotira (MB)",
  "pcode.time": "Vaqt (soniya)",
  "pcode.saveLimits": "Chegaralarni saqlash",
  "pcode.saved": "Saqlandi.",
  "pcode.installIntro":
    ".msplugin faylini yuklang. MobSimLab uni tekshiradi va o‘rnatishdan oldin nima qo‘shishini ko‘rsatadi. Plaginlar transport turlari, vositalar, parametrlar va manbalar qo‘shishi hamda o‘z kodini (hisoblar, import, eksport va yorliq sahifalari) internetsiz qum qutisida ishga tushirishi mumkin.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Bir pikselga taxminan 0,3–1 m bo‘lgan aerofotosuratlar. Esri ArcGIS Location Platform hisobidan ArcGIS API kalitini va shartlariga roziligingizni talab qiladi. Plitkalar shu MobSimLab orqali keladi, shuning uchun brauzerlar kalitni hech qachon ko‘rmaydi va ular saqlanmaydi.",
  "esri.key": "ArcGIS API kaliti",
  "esri.accept": "Ushbu MobSimLab uchun Esri foydalanish shartlariga roziman",
  "esri.terms": "Esri shartlari",
  "esri.save": "Kalitni saqlash",
  "esri.remove": "Kalitni olib tashlash",
  "esri.saved":
    "{end} bilan tugaydigan kalitni {name} {date} kuni saqladi. Esri World Imagery xarita qatlamlari tanlovida mavjud.",
  "esri.none": "Kalit saqlanmagan: Esri World Imagery taklif qilinmaydi.",
} satisfies PluginCodeMessages;

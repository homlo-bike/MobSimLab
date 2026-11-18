import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (uz). */
export const workspaceUiUz = {
  "checks.menu": "Tekshiruvlar",
  "checks.menuCount": "Tekshiruvlar: {errors} ta xato, {warnings} ta ogohlantirish",
  "checks.title": "Barcha rejimlar tekshiruvlari",
  "checks.none":
    "Hozircha tekshiradigan narsa yoʻq. Liniya, temir yoʻl yoki depo chizing, uning tekshiruvlari shu yerda chiqadi.",
  "checks.lastOpened": "oxirgi marta ochilgandagidek",
  "checks.streetLine": "Koʻcha liniyasi · {name}",
  "checks.railway": "Temir yoʻl",
  "checks.depot": "Depo · {name}",
  "undo.undo": "Bekor qilish",
  "undo.redo": "Qaytarish",
  "tour.checks.title": "Tekshiruvlar",
  "tour.checks.body":
    "Qoʻngʻiroqcha barcha rejimlar tekshiruvlarini koʻrsatadi, avval xatolar: koʻcha liniyalari, temir yoʻl, depolar va plaginlar liniyalari. Qayerdaligini koʻrish uchun bittasini tanlang.",
  "settings.serverTab": "Server",
  "settings.server.local":
    "MobSimLab shu kompyuterda ishlamoqda. Buning oʻrniga ilovani fonda ishlaydigan MobSimLab serveriga, masalan, Docker serveriga ulashingiz mumkin.",
  "settings.server.address": "Server manzili",
  "settings.server.connect": "Ulash",
  "settings.server.note":
    "Ilova serverni tekshiradi va almashtirishdan oldin soʻraydi. Shu kompyuterdagi loyihalar shu yerda qoladi: ularni .mslab fayllari sifatida saqlab koʻchiring. Ilova sozlamalarida (⌘, yoki Ctrl+,) qaytishingiz mumkin.",
} satisfies WorkspaceUiMessages;

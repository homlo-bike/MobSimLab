import type { AreaMessages } from "./en";

/** Project area messages (uz). */
export const areaUz = {
  "aw.title": "Loyiha hududi",
  "aw.editing": "{name} hududi tahrirlanmoqda",
  "aw.search": "Xaritani siljitish uchun joy qidiring, masalan Hims",
  "aw.tools": "Chizish vositalari",
  "aw.draw": "Ko‘pburchak chizish",
  "aw.edit": "Nuqtalarni tahrirlash",
  "aw.pan": "Siljitish",
  "aw.hint.draw":
    "Uchlarni qo‘shish uchun bosing. Ko‘pburchakni yopish uchun birinchi uchni bosing yoki Enter tugmasini bosing. Backspace oxirgi uchni o‘chiradi.",
  "aw.hint.edit":
    "Tanlash uchun ko‘pburchakni bosing. Uchni siljitish uchun torting, uch qo‘shish uchun o‘rta nuqtani torting, uchni o‘chirish uchun ikki marta bosing.",
  "aw.hint.pan": "Xaritani siljitish uchun torting. Tanlash uchun ko‘pburchakni bosing.",
  "aw.statArea": "Maydon",
  "aw.statDownload": "Taxminiy yuklab olish",
  "aw.mb": "{mb} MB",
  "aw.limit": "Chegara {mb} MB",
  "aw.overLimit":
    "Hududda loyihaga ruxsat etilgan {mb} MB dan ko‘proq xarita ma’lumoti bor. Uni kichraytiring yoki yo‘nalishlar bo‘ylab ko‘pburchaklarni faqat asosiy yo‘llar va temir yo‘llarga qo‘ying.",
  "aw.polygons": "Ko‘pburchaklar",
  "aw.empty":
    "Hali ko‘pburchak yo‘q. Loyiha qamraydigan har bir joy atrofida bittadan, har bir shaharlararo yo‘nalish bo‘ylab esa tor ko‘pburchak chizing.",
  "aw.detail.full": "To‘liq",
  "aw.detail.main": "Faqat asosiy yo‘llar va temir yo‘llar",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Nomi",
  "aw.detail": "Tafsilot",
  "aw.fullHelp": "Ko‘chalar, yo‘laklar, binolar, maktab va shifoxonalar, 100 m qadamli aholi, relyef.",
  "aw.mainHelp":
    "Avtomagistrallar, magistral va asosiy yo‘llar, temir yo‘llar, relyef, 1 km qadamli aholi. Binolar yo‘q: shovqin xaritasi va piyoda yetib borish uchun yo‘nalishdagi shaharchalarni To‘liq qilib chizing.",
  "aw.delete": "Ko‘pburchakni o‘chirish",
  "aw.newName": "Hudud {n}",
  "aw.save": "Hududni saqlash",
  "aw.confirm.title": "Yangi qismlar uchun xarita ma’lumotini yuklab olaymi?",
  "aw.confirm.body":
    "Yangi yoki o‘zgargan: {list}. Ularga taxminan {mb} MB kerak. Olib tashlangan qismlar endi ishlatilmaydi. Tasdiqlamaguningizcha hech narsa yuklanmaydi.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Xaritaga qaytish",
  "aw.confirm.save": "Saqlash va {mb} MB yuklab olish",
  "aw.select": "Hududni tanlash",
  "aw.selectHint": "Loyiha chegaralarini xaritada chizing. Xarita ma’lumoti faqat ularning ichida yuklanadi.",
  "aw.change": "Hududni o‘zgartirish",
  "aw.download": "taxminan {mb} MB xarita ma’lumoti",
  "aw.outline": "Loyiha hududi chizmasi",
  "aw.prefsIntro":
    "Loyiha atrofida chizilgan ko‘pburchaklar. Xarita ma’lumoti faqat ularning ichida, har bir ko‘pburchak tafsilotida yuklanadi.",
  "aw.dataFrom": "{date} sanali xarita ma’lumoti",
  "aw.noData": "Xarita ma’lumoti hali yuklanmagan",
  "aw.editArea": "Hududni tahrirlash",
  "aw.drawArea": "Hudud chizish",
  "aw.refresh": "Xarita ma’lumotini yangilash",
  "aw.refreshHelp":
    "Yangilash shu hudud uchun joriy OpenStreetMap ma’lumotini yuklab oladi; ungacha reja ma’lumot sanasini saqlaydi.",
  "aw.none": "Hali loyiha hududi yo‘q. Vositalarda xarita ma’lumoti bo‘lishi uchun bittasini chizing.",
  "aw.saved": "Hudud saqlandi.",
  "aw.data.noArea": "Avval Loyiha sozlamalarida loyiha hududini chizing: importlar uni qamraydi.",
  "aw.data.area": "Loyiha hududi: {names}. Importlar uning atrofidagi to‘rtburchakni qamraydi, {area} km².",
  "aw.pop.none": "Hali loyiha hududi yo‘q. Uni Loyiha sozlamalarida chizing.",
  "aw.pop.box": "Loyiha hududi atrofidagi to‘rtburchak: {km2} km².",
  "aw.tiles.other": "{count} ta xarita plitkasi",
  "aw.count.other": "{count} ta ko‘pburchak",
  "aw.out.title": "Loyiha hududidan tashqaridagi xarita maʼlumotlari yuklab olinsinmi?",
  "aw.out.note":
    "{name} hududi loyiha hududidan tashqariga chiqadi. Uning tashqi qismi uchun yangi xarita maʼlumotlari kerak.",
  "aw.out.part": "Tashqi qism",
  "aw.out.km2": "taxminan {km2} km²",
  "aw.out.detail": "Tashqi qism tafsiloti",
  "aw.out.overLimit":
    "U bilan loyiha hududida bitta loyihaga ruxsat etilgan {mb} MB dan ko‘p xarita maʼlumotlari bo‘ladi. Faqat asosiy yo‘llar va temir yo‘llarni tanlang yoki loyiha sozlamalarida hududni kichraytiring.",
  "aw.out.adds":
    "Yuklab olish hududni loyiha hududiga yangi ko‘pburchak sifatida qo‘shadi, uni keyinroq hudud oynasida tahrirlash mumkin.",
  "aw.out.keep": "Hududni saqlash, yuklab olmaslik",
  "aw.out.download": "{mb} MB yuklab olish",
  "aw.out.downloading": "Yuklab olinmoqda…",
} satisfies AreaMessages;

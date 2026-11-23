import type { AdviceMessages } from "./en";

/** Advice messages (uz). */
export const adviceUz = {
  "advice.title": "Nimani yaxshilash kerak",
  "advice.intro":
    "Bu ishga tushirish topgan muammolar, eng jiddiysi birinchi, va har biri uchun nima qilish mumkinligi.",
  "advice.none": "Yaxshilaydigan narsa yo‘q: bu ishga tushirish tor joy ham, muammo ham topmadi.",
  "advice.show": "Xaritada ko‘rsatish",
  "advice.more": "Yana {n} ta ko‘rsatilmagan.",
  "advice.severity.problem": "Muammo",
  "advice.severity.warning": "Ogohlantirish",
  "advice.crowdMap":
    "Transportning qanchalik to‘laligini xaritada ko‘rsatish (har bir liniyaning eng gavjum soati)",
  "advice.cap.stopped": "{line}: ishga tushirish to‘xtadi: {problem}",
  "advice.cap.stoppedFix": "Buni temir yo‘l vositasida tuzating, so‘ng sinovni qayta ishga tushiring.",
  "advice.cap.unplaced": "{line}: yo‘lga sig‘maydigan reyslar: {n}",
  "advice.cap.unplacedFix":
    "Bu davrda liniyani kamroq qatnating yoki poyezdlari uchrashadigan joyda ko‘proq joy bering: {terminal} da ko‘proq platforma yo‘llari yoki o‘tish strelkalari, yoki bir yo‘lli qismda razyezd.",
  "advice.cap.terminal":
    "{line}: oxirgi bekat {terminal} tor joy, eng gavjum soatning {share} qismida band (chegara {limit})",
  "advice.cap.terminalFix":
    "Poyezdlar platforma yo‘llarini juda uzoq egallaydi. Aylanishni qisqartiring (qisqaroq turish yoki har bir uchda kutayotgan mashinist), platforma yo‘lini qo‘shing yoki poyezdlar uni tezroq bo‘shatishi uchun o‘tish strelkasini platformalarga yaqinlashtiring.",
  "advice.cap.section":
    "{line}: yo‘l qismi {section} tor joy, eng gavjum soatning {share} qismida band (chegara {limit})",
  "advice.cap.sectionFix":
    "Poyezdlar bu qismni boshqa har qandayidan uzoqroq egallaydi. Undagi yuqoriroq tezlik uni tezroq bo‘shatishga imkon beradi; aks holda bu yerda kamroq poyezd qatnating.",
  "advice.cap.sectionPlatform":
    "Bu qism platforma yo‘li: poyezdlar platformada turganda uni egallaydi. U yerda qisqaroq to‘xtashlar yoki shu yo‘nalish uchun ikkinchi platforma yo‘li keyingi poyezdni tezroq kiritadi.",
  "advice.cap.sectionSwitches":
    "Bu qism strelkalar hududi: strelkalar orqali marshrut o‘rnatilib, bo‘shatilguncha poyezdlar uni egallaydi. Yon yo‘nalishda tezligi yuqoriroq strelkalar yoki ikki yo‘nalish kesishmaydigan qilib joylashtirilgan strelkalar uni tezroq bo‘shatadi.",
  "advice.cap.signalAdd":
    "Bu peregon qismining uzunligi {length} m, lekin {speed} km/soat da blok-qismga atigi {block} m kerak. {track} yo‘lida taxminan {at} m joyga o‘tish svetoforini qo‘ying, shunda keyingi poyezd birinchi yarmiga tezroq kira oladi.",
  "advice.cap.signalShort":
    "Bu qismning uzunligi {length} m, {speed} km/soat da {block} m li ikki blok-qismdan kam, shuning uchun yana bir svetofor to‘xtash uchun juda kam joy qoldiradi. Kabina signalizatsiyasi (CBTC yoki ETCS 2-daraja) bilan yoki bu yerda pastroq tezlik bilan poyezdlar yaqinroq yura oladi.",
  "advice.cap.sectionCab":
    "Kabina signalizatsiyasida poyezdlar allaqachon tormozlash masofasida ({speed} km/soat da {block} m) yuradi; oraliqni svetoforlar belgilamaydi. Qismdagi yuqoriroq tezlik yoki kamroq poyezd uni tezroq bo‘shatadi.",
  "advice.cap.sectionSight":
    "Tramvaylar bu yerda ko‘rish bo‘yicha yuradi, shuning uchun oraliqni signallar belgilamaydi. Yaqindagi qisqaroq to‘xtashlar yoki ko‘cha harakatidan ajratilgan o‘z yo‘li uni tezroq bo‘shatadi.",
  "advice.cap.nearNote": "Hali ishlaydi, lekin poyezd qo‘shishga joy kam.",
  "advice.cap.pileUp": "{line}: kechikishlar to‘planib, davr oxirida o‘rtacha hali {late}",
  "advice.cap.pileUpFix":
    "Kechikkan poyezd keyingisini ushlab qolmasligi uchun oxirgi bekatlarda tiklanish vaqtini qo‘shing yoki biroz kamroq qatnating.",
  "advice.cap.full": "{line}: transport {from} dan {to} gacha {share} to‘la, {time}",
  "advice.cap.fullMore":
    "Davr davomida {left} kishi chiqa olmay qoladi. Yo‘l har bir yo‘nalishda soatiga {n} tagacha poyezdga imkon beradi: tez-tez qatnating yoki uzunroq poyezdlardan foydalaning.",
  "advice.cap.fullLonger":
    "Davr davomida {left} kishi chiqa olmay qoladi. Yo‘l imkon bersa, tez-tez qatnating yoki uzunroq transportdan foydalaning.",
  "advice.cap.streetPileUp": "{line}: ko‘chada kechikishlar to‘planib, oxirida hali {late}",
  "advice.cap.streetPileUpFix":
    "Transport kechikishni qoplashi uchun aylanishga ko‘proq vaqt yoki oxirgi bekatlarda uzunroq tanaffus rejalang; harakat bilan uchrashadigan joyda ajratilgan bo‘lak eng ko‘p yordam beradi.",
  "advice.road.cannotRun": "{line} ishga tushmadi",
  "advice.road.cannotRunFix":
    "{problem}. Yaratish → Koʻcha yoʻnalishi bo‘limida tuzating, so‘ng qayta ishga tushiring.",
  "advice.road.late": "{line}: jo‘nashlarning faqat {share} vaqtida ({limit} dan past bo‘lsa maslahat)",
  "advice.road.mostlySignals":
    "Har bir reys qizil chiroqda {signals} daq va harakatda {traffic} daq yo‘qotadi, ya’ni ko‘pi bu yerda sanalgan svetoforlarda.",
  "advice.road.mostlyTraffic":
    "Har bir reys harakatda {traffic} daq va qizil chiroqda {signals} daq yo‘qotadi, ya’ni ko‘pi bu yerda sanalgan ko‘chalarda.",
  "advice.road.moreTime":
    "Aylanish rejadagi {planned} daq o‘rniga {run} daq oldi: ko‘proq yurish vaqtini rejalang yoki bitta transport qo‘shing.",
  "advice.road.bunched": "{line}: jo‘nashlarning {share} to‘planib keladi",
  "advice.road.bunchedFix":
    "Transportlar bir-birini quvib yetadi. Ularni oxirgi bekatlarda jadval bo‘yicha ushlang, u yerda uzunroq tanaffus bering yoki liniya vaqt yo‘qotadigan joyda unga ajratilgan bo‘lak bering.",
  "advice.road.ranOut": "{line}: zaryadi tugagan transportlar: {n}",
  "advice.road.ranOutFix":
    "Kattaroq batareya ishlating, oxirgi bekatlarda zaryadlang yoki kunduzi transportlarni almashtiring.",
  "advice.road.stuck": "{line}: 5 daqiqa yoki undan ko‘p tiqilib qolgan transportlar: {n}",
  "advice.road.stuckFix":
    "GAT yorlig‘ida shu joydagi ko‘cha sozlamasi va svetoforlarni tekshiring: burilish yetishmasligi yoki harakat chorrahani to‘sib qo‘yishi mumkin.",
  "advice.road.notBack": "{line}: oxirida parkka qaytmagan transportlar: {n}",
  "advice.road.notBackFix":
    "Liniya va uning parki orasidagi yo‘lni tekshiring yoki oxirgi reysdan keyin ko‘proq vaqt qoldiring.",
  "advice.road.unnamedStreet": "nomsiz ko‘cha",
  "advice.road.unnamedJunction": "chorraha",
  "advice.road.spot.signal": "Qizil chiroq, {place}: jami {min} daq yo‘qotildi ({lines})",
  "advice.road.spot.signalFix":
    "Liniyalar bu yerda boshqa joylardan ko‘proq kutadi. Bu svetoforda ular uchun ustuvorlik yoki mos rejim so‘rang. Yo‘l simulyatsiyasi hali ustuvorlikni modellashtirmaydi, shuning uchun foydasini ko‘rsata olmaydi.",
  "advice.road.spot.street": "Harakat, {place}: jami {min} daq yo‘qotildi ({lines})",
  "advice.road.spot.streetFix":
    "Bu ko‘chada liniyalarga ajratilgan bo‘lak bering (GAT yorlig‘i, ko‘cha sozlamasi: avtobus bo‘lagi) yoki ularni boshqa ko‘chadan o‘tkazing.",
  "advice.road.spot.junction": "Turib qolish, {place}: jami {min} daq yo‘qotildi ({lines})",
  "advice.road.spot.junctionFix":
    "Transportlar burilishni yoki chiqish yo‘li bo‘shashini kutib, bu chorraha ichida turib qoladi. U yergacha ajratilgan bo‘lak yoki svetoforda alohida burilish fazasi yordam beradi.",
} satisfies AdviceMessages;

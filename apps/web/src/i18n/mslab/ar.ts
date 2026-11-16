import type { MslabMessages } from "./en";

/** .mslab project file messages (ar). */
export const mslabAr = {
  "menu.saveMslab": "حفظ كملف ‎.mslab",
  "home.openMslab": "فتح ملف ‎.mslab",
  "home.openingMslab": "جارٍ فتح الملف…",
  "home.openedMslab": "تم فتح «{name}» كمشروع جديد.",
  "home.leftOut": "لم يُضمَّن: {list}",
  "mslab.body":
    "يحفظ رسومات المشروع وتفضيلاته وسيناريوهاته وإضافاته في ملف واحد يمكنك فتحه مجددًا في أي نسخة من MobSimLab.",
  "mslab.runs": "تضمين عمليات المحاكاة المحفوظة (يصبح الملف أكبر)",
  "mslab.map":
    "تضمين بيانات الخريطة للعارض الثابت: الشوارع والمباني والسكان وأرقام البلد لمنطقة المشروع (ملف أكبر؛ قد يستغرق بضع دقائق)",
  "static.empty":
    "لا توجد مشاريع في هذا الموقع بعد. ضع ملفات ‎.mslab في مجلد projects وشغّل tools/add-projects.mjs.",
  "mslab.save": "حفظ الملف",
} satisfies MslabMessages;

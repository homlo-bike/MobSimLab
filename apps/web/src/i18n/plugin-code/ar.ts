import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ar). */
export const pluginCodeAr = {
  "pcode.title": "حسابات الإضافات",
  "pcode.intro":
    "حسابات الإضافات المثبّتة. تعمل في بيئة معزولة داخل متصفحك، دون وصول إلى الإنترنت أو إلى مشاريع أخرى.",
  "pcode.by": "{plugin} · من {publisher}",
  "pcode.run": "احسب",
  "pcode.running": "جارٍ الحساب…",
  "pcode.failed": "تعذّر على {plugin} الحساب: {error}",
  "pcode.noRows": "لا توجد صفوف.",
  "pcode.log": "سجل الإضافة ({count} سطرًا)",
  "pcode.import": "استيراد {label} ({plugin})",
  "pcode.export": "تنزيل بصيغة {label} ({plugin})",
  "pcode.importFailed": "تعذّر على {plugin} قراءة الملف: {error}",
  "pcode.exportFailed": "تعذّر على {plugin} كتابة الملف: {error}",
  "pcode.frameTitle": "{tab}، صفحة من الإضافة {plugin}",
  "pcode.frameNote":
    "هذه الصفحة من الإضافة {plugin} من {publisher}. لا يمكنها الوصول إلى الإنترنت أو إلى حسابك.",
  "pcode.runsCode": "تشغّل شيفرتها الخاصة في بيئة معزولة",
  "pcode.limits": "حدود شيفرة الإضافات",
  "pcode.limitsIntro":
    "يحصل كل استدعاء لشيفرة إضافة على هذا القدر من الذاكرة والوقت على الأكثر، في المتصفح وعلى الخادم.",
  "pcode.memory": "الذاكرة (ميغابايت)",
  "pcode.time": "الوقت (ثوانٍ)",
  "pcode.saveLimits": "حفظ الحدود",
  "pcode.saved": "تم الحفظ.",
  "pcode.installIntro":
    "ارفع ملف ‎.msplugin. يتحقق MobSimLab منه ويعرض ما يضيفه قبل التثبيت. يمكن للإضافات إضافة وسائط نقل وأدوات ومعاملات ومصادر، وتشغيل شيفرتها الخاصة (حسابات واستيراد وتصدير وصفحات تبويب) في بيئة معزولة دون وصول إلى الإنترنت.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "صور جوية بدقة نحو 0.3 إلى 1 م لكل بكسل. تطلب Esri مفتاح ArcGIS API من حساب ArcGIS Location Platform والموافقة على شروطها. تمر البلاطات عبر MobSimLab هذا، فلا ترى المتصفحات المفتاح أبدًا، ولا تُخزَّن.",
  "esri.key": "مفتاح ArcGIS API",
  "esri.accept": "أوافق على شروط استخدام Esri لـ MobSimLab هذا",
  "esri.terms": "شروط Esri",
  "esri.save": "حفظ المفتاح",
  "esri.remove": "إزالة المفتاح",
  "esri.saved":
    "المفتاح المنتهي بـ {end} حفظه {name} في {date}. تظهر Esri World Imagery في عنصر طبقات الخريطة.",
  "esri.none": "لا يوجد مفتاح محفوظ: لا تُعرض Esri World Imagery.",
} satisfies PluginCodeMessages;

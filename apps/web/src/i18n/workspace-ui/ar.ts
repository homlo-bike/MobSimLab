import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (ar). */
export const workspaceUiAr = {
  "checks.menu": "الفحوص",
  "checks.menuCount": "الفحوص: {errors} أخطاء، {warnings} تحذيرات",
  "checks.title": "فحوص جميع الأنماط",
  "checks.none": "لا شيء للفحص بعد. ارسم خطًا أو سكة حديد أو مستودعًا وستظهر فحوصه هنا.",
  "checks.lastOpened": "كما كانت عند آخر فتح",
  "checks.streetLine": "خط طرق · {name}",
  "checks.railway": "سكة حديد",
  "checks.depot": "مستودع · {name}",
  "undo.undo": "تراجع",
  "undo.redo": "إعادة",
  "tour.checks.title": "الفحوص",
  "tour.checks.body":
    "يعرض الجرس فحوص جميع الأنماط، الأخطاء أولًا: خطوط الطرق والسكة الحديد والمستودعات وخطوط الإضافات. اختر واحدًا لترى مكانه.",
  "settings.serverTab": "الخادم",
  "settings.pluginsTab": "الإضافات",
  "settings.server.local":
    "يعمل MobSimLab على هذا الحاسوب. يمكنك بدلًا من ذلك ربط هذا التطبيق بخادم MobSimLab يعمل في الخلفية، مثل خادم Docker.",
  "settings.server.address": "عنوان الخادم",
  "settings.server.connect": "اتصال",
  "settings.server.note":
    "يفحص التطبيق الخادم ويسألك قبل التبديل. تبقى المشاريع الموجودة على هذا الحاسوب هنا: انقلها بحفظها كملفات ‎.mslab. يمكنك العودة من إعدادات التطبيق (⌘, أو Ctrl+,).",
  "settings.plugins.intro":
    "ثبّت إضافات لـ MobSimLab هذا. بعدها يفعّلها كل مشروع أو يعطّلها في تفضيلات المشروع.",
} satisfies WorkspaceUiMessages;

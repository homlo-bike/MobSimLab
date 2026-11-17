import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (fa). */
export const workspaceUiFa = {
  "checks.menu": "بررسی‌ها",
  "checks.menuCount": "بررسی‌ها: {errors} خطا، {warnings} هشدار",
  "checks.title": "بررسی‌های همهٔ حالت‌ها",
  "checks.none":
    "هنوز چیزی برای بررسی نیست. یک خط، راه‌آهن یا پارکینگ بکشید تا بررسی‌هایش اینجا نمایش داده شود.",
  "checks.lastOpened": "مانند آخرین باز شدن",
  "checks.streetLine": "خط خیابانی · {name}",
  "checks.railway": "راه‌آهن",
  "checks.depot": "پارکینگ · {name}",
  "undo.undo": "واگرد",
  "undo.redo": "از نو",
  "tour.checks.title": "بررسی‌ها",
  "tour.checks.body":
    "زنگ بررسی‌های همهٔ حالت‌ها را فهرست می‌کند، اول خطاها: خطوط خیابانی، راه‌آهن، پارکینگ‌ها و خطوط افزونه‌ها. یکی را انتخاب کنید تا محلش را ببینید.",
  "settings.serverTab": "سرور",
  "settings.pluginsTab": "افزونه‌ها",
  "settings.server.local":
    "MobSimLab روی این رایانه اجرا می‌شود. به‌جای آن می‌توانید این برنامه را به یک سرور MobSimLab که در پس‌زمینه اجرا می‌شود، مانند سرور Docker، وصل کنید.",
  "settings.server.address": "نشانی سرور",
  "settings.server.connect": "اتصال",
  "settings.server.note":
    "برنامه سرور را بررسی می‌کند و پیش از تغییر می‌پرسد. پروژه‌های این رایانه همین‌جا می‌مانند: آن‌ها را با ذخیره به‌صورت فایل‌های ‎.mslab جابه‌جا کنید. می‌توانید در تنظیمات برنامه (⌘, یا Ctrl+,) بازگردید.",
  "settings.plugins.intro":
    "افزونه‌ها را برای این MobSimLab نصب کنید. سپس هر پروژه آن‌ها را در ترجیحات پروژهٔ خود روشن یا خاموش می‌کند.",
} satisfies WorkspaceUiMessages;

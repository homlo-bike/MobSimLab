import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (fa). */
export const pluginCodeFa = {
  "pcode.title": "محاسبات افزونه‌ها",
  "pcode.intro":
    "محاسبات افزونه‌های نصب‌شده. در محیطی ایزوله در مرورگر شما اجرا می‌شوند، بدون دسترسی به اینترنت یا پروژه‌های دیگر.",
  "pcode.by": "{plugin} · از {publisher}",
  "pcode.run": "محاسبه",
  "pcode.running": "در حال محاسبه…",
  "pcode.failed": "{plugin} نتوانست محاسبه کند: {error}",
  "pcode.noRows": "ردیفی نیست.",
  "pcode.log": "گزارش افزونه ({count} خط)",
  "pcode.import": "وارد کردن {label} ({plugin})",
  "pcode.export": "بارگیری به‌صورت {label} ({plugin})",
  "pcode.importFailed": "{plugin} نتوانست پرونده را بخواند: {error}",
  "pcode.exportFailed": "{plugin} نتوانست پرونده را بنویسد: {error}",
  "pcode.frameTitle": "{tab}، صفحه‌ای از افزونهٔ {plugin}",
  "pcode.frameNote": "این صفحه از افزونهٔ {plugin} از {publisher} است. به اینترنت یا حساب شما دسترسی ندارد.",
  "pcode.runsCode": "کد خودش را در محیطی ایزوله اجرا می‌کند",
  "pcode.limits": "محدودیت‌های کد افزونه",
  "pcode.limitsIntro": "هر فراخوانی کد افزونه حداکثر همین مقدار حافظه و زمان را دارد، در مرورگر و روی سرور.",
  "pcode.memory": "حافظه (مگابایت)",
  "pcode.time": "زمان (ثانیه)",
  "pcode.saveLimits": "ذخیرهٔ محدودیت‌ها",
  "pcode.saved": "ذخیره شد.",
  "pcode.installIntro":
    "یک پروندهٔ ‎.msplugin بارگذاری کنید. MobSimLab آن را بررسی می‌کند و پیش از نصب نشان می‌دهد چه چیزی اضافه می‌کند. افزونه‌ها می‌توانند شیوه‌های حمل‌ونقل، ابزارها، پارامترها و منابع اضافه کنند و کد خودشان (محاسبات، ورود، خروج و صفحه‌های زبانه) را در محیطی ایزوله بدون دسترسی به اینترنت اجرا کنند.",
} satisfies PluginCodeMessages;

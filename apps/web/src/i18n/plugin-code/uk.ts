import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (uk). */
export const pluginCodeUk = {
  "pcode.title": "Розрахунки плагінів",
  "pcode.intro": "Розрахунки встановлених плагінів. Вони виконуються в пісочниці у вашому браузері, без доступу до інтернету та інших проєктів.",
  "pcode.by": "{plugin} · від {publisher}",
  "pcode.run": "Розрахувати",
  "pcode.running": "Триває розрахунок…",
  "pcode.failed": "{plugin} не зміг виконати розрахунок: {error}",
  "pcode.noRows": "Немає рядків.",
  "pcode.log": "Журнал плагіна ({count} рядків)",
  "pcode.import": "Імпортувати {label} ({plugin})",
  "pcode.export": "Завантажити як {label} ({plugin})",
  "pcode.importFailed": "{plugin} не зміг прочитати файл: {error}",
  "pcode.exportFailed": "{plugin} не зміг записати файл: {error}",
  "pcode.frameTitle": "{tab}, сторінка плагіна {plugin}",
  "pcode.frameNote": "Ця сторінка з плагіна {plugin} від {publisher}. Вона не має доступу до інтернету чи вашого облікового запису.",
  "pcode.runsCode": "Виконує власний код у пісочниці",
  "pcode.limits": "Обмеження для коду плагінів",
  "pcode.limitsIntro": "Кожен виклик коду плагіна отримує щонайбільше стільки пам’яті й часу, у браузері та на сервері.",
  "pcode.memory": "Пам’ять (МБ)",
  "pcode.time": "Час (секунди)",
  "pcode.saveLimits": "Зберегти обмеження",
  "pcode.saved": "Збережено.",
  "pcode.installIntro": "Завантажте файл .msplugin. MobSimLab перевірить його й покаже, що він додає, до встановлення. Плагіни можуть додавати види транспорту, інструменти, параметри та джерела й виконувати власний код (розрахунки, імпорт, експорт і сторінки вкладок) у пісочниці без доступу до інтернету.",
} satisfies PluginCodeMessages;

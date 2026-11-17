import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (uk). */
export const pluginCodeUk = {
  "pcode.title": "Розрахунки плагінів",
  "pcode.intro":
    "Розрахунки встановлених плагінів. Вони виконуються в пісочниці у вашому браузері, без доступу до інтернету та інших проєктів.",
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
  "pcode.frameNote":
    "Ця сторінка з плагіна {plugin} від {publisher}. Вона не має доступу до інтернету чи вашого облікового запису.",
  "pcode.runsCode": "Виконує власний код у пісочниці",
  "pcode.limits": "Обмеження для коду плагінів",
  "pcode.limitsIntro":
    "Кожен виклик коду плагіна отримує щонайбільше стільки пам’яті й часу, у браузері та на сервері.",
  "pcode.memory": "Пам’ять (МБ)",
  "pcode.time": "Час (секунди)",
  "pcode.saveLimits": "Зберегти обмеження",
  "pcode.saved": "Збережено.",
  "pcode.installIntro":
    "Завантажте файл .msplugin. MobSimLab перевірить його й покаже, що він додає, до встановлення. Плагіни можуть додавати види транспорту, інструменти, параметри та джерела й виконувати власний код (розрахунки, імпорт, експорт і сторінки вкладок) у пісочниці без доступу до інтернету.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Аерофотознімки з роздільністю близько 0,3–1 м на піксель. Esri вимагає ключ API ArcGIS з облікового запису ArcGIS Location Platform і згоду з умовами. Тайли йдуть через цей MobSimLab, тож браузери не бачать ключа, і вони не зберігаються.",
  "esri.key": "Ключ API ArcGIS",
  "esri.accept": "Я приймаю умови використання Esri для цього MobSimLab",
  "esri.terms": "Умови Esri",
  "esri.save": "Зберегти ключ",
  "esri.remove": "Видалити ключ",
  "esri.saved":
    "Ключ, що закінчується на {end}, зберіг(ла) {name} {date}. Esri World Imagery доступний у виборі шарів карти.",
  "esri.none": "Ключ не збережено: Esri World Imagery не пропонується.",
} satisfies PluginCodeMessages;

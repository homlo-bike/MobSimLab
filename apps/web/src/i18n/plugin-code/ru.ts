import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (ru). */
export const pluginCodeRu = {
  "pcode.title": "Расчёты плагинов",
  "pcode.intro":
    "Расчёты установленных плагинов. Они выполняются в песочнице в вашем браузере, без доступа к интернету и другим проектам.",
  "pcode.by": "{plugin} · от {publisher}",
  "pcode.run": "Рассчитать",
  "pcode.running": "Идёт расчёт…",
  "pcode.failed": "{plugin} не смог выполнить расчёт: {error}",
  "pcode.noRows": "Нет строк.",
  "pcode.log": "Журнал плагина ({count} строк)",
  "pcode.import": "Импортировать {label} ({plugin})",
  "pcode.export": "Скачать как {label} ({plugin})",
  "pcode.importFailed": "{plugin} не смог прочитать файл: {error}",
  "pcode.exportFailed": "{plugin} не смог записать файл: {error}",
  "pcode.frameTitle": "{tab}, страница плагина {plugin}",
  "pcode.frameNote":
    "Эта страница из плагина {plugin} от {publisher}. У неё нет доступа к интернету и к вашей учётной записи.",
  "pcode.runsCode": "Выполняет собственный код в песочнице",
  "pcode.limits": "Ограничения для кода плагинов",
  "pcode.limitsIntro":
    "Каждый вызов кода плагина получает не больше этой памяти и этого времени, в браузере и на сервере.",
  "pcode.memory": "Память (МБ)",
  "pcode.time": "Время (секунды)",
  "pcode.saveLimits": "Сохранить ограничения",
  "pcode.saved": "Сохранено.",
  "pcode.installIntro":
    "Загрузите файл .msplugin. MobSimLab проверит его и покажет, что он добавляет, до установки. Плагины могут добавлять виды транспорта, инструменты, параметры и источники и выполнять собственный код (расчёты, импорт, экспорт и страницы вкладок) в песочнице без доступа к интернету.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Аэрофотоснимки с разрешением около 0,3–1 м на пиксель. Esri требует ключ API ArcGIS из учётной записи ArcGIS Location Platform и согласие с условиями. Тайлы идут через этот MobSimLab, поэтому браузеры не видят ключ, и они не сохраняются.",
  "esri.key": "Ключ API ArcGIS",
  "esri.accept": "Я принимаю условия использования Esri для этого MobSimLab",
  "esri.terms": "Условия Esri",
  "esri.save": "Сохранить ключ",
  "esri.remove": "Удалить ключ",
  "esri.saved":
    "Ключ, оканчивающийся на {end}, сохранил(а) {name} {date}. Esri World Imagery доступен в списке слоёв карты.",
  "esri.none": "Ключ не сохранён: Esri World Imagery не предлагается.",
} satisfies PluginCodeMessages;

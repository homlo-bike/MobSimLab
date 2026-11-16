import type { MslabMessages } from "./en";

/** .mslab project file messages (ru). */
export const mslabRu = {
  "menu.saveMslab": "Сохранить как файл .mslab",
  "home.openMslab": "Открыть файл .mslab",
  "home.openingMslab": "Открытие файла…",
  "home.openedMslab": "«{name}» открыт как новый проект.",
  "home.leftOut": "Не перенесено: {list}",
  "mslab.body":
    "Сохраняет чертежи, настройки, сценарии и плагины проекта в одном файле, который можно снова открыть в любом MobSimLab.",
  "mslab.runs": "Включить сохранённые симуляции (файл станет больше)",
  "mslab.map":
    "Включить картографические данные для статического просмотрщика: улицы, здания, население и данные страны для территории проекта (файл больше; может занять несколько минут)",
  "static.empty":
    "На этом сайте пока нет проектов. Поместите файлы .mslab в папку projects и запустите tools/add-projects.mjs.",
  "mslab.save": "Сохранить файл",
} satisfies MslabMessages;

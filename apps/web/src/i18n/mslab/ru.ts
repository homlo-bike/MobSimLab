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
  "savedFiles.title": "Сохраняемые файлы проекта",
  "savedFiles.intro":
    "Выберите, что содержит сохранённый файл .mslab. Проект, открытый из файла, сразу использует эти данные. Размеры указаны до сжатия файла.",
  "savedFiles.refresh": "Обновить",
  "savedFiles.loadFailed": "Не удалось загрузить размеры.",
  "savedFiles.whenSaving": "Создаётся при сохранении файла",
  "savedFiles.none": "Пока нет",
  "savedFiles.from": "Источник: {source}",
  "savedFiles.at": "Обновлено {date}",
  "savedFiles.update": "Обновить",
  "savedFiles.updateOf": "Обновить: {name}",
  "savedFiles.always": "Сохраняется всегда",
  "savedFiles.later": "Пока не сохраняется в файлах: появится в одном из следующих обновлений",
  "savedFiles.include": "Включать в сохраняемые файлы: {name}",
  "savedFiles.total": "Сейчас сохраняется в файлах: {size} до сжатия",
  "savedFiles.design": "Чертежи и настройки",
  "savedFiles.vehicles": "Собственные транспортные средства и парк",
  "savedFiles.processed": "Рассчитанные результаты (расписания, таблицы, ГИС, схема)",
  "savedFiles.runs": "Расчёты моделирования и спроса (с матрицами корреспонденций)",
  "savedFiles.comments": "Комментарии и обсуждения",
  "savedFiles.history": "История изменений",
  "savedFiles.osm": "Данные OpenStreetMap территории проекта",
  "savedFiles.liveTiles": "Фрагменты карты, загруженные инструментами в реальном времени",
  "savedFiles.elevation": "Высоты",
  "savedFiles.population": "Население",
  "savedFiles.uploads": "Ваши загруженные файлы карты, высот и населения",
  "savedFiles.facts": "Данные о местоположении (страна, праздники, климат)",
  "savedFiles.economy": "Экономические данные (Всемирный банк)",
  "savedFiles.otherFetched": "Другие загруженные данные (прокат велосипедов, глубины, места)",
  "savedFiles.viewerMap": "Картографические данные для статического просмотрщика",
  "mslab.results":
    "Включить результаты, рассчитанные инструментами (проект откроется без повторного расчёта)",
  "mslab.vehicles": "Включить собственные транспортные средства и парк проекта",
  "mslab.fromPrefs": "Этот выбор берётся из Настроек проекта → Сохраняемые файлы проекта.",
} satisfies MslabMessages;

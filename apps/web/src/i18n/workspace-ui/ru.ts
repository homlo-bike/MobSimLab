import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (ru). */
export const workspaceUiRu = {
  "checks.menu": "Проверки",
  "checks.menuCount": "Проверки: ошибок {errors}, предупреждений {warnings}",
  "checks.title": "Проверки всех режимов",
  "checks.none":
    "Пока нечего проверять. Нарисуйте линию, железную дорогу или депо, и проверки появятся здесь.",
  "checks.lastOpened": "на момент последнего открытия",
  "checks.streetLine": "Уличная линия · {name}",
  "checks.railway": "Железная дорога",
  "checks.depot": "Депо · {name}",
  "undo.undo": "Отменить",
  "undo.redo": "Повторить",
  "tour.checks.title": "Проверки",
  "tour.checks.body":
    "Колокольчик показывает проверки всех режимов, сначала ошибки: уличные линии, железную дорогу, депо и линии плагинов. Выберите проверку, чтобы увидеть, где она.",
  "settings.serverTab": "Сервер",
  "settings.server.local":
    "MobSimLab работает на этом компьютере. Вместо этого можно подключить приложение к серверу MobSimLab, работающему в фоне, например к серверу Docker.",
  "settings.server.address": "Адрес сервера",
  "settings.server.connect": "Подключить",
  "settings.server.note":
    "Приложение проверит сервер и спросит перед переключением. Проекты на этом компьютере останутся здесь: переносите их, сохраняя как файлы .mslab. Вернуться можно в Настройках приложения (⌘, или Ctrl+,).",
} satisfies WorkspaceUiMessages;

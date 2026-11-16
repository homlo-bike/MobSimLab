import type { MslabMessages } from "./en";

/** .mslab project file messages (uk). */
export const mslabUk = {
  "menu.saveMslab": "Зберегти як файл .mslab",
  "home.openMslab": "Відкрити файл .mslab",
  "home.openingMslab": "Відкриття файлу…",
  "home.openedMslab": "«{name}» відкрито як новий проєкт.",
  "home.leftOut": "Не перенесено: {list}",
  "mslab.body":
    "Зберігає креслення, налаштування, сценарії та плагіни проєкту в одному файлі, який можна знову відкрити в будь-якому MobSimLab.",
  "mslab.runs": "Додати збережені симуляції (файл буде більшим)",
  "mslab.map":
    "Додати картографічні дані для статичного переглядача: вулиці, будівлі, населення та дані країни для території проєкту (файл більший; може тривати кілька хвилин)",
  "static.empty":
    "На цьому сайті ще немає проєктів. Покладіть файли .mslab у теку projects і запустіть tools/add-projects.mjs.",
  "mslab.save": "Зберегти файл",
} satisfies MslabMessages;

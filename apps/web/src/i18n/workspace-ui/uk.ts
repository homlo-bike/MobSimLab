import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (uk). */
export const workspaceUiUk = {
  "checks.menu": "Перевірки",
  "checks.menuCount": "Перевірки: помилок {errors}, попереджень {warnings}",
  "checks.title": "Перевірки всіх режимів",
  "checks.none":
    "Поки що нічого перевіряти. Намалюйте лінію, залізницю або депо, і перевірки з’являться тут.",
  "checks.lastOpened": "станом на останнє відкриття",
  "checks.streetLine": "Вулична лінія · {name}",
  "checks.railway": "Залізниця",
  "checks.depot": "Депо · {name}",
  "undo.undo": "Скасувати",
  "undo.redo": "Повторити",
  "tour.checks.title": "Перевірки",
  "tour.checks.body":
    "Дзвоник показує перевірки всіх режимів, спершу помилки: вуличні лінії, залізницю, депо та лінії плагінів. Виберіть одну, щоб побачити, де вона.",
  "settings.serverTab": "Сервер",
  "settings.server.local":
    "MobSimLab працює на цьому комп’ютері. Натомість можна під’єднати застосунок до сервера MobSimLab, що працює у фоні, наприклад до сервера Docker.",
  "settings.server.address": "Адреса сервера",
  "settings.server.connect": "Під’єднати",
  "settings.server.note":
    "Застосунок перевірить сервер і запитає перед перемиканням. Проєкти на цьому комп’ютері залишаться тут: переносьте їх, зберігаючи як файли .mslab. Повернутися можна в Налаштуваннях застосунку (⌘, або Ctrl+,).",
} satisfies WorkspaceUiMessages;

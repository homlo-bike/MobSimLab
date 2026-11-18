import type { pluginAdminEn } from "./en";

/** Українська: messages of the Plugins tab of Administration. */
export const pluginAdminUk: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Плагіни цього MobSimLab. Плагін, вимкнений тут, вимкнений у кожному проєкті.",
  "padmin.publishers": "Видавці та обмеження",
  "padmin.configure": "Налаштувати",
  "padmin.configureName": "Налаштувати {name}",
  "padmin.useName": "Використовувати {name} у цьому MobSimLab",
  "padmin.offEverywhere": "Вимкнено в кожному проєкті",
  "padmin.needsKey": "Потрібен ключ API",
  "padmin.accept": "Прийняти зміни",
  "padmin.services": "Сервіси, які використовує цей плагін",
  "padmin.nothingToSet":
    "Цей плагін не потребує налаштування. Кожен проєкт вмикає або вимикає його в налаштуваннях проєкту.",
  "padmin.versions": "Встановлені версії",
  "padmin.undo": "Скасувати",
  "padmin.removedOnAccept": "Ключ буде видалено, коли ви приймете зміни.",
  "padmin.changedOnAccept": "Зміниться, коли ви приймете зміни.",
  "padmin.keyReplace": "Введіть новий ключ, щоб замінити збережений",
  "padmin.esriTermsFirst": "Прийміть умови використання Esri, щоб зберегти ключ.",
  "padmin.offByAdmin": "Вимкнено для цього MobSimLab адміністратором.",
};

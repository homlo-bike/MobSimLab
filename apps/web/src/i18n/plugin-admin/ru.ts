import type { pluginAdminEn } from "./en";

/** Русский: messages of the Plugins tab of Administration. */
export const pluginAdminRu: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Плагины этого MobSimLab. Плагин, выключенный здесь, выключен во всех проектах.",
  "padmin.publishers": "Издатели и ограничения",
  "padmin.configure": "Настроить",
  "padmin.configureName": "Настроить {name}",
  "padmin.useName": "Использовать {name} в этом MobSimLab",
  "padmin.offEverywhere": "Выключен во всех проектах",
  "padmin.needsKey": "Нужен ключ API",
  "padmin.accept": "Принять изменения",
  "padmin.services": "Сервисы, которые использует этот плагин",
  "padmin.nothingToSet":
    "У этого плагина нет настроек. Каждый проект включает или выключает его в настройках проекта.",
  "padmin.versions": "Установленные версии",
  "padmin.undo": "Отменить",
  "padmin.removedOnAccept": "Ключ будет удалён, когда вы примете изменения.",
  "padmin.changedOnAccept": "Изменится, когда вы примете изменения.",
  "padmin.keyReplace": "Введите новый ключ, чтобы заменить сохранённый",
  "padmin.esriTermsFirst": "Примите условия использования Esri, чтобы сохранить ключ.",
  "padmin.offByAdmin": "Выключен для этого MobSimLab администратором.",
};

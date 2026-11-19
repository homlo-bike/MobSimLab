import type { pluginAdminEn } from "./en";

/** Deutsch: messages of the Plugins tab of Administration. */
export const pluginAdminDe: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Plugins dieses MobSimLab. Ein hier ausgeschaltetes Plugin ist in jedem Projekt aus.",
  "padmin.publishers": "Herausgeber und Grenzen",
  "padmin.configure": "Einrichten",
  "padmin.configureName": "{name} einrichten",
  "padmin.useName": "{name} in diesem MobSimLab verwenden",
  "padmin.offEverywhere": "In jedem Projekt aus",
  "padmin.needsKey": "Braucht einen API-Schlüssel",
  "padmin.accept": "Änderungen übernehmen",
  "padmin.services": "Dienste, die dieses Plugin nutzt",
  "padmin.nothingToSet":
    "Bei diesem Plugin gibt es nichts einzurichten. Jedes Projekt schaltet es in den Projekteinstellungen ein oder aus.",
  "padmin.versions": "Installierte Versionen",
  "padmin.undo": "Rückgängig",
  "padmin.removedOnAccept": "Der Schlüssel wird entfernt, wenn Sie die Änderungen übernehmen.",
  "padmin.changedOnAccept": "Wird geändert, wenn Sie die Änderungen übernehmen.",
  "padmin.keyReplace": "Neuen Schlüssel eingeben, um den gespeicherten zu ersetzen",
  "padmin.esriTermsFirst": "Akzeptieren Sie die Nutzungsbedingungen von Esri, um den Schlüssel zu speichern.",
  "padmin.offByAdmin": "Von einem Administrator für dieses MobSimLab ausgeschaltet.",
};

import type { pluginAdminEn } from "./en";

/** Español: messages of the Plugins tab of Administration. */
export const pluginAdminEs: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro":
    "Plugins de este MobSimLab. Un plugin que desactive aquí queda desactivado en todos los proyectos.",
  "padmin.publishers": "Editores y límites",
  "padmin.configure": "Configurar",
  "padmin.configureName": "Configurar {name}",
  "padmin.useName": "Usar {name} en este MobSimLab",
  "padmin.offEverywhere": "Desactivado en todos los proyectos",
  "padmin.needsKey": "Necesita una clave de API",
  "padmin.accept": "Aceptar cambios",
  "padmin.services": "Servicios que usa este plugin",
  "padmin.nothingToSet":
    "Este plugin no tiene nada que configurar. Cada proyecto lo activa o desactiva en Preferencias del proyecto.",
  "padmin.versions": "Versiones instaladas",
  "padmin.undo": "Deshacer",
  "padmin.removedOnAccept": "La clave se elimina cuando acepte los cambios.",
  "padmin.changedOnAccept": "Se cambia cuando acepte los cambios.",
  "padmin.keyReplace": "Escriba una clave nueva para sustituir la guardada",
  "padmin.esriTermsFirst": "Acepte las condiciones de uso de Esri para guardar la clave.",
  "padmin.offByAdmin": "Desactivado para este MobSimLab por un administrador.",
};

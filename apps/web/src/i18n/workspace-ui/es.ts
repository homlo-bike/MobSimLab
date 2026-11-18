import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (es). */
export const workspaceUiEs = {
  "checks.menu": "Comprobaciones",
  "checks.menuCount": "Comprobaciones: {errors} errores, {warnings} avisos",
  "checks.title": "Comprobaciones de todos los modos",
  "checks.none":
    "Aún no hay nada que comprobar. Dibuje una línea, un ferrocarril o un depósito y sus comprobaciones aparecerán aquí.",
  "checks.lastOpened": "según la última vez abierto",
  "checks.streetLine": "Línea de calle · {name}",
  "checks.railway": "Ferrocarril",
  "checks.depot": "Depósito · {name}",
  "undo.undo": "Deshacer",
  "undo.redo": "Rehacer",
  "tour.checks.title": "Comprobaciones",
  "tour.checks.body":
    "La campana muestra las comprobaciones de todos los modos, primero los errores: líneas de calle, ferrocarril, depósitos y líneas de los complementos. Elija una para ver dónde está.",
  "settings.serverTab": "Servidor",
  "settings.server.local":
    "MobSimLab se ejecuta en este equipo. En su lugar, puede conectar esta aplicación a un servidor MobSimLab que funcione en segundo plano, como el servidor Docker.",
  "settings.server.address": "Dirección del servidor",
  "settings.server.connect": "Conectar",
  "settings.server.note":
    "La aplicación comprueba el servidor y pregunta antes de cambiar. Los proyectos de este equipo se quedan aquí: muévalos guardándolos como archivos .mslab. Puede volver en los Ajustes de la aplicación (⌘, o Ctrl+,).",
} satisfies WorkspaceUiMessages;

import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (fr). */
export const workspaceUiFr = {
  "checks.menu": "Vérifications",
  "checks.menuCount": "Vérifications : {errors} erreurs, {warnings} avertissements",
  "checks.title": "Vérifications de tous les modes",
  "checks.none":
    "Rien à vérifier pour l’instant. Dessinez une ligne, une voie ferrée ou un dépôt et ses vérifications apparaîtront ici.",
  "checks.lastOpened": "état à la dernière ouverture",
  "checks.streetLine": "Ligne routière · {name}",
  "checks.railway": "Voie ferrée",
  "checks.depot": "Dépôt · {name}",
  "undo.undo": "Annuler",
  "undo.redo": "Rétablir",
  "tour.checks.title": "Vérifications",
  "tour.checks.body":
    "La cloche liste les vérifications de tous les modes, erreurs d’abord : lignes routières, voie ferrée, dépôts et lignes des extensions. Choisissez-en une pour voir où elle se trouve.",
  "settings.serverTab": "Serveur",
  "settings.pluginsTab": "Extensions",
  "settings.server.local":
    "MobSimLab fonctionne sur cet ordinateur. Vous pouvez plutôt connecter cette application à un serveur MobSimLab qui tourne en arrière-plan, comme le serveur Docker.",
  "settings.server.address": "Adresse du serveur",
  "settings.server.connect": "Se connecter",
  "settings.server.note":
    "L’application vérifie le serveur et demande avant de basculer. Les projets de cet ordinateur restent ici : déplacez-les en les enregistrant en fichiers .mslab. Vous pouvez revenir dans les Réglages de l’application (⌘, ou Ctrl+,).",
  "settings.plugins.intro":
    "Installez des extensions pour ce MobSimLab. Chaque projet les active ou les désactive ensuite dans ses Préférences du projet.",
} satisfies WorkspaceUiMessages;

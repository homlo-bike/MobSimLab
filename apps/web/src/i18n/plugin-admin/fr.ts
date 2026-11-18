import type { pluginAdminEn } from "./en";

/** Français: messages of the Plugins tab of Administration. */
export const pluginAdminFr: Record<keyof typeof pluginAdminEn, string> = {
  "padmin.intro": "Plugins de ce MobSimLab. Un plugin désactivé ici est désactivé dans tous les projets.",
  "padmin.publishers": "Éditeurs et limites",
  "padmin.configure": "Configurer",
  "padmin.configureName": "Configurer {name}",
  "padmin.useName": "Utiliser {name} sur ce MobSimLab",
  "padmin.offEverywhere": "Désactivé dans tous les projets",
  "padmin.needsKey": "Clé d'API requise",
  "padmin.accept": "Accepter les modifications",
  "padmin.services": "Services utilisés par ce plugin",
  "padmin.nothingToSet":
    "Ce plugin n'a rien à configurer. Chaque projet l'active ou le désactive dans les Préférences du projet.",
  "padmin.versions": "Versions installées",
  "padmin.undo": "Annuler",
  "padmin.removedOnAccept": "La clé sera supprimée quand vous accepterez les modifications.",
  "padmin.changedOnAccept": "Modifié quand vous accepterez les modifications.",
  "padmin.keyReplace": "Saisissez une nouvelle clé pour remplacer celle enregistrée",
  "padmin.esriTermsFirst": "Acceptez les conditions d'utilisation d'Esri pour enregistrer la clé.",
  "padmin.offByAdmin": "Désactivé pour ce MobSimLab par un administrateur.",
};

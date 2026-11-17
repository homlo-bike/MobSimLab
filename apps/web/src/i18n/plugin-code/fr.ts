import type { PluginCodeMessages } from "./en";

/** Messages for plugins that run their own code (fr). */
export const pluginCodeFr = {
  "pcode.title": "Calculs des plugins",
  "pcode.intro":
    "Calculs des plugins installés. Ils s’exécutent dans un bac à sable de votre navigateur, sans accès à Internet ni aux autres projets.",
  "pcode.by": "{plugin} · par {publisher}",
  "pcode.run": "Calculer",
  "pcode.running": "Calcul en cours…",
  "pcode.failed": "{plugin} n’a pas pu calculer : {error}",
  "pcode.noRows": "Aucune ligne.",
  "pcode.log": "Journal du plugin ({count} lignes)",
  "pcode.import": "Importer {label} ({plugin})",
  "pcode.export": "Télécharger en {label} ({plugin})",
  "pcode.importFailed": "{plugin} n’a pas pu lire le fichier : {error}",
  "pcode.exportFailed": "{plugin} n’a pas pu écrire le fichier : {error}",
  "pcode.frameTitle": "{tab}, une page du plugin {plugin}",
  "pcode.frameNote":
    "Cette page vient du plugin {plugin} de {publisher}. Elle n’a accès ni à Internet ni à votre compte.",
  "pcode.runsCode": "Exécute son propre code dans un bac à sable",
  "pcode.limits": "Limites du code des plugins",
  "pcode.limitsIntro":
    "Chaque appel du code d’un plugin reçoit au plus cette mémoire et ce temps, dans le navigateur et sur le serveur.",
  "pcode.memory": "Mémoire (Mo)",
  "pcode.time": "Temps (secondes)",
  "pcode.saveLimits": "Enregistrer les limites",
  "pcode.saved": "Enregistré.",
  "pcode.installIntro":
    "Téléversez un fichier .msplugin. MobSimLab le vérifie et montre ce qu’il ajoute avant l’installation. Les plugins peuvent ajouter des modes, des outils, des paramètres et des sources, et exécuter leur propre code (calculs, imports, exports et pages d’onglet) dans un bac à sable sans accès à Internet.",
  "esri.title": "Esri World Imagery",
  "esri.intro":
    "Photos aériennes d'environ 0,3 à 1 m par pixel. Esri exige une clé d'API ArcGIS issue d'un compte ArcGIS Location Platform et l'acceptation de ses conditions. Les tuiles passent par ce MobSimLab : les navigateurs ne voient jamais la clé, et elles ne sont pas conservées.",
  "esri.key": "Clé d'API ArcGIS",
  "esri.accept": "J'accepte les conditions d'utilisation d'Esri pour ce MobSimLab",
  "esri.terms": "Conditions d'Esri",
  "esri.save": "Enregistrer la clé",
  "esri.remove": "Retirer la clé",
  "esri.saved":
    "Clé se terminant par {end} enregistrée par {name} le {date}. Esri World Imagery est proposé dans le sélecteur de couches de la carte.",
  "esri.none": "Aucune clé enregistrée : Esri World Imagery n'est pas proposé.",
} satisfies PluginCodeMessages;

import type { PluginKey } from "../plugins";

/** Plugin messages (fr). */
export const pluginsFr = {
  "admin.plugins": "Extensions",
  "plugins.title": "Extensions",
  "plugins.intro":
    "Les extensions ajoutent des modes de transport, des outils et des calculs. Activez celles que ce projet utilise ; désactivée, une extension masque ses outils et conserve ce qui a été dessiné.",
  "plugins.bundled": "Fournie avec MobSimLab",
  "plugins.by": "Par {publisher}",
  "plugins.versionN": "Version {version}",
  "plugins.adds": "Ajoute : {list}",
  "plugins.uses": "Utilise : {list}",
  "plugins.parameters": "{count} valeurs d'hypothèse",
  "plugins.missing":
    "La version {version} a été retirée de ce MobSimLab. Choisissez une autre version pour l'utiliser à nouveau.",
  "plugins.versionOf": "Version de {name}",
  "plugins.useIn": "Utiliser {name} dans ce projet",
  "plugins.ownerOnly": "Seul le propriétaire du projet peut activer ou désactiver les extensions.",
  "plugins.perm.readNetwork": "le réseau du projet",
  "plugins.perm.readTimetable": "l'horaire",
  "plugins.perm.readFleet": "les véhicules et la flotte",
  "plugins.perm.readGeodata": "les données cartographiques importées",
  "plugins.perm.readResults": "les résultats de simulation",
  "plugins.perm.writeResults": "enregistre ses propres résultats",
  "plugins.perm.writeScenario": "propose des modifications du scénario",
  "plugins.installTitle": "Installer une extension",
  "plugins.choose": "Choisir un fichier .msplugin",
  "plugins.problems": "Cette extension ne peut pas être installée :",
  "plugins.install": "Installer",
  "plugins.installed": "Extensions installées",
  "plugins.none": "Aucune extension installée pour l'instant.",
  "plugins.removeOne": "Retirer {name} {version}",
  "plugins.inProjects": "Utilisée dans {count} projets",
  "plugins.bundledTitle": "Fournies avec MobSimLab",
  "plugins.keys": "Éditeurs de confiance",
  "plugins.keysIntro":
    "Une extension s'installe seulement si son éditeur l'a signée avec l'une de ces clés (ECDSA P-256 ou Ed25519, PEM).",
  "plugins.noKeys": "Aucune clé de confiance pour l'instant.",
  "plugins.removeKey": "Ne plus faire confiance à {name}",
  "plugins.addKey": "Ajouter la clé",
  "plugins.keyName": "Nom de l'éditeur",
  "plugins.keyPem": "Clé publique",
  "plugins.allowUnsigned":
    "Autoriser les extensions non signées (mode développement, propriétaires seulement)",
  "plugins.signedBy": "Signée par {name}",
  "plugins.untrusted": "Signée avec une clé à laquelle cette instance ne fait pas confiance",
  "plugins.unsigned": "Non signée",
  "plugins.licences": "Licences : code {code}, données {data}",
  "plugins.removeConfirm":
    "{name} est activée dans {count} projets. La retirer quand même ? Elle y sera désactivée et les dessins seront conservés.",
} satisfies Record<PluginKey, string>;

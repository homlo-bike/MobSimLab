import type { MslabMessages } from "./en";

/** .mslab project file messages (fr). */
export const mslabFr = {
  "menu.saveMslab": "Enregistrer en fichier .mslab",
  "home.openMslab": "Ouvrir un fichier .mslab",
  "home.openingMslab": "Ouverture du fichier…",
  "home.openedMslab": "« {name} » ouvert comme nouveau projet.",
  "home.leftOut": "Non repris : {list}",
  "mslab.body":
    "Enregistre les dessins, préférences, scénarios et plugins du projet dans un fichier que vous pouvez rouvrir dans n’importe quel MobSimLab.",
  "mslab.runs": "Inclure les simulations enregistrées (fichier plus volumineux)",
  "mslab.map":
    "Inclure les données cartographiques pour la visionneuse statique : rues, bâtiments, population et chiffres du pays de la zone du projet (fichier plus lourd ; peut prendre quelques minutes)",
  "static.empty":
    "Ce site ne contient pas encore de projet. Placez des fichiers .mslab dans son dossier projects et lancez tools/add-projects.mjs.",
  "mslab.save": "Enregistrer le fichier",
} satisfies MslabMessages;

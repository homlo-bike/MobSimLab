import type { AreaMessages } from "./en";

/** Project area messages (fr). */
export const areaFr = {
  "aw.title": "Zone du projet",
  "aw.editing": "Modification de la zone de {name}",
  "aw.search": "Rechercher un lieu pour déplacer la carte, par exemple Homs",
  "aw.tools": "Outils de dessin",
  "aw.draw": "Dessiner un polygone",
  "aw.edit": "Modifier les points",
  "aw.pan": "Déplacer",
  "aw.hint.draw":
    "Cliquez pour ajouter des sommets. Cliquez sur le premier sommet ou appuyez sur Entrée pour fermer le polygone. Retour arrière supprime le dernier sommet.",
  "aw.hint.edit":
    "Cliquez sur un polygone pour le sélectionner. Faites glisser un sommet pour le déplacer, un point milieu pour ajouter un sommet, double-cliquez sur un sommet pour le supprimer.",
  "aw.hint.pan": "Faites glisser pour déplacer la carte. Cliquez sur un polygone pour le sélectionner.",
  "aw.statArea": "Superficie",
  "aw.statDownload": "Téléchargement estimé",
  "aw.mb": "{mb} Mo",
  "aw.limit": "Limite {mb} Mo",
  "aw.overLimit":
    "La zone contient plus de données cartographiques que les {mb} Mo autorisés par projet. Réduisez-la, ou réglez les polygones le long des trajets sur routes principales et voies ferrées seulement.",
  "aw.polygons": "Polygones",
  "aw.empty":
    "Aucun polygone pour l’instant. Dessinez-en un autour de chaque lieu couvert par le projet, et un étroit le long de chaque liaison interurbaine.",
  "aw.detail.full": "Complet",
  "aw.detail.main": "Routes principales et voies ferrées seulement",
  "aw.polyLine": "{detail} · {area} km²",
  "aw.name": "Nom",
  "aw.detail": "Niveau de détail",
  "aw.fullHelp": "Rues, chemins, bâtiments, écoles et hôpitaux, population à 100 m, relief.",
  "aw.mainHelp":
    "Autoroutes, routes nationales et principales, voies ferrées, relief, population à 1 km. Pas de bâtiments : dessinez les villes du trajet en Complet pour la carte du bruit et l’accès à pied.",
  "aw.delete": "Supprimer le polygone",
  "aw.newName": "Zone {n}",
  "aw.save": "Enregistrer la zone",
  "aw.confirm.title": "Télécharger les données cartographiques des nouvelles parties ?",
  "aw.confirm.body":
    "Nouvelles ou modifiées : {list}. Elles demandent environ {mb} Mo. Les parties retirées ne servent plus. Rien n’est téléchargé avant votre confirmation.",
  "aw.confirm.item": "{name} ({detail}, {area} km²)",
  "aw.confirm.back": "Retour à la carte",
  "aw.confirm.save": "Enregistrer et télécharger {mb} Mo",
  "aw.select": "Choisir la zone",
  "aw.selectHint":
    "Dessinez les limites du projet sur une carte. Les données cartographiques ne sont téléchargées qu’à l’intérieur.",
  "aw.change": "Modifier la zone",
  "aw.download": "environ {mb} Mo de données cartographiques",
  "aw.outline": "Contour de la zone du projet",
  "aw.prefsIntro":
    "Les polygones dessinés autour du projet. Les données cartographiques ne sont téléchargées qu’à l’intérieur, au niveau de détail de chaque polygone.",
  "aw.dataFrom": "Données cartographiques du {date}",
  "aw.noData": "Données cartographiques pas encore téléchargées",
  "aw.editArea": "Modifier la zone",
  "aw.drawArea": "Dessiner la zone",
  "aw.refresh": "Actualiser les données cartographiques",
  "aw.refreshHelp":
    "Actualiser télécharge les données OpenStreetMap actuelles pour la même zone ; d’ici là, le plan garde la date de ses données.",
  "aw.none":
    "Pas encore de zone du projet. Dessinez-en une pour que les outils aient des données cartographiques.",
  "aw.saved": "Zone enregistrée.",
  "aw.data.noArea":
    "Dessinez d’abord la zone du projet dans Préférences du projet : les imports la couvrent.",
  "aw.data.area": "Zone du projet : {names}. Les imports couvrent le rectangle qui l’entoure, {area} km².",
  "aw.pop.none": "Pas encore de zone du projet. Dessinez-la dans Préférences du projet.",
  "aw.pop.box": "Le rectangle autour de la zone du projet : {km2} km².",
  "aw.tiles.one": "{count} tuile de carte",
  "aw.tiles.other": "{count} tuiles de carte",
  "aw.count.one": "{count} polygone",
  "aw.count.other": "{count} polygones",
} satisfies AreaMessages;

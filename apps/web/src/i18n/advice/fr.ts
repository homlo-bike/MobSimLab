import type { AdviceMessages } from "./en";

/** Advice messages (fr). */
export const adviceFr = {
  "advice.title": "Ce qu’il faut améliorer",
  "advice.intro":
    "Les problèmes trouvés par ce calcul, le plus grave d’abord, et ce que vous pouvez faire pour chacun.",
  "advice.none": "Rien à améliorer : ce calcul n’a trouvé ni goulot d’étranglement ni problème.",
  "advice.show": "Afficher sur la carte",
  "advice.more": "{n} autres non affichés.",
  "advice.severity.problem": "Problème",
  "advice.severity.warning": "Avertissement",
  "advice.crowdMap":
    "Afficher sur la carte le remplissage des véhicules (heure la plus chargée de chaque ligne)",
  "advice.cap.stopped": "{line} : le calcul s’est arrêté : {problem}",
  "advice.cap.stoppedFix": "Corrigez cela dans l’outil ferroviaire, puis relancez le test.",
  "advice.cap.unplaced": "{line} : trajets qui ne trouvent pas de place sur les voies : {n}",
  "advice.cap.unplacedFix":
    "Faites circuler la ligne moins souvent sur cette période, ou donnez plus de place à ses trains là où ils se croisent : plus de quais ou de communications à {terminal}, ou un évitement sur voie unique.",
  "advice.cap.terminal":
    "{line} : le terminus {terminal} est le goulot d’étranglement, occupé {share} de l’heure la plus chargée (limite {limit})",
  "advice.cap.terminalFix":
    "Les trains occupent ses quais trop longtemps. Raccourcissez le retournement (battement plus court, ou un conducteur qui attend à chaque bout), ajoutez une voie à quai, ou rapprochez la communication des quais pour que les trains la libèrent plus tôt.",
  "advice.cap.section":
    "{line} : le canton de voie {section} est le goulot d’étranglement, occupé {share} de l’heure la plus chargée (limite {limit})",
  "advice.cap.sectionFix":
    "Les trains occupent ce tronçon plus longtemps que tout autre. Une vitesse plus élevée le leur fait libérer plus tôt ; sinon, faites circuler moins de trains ici.",
  "advice.cap.sectionPlatform":
    "Ce tronçon est une voie à quai : les trains l’occupent pendant leur arrêt. Des arrêts plus courts, ou une deuxième voie à quai pour ce sens, laissent entrer le train suivant plus tôt.",
  "advice.cap.sectionSwitches":
    "Ce tronçon est une zone d’aiguillages : les trains l’occupent pendant que leur itinéraire est formé puis détruit. Des aiguillages plus rapides en voie déviée, ou placés pour que les deux sens ne se croisent pas, le libèrent plus tôt.",
  "advice.cap.signalAdd":
    "Ce tronçon de pleine voie mesure {length} m, alors qu’un canton n’a besoin que de {block} m à {speed} km/h. Ajoutez un signal de block vers {at} m sur la voie {track}, pour que le train suivant puisse entrer plus tôt dans la première moitié.",
  "advice.cap.signalShort":
    "Ce tronçon mesure {length} m, moins que deux cantons de {block} m à {speed} km/h ; un signal de plus laisserait trop peu de place pour s’arrêter. Les trains peuvent se suivre de plus près avec une signalisation en cabine (CBTC ou ETCS niveau 2), ou avec une vitesse plus basse ici.",
  "advice.cap.sectionCab":
    "Avec la signalisation en cabine, les trains se suivent déjà à distance de freinage ({block} m à {speed} km/h) ; ce ne sont pas les signaux qui fixent l’espacement. Une vitesse plus élevée dans ce tronçon, ou moins de trains, le libère plus tôt.",
  "advice.cap.sectionSight":
    "Les tramways roulent ici en marche à vue, les signaux ne fixent donc pas l’espacement. Des arrêts plus courts à proximité, ou une plateforme propre à l’écart de la circulation, le libèrent plus tôt.",
  "advice.cap.nearNote": "Cela fonctionne encore, mais il reste peu de place pour ajouter des trains.",
  "advice.cap.pileUp":
    "{line} : les retards s’accumulent et sont encore de {late} en moyenne à la fin de la période",
  "advice.cap.pileUpFix":
    "Ajoutez du temps de régulation aux terminus, ou circulez un peu moins souvent, pour qu’un train en retard ne retienne pas le suivant.",
  "advice.cap.full": "{line} : les véhicules sont remplis à {share} de {from} à {to}, {time}",
  "advice.cap.fullMore":
    "{left} personnes restent à quai sur la période. La voie permet jusqu’à {n} trains par heure et par sens : circulez plus souvent, ou utilisez des trains plus longs.",
  "advice.cap.fullLonger":
    "{left} personnes restent à quai sur la période. Circulez plus souvent si la voie le permet, ou utilisez des véhicules plus longs.",
  "advice.cap.streetPileUp":
    "{line} : les retards s’accumulent dans la rue et sont encore de {late} à la fin",
  "advice.cap.streetPileUpFix":
    "Prévoyez plus de temps pour le tour ou un battement plus long aux terminus, pour que les véhicules puissent rattraper leur retard ; une voie réservée là où la ligne rencontre la circulation aide le plus.",
  "advice.road.cannotRun": "{line} n’a pas pu circuler",
  "advice.road.cannotRunFix":
    "{problem}. Corrigez la ligne routière dans Créer → Ligne routière, puis relancez.",
  "advice.road.late": "{line} : seulement {share} des départs à l’heure (conseil en dessous de {limit})",
  "advice.road.mostlySignals":
    "Chaque trajet perd {signals} min aux feux rouges et {traffic} min dans la circulation, donc surtout aux feux listés ici.",
  "advice.road.mostlyTraffic":
    "Chaque trajet perd {traffic} min dans la circulation et {signals} min aux feux rouges, donc surtout dans les rues listées ici.",
  "advice.road.moreTime":
    "Le tour a pris {run} min contre {planned} min prévues : prévoyez plus de temps de parcours, ou ajoutez un véhicule.",
  "advice.road.bunched": "{line} : {share} des départs arrivent en paquets",
  "advice.road.bunchedFix":
    "Les véhicules se rattrapent. Retenez-les aux terminus selon l’horaire, donnez-y un battement plus long, ou donnez à la ligne une voie réservée là où elle perd du temps.",
  "advice.road.ranOut": "{line} : véhicules tombés à court de charge : {n}",
  "advice.road.ranOutFix":
    "Utilisez une batterie plus grande, rechargez aux terminus, ou changez de véhicule en cours de journée.",
  "advice.road.stuck": "{line} : véhicules bloqués 5 minutes ou plus : {n}",
  "advice.road.stuckFix":
    "Vérifiez l’aménagement de la rue et les feux à cet endroit dans l’onglet SIG : il manque peut-être un mouvement tournant, ou la circulation bloque le carrefour.",
  "advice.road.notBack": "{line} : véhicules pas rentrés au dépôt à la fin : {n}",
  "advice.road.notBackFix":
    "Vérifiez l’itinéraire entre la ligne et son dépôt, ou laissez plus de temps après le dernier trajet.",
  "advice.road.unnamedStreet": "une rue sans nom",
  "advice.road.unnamedJunction": "un carrefour",
  "advice.road.spot.signal": "Feu rouge sur {place} : {min} min perdues au total ({lines})",
  "advice.road.spot.signalFix":
    "Les lignes attendent ici plus longtemps que partout ailleurs. Demandez une priorité pour elles à ce feu, ou des temps de feux qui leur conviennent. La simulation routière ne modélise pas encore la priorité et ne peut donc pas montrer le gain.",
  "advice.road.spot.street": "Circulation sur {place} : {min} min perdues au total ({lines})",
  "advice.road.spot.streetFix":
    "Donnez aux lignes une voie réservée dans cette rue (onglet SIG, aménagement de la rue : voie bus), ou faites-les passer par une autre rue.",
  "advice.road.spot.junction": "Arrêt dans {place} : {min} min perdues au total ({lines})",
  "advice.road.spot.junctionFix":
    "Les véhicules restent arrêtés dans ce carrefour, en attendant de tourner ou que la sortie se libère. Une voie réservée jusqu’au carrefour, ou une phase de feu séparée pour tourner, aide.",
} satisfies AdviceMessages;

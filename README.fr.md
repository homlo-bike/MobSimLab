<p align="center">
  <img src="docs/images/logo.svg" alt="Logo de MobSimLab" width="120" height="120">
</p>

<h1 align="center">MobSimLab</h1>

<p align="center">Mobility Simulator Lab : planifier, simuler et tester les transports en commun.</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.es.md">Español</a> ·
  <b>Français</b> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.hi.md">हिन्दी</a>
</p>

> Ceci est une traduction. En cas de différence, le [README anglais](README.md) fait foi. La documentation liée est en anglais.

MobSimLab est une application web libre et auto-hébergée pour la planification des transports en commun, l'analyse SIG et la simulation d'exploitation. Tracez des lignes de bus, de tramway, de métro et de train sur les vraies données de rues et de relief, vérifiez qu'elles tiennent l'horaire et accueillent leurs voyageurs, et voyez ce qu'elles coûtent, ce qu'elles rapportent et si le projet en vaut la peine.

![L'outil de lignes sur voirie : une ligne BHNS tracée sur les rues, avec sa longueur, ses arrêts, son temps de cycle, les véhicules nécessaires et sa fiabilité dans le panneau latéral](docs/images/street-line-editor.png)

## Ce qu'elle fait

**Dessiner le réseau**

- **Lignes sur voirie** : lignes de bus, BHNS, trolleybus et autocar tracées sur les rues d'OpenStreetMap. [Guide](docs/user/street-line-tool.md)
- **Voies ferrées** : tramway, métro léger, métro, train de banlieue, régional, grandes lignes et grande vitesse, avec gares, voies, aiguillages et traversées, le tout à l'échelle. [Guide](docs/user/railway-tool.md)
- **Véhicules et parc** : un catalogue de véhicules sourcé, plus les véhicules propres au projet et sa liste de véhicules individuels. [Guide](docs/user/vehicles-and-fleet.md)

**Le tester**

- **Simulateur** : les lignes ferroviaires tiennent-elles sur les voies, trains et bus sont-ils à l'heure, les petits retards s'estompent-ils et tout le monde tient-il dans les véhicules ? [Guide](docs/user/simulator.md)
- **Simulation routière** : les lignes sur voirie circulent dans le trafic avec Eclipse SUMO, depuis leur dépôt et retour, avec relecture. [Guide](docs/user/road-simulation.md)
- **Simulations pluriannuelles** : chaque année de simulation (10 par défaut, jusqu'à 60) tourne par type de jour (semaine, samedi, dimanche, jour férié) avec le calendrier et le climat du projet. [ADR-0020](docs/adr/0020-multi-year-day-types.md)
- **Calculateur d'itinéraires** : temps porte à porte de A à B au fil de la journée. [Guide](docs/user/journey-planner.md)

**L'analyser**

- **Schéma** : les lignes en plan de réseau et en thermomètres de ligne, exportables en SVG, PNG ou PDF. [Guide](docs/user/schematic.md)
- **SIG** : partage de la voirie, couverture à pied et espacement des arrêts, population, régions et carte du bruit. [Rues](docs/user/gis-streets.md), [marche](docs/user/gis-walk.md), [population](docs/user/gis-population.md), [régions](docs/user/gis-regions.md)
- **Tableaux** : chiffres du réseau et du parc, horaires avec services de véhicules (téléchargements CSV, PDF et GTFS), coûts, avantages, recettes tarifaires et comparaison de scénarios. [Réseau](docs/user/network-tables.md), [coûts](docs/user/cost-tables.md), [avantages](docs/user/benefit-tables.md), [tarifs](docs/user/fare-revenue.md)
- **Modèle de demande** : une prévision en quatre étapes pour un jour de semaine (génération, distribution, choix modal et affectation) avec AequilibraE. [Guide](docs/user/demand-model.md)
- **Évaluation** : valeur actuelle nette économique et financière, taux de rentabilité, rapport avantages-coûts, analyse multicritère, sensibilité et fourchettes Monte-Carlo. [Guide](docs/user/appraisal.md)

**Le partager et l'étendre**

- **Projets** : partagez un projet avec d'autres, rendez-le public pour toutes les personnes connectées à l'instance, ou enregistrez-le en fichier `.mslab`. [Fichiers de projet](docs/user/project-files.md)
- **Visionneuse statique** : un site web sans serveur qui affiche les projets enregistrés en lecture seule, prêt pour Cloudflare Pages. [Guide](docs/user/static-viewer.md)
- **Plugins** : les plugins fournis ajoutent téléphériques, ferries, people movers, bus à la demande, vélos cargo, énergie et émissions, import et export GTFS et la carte du bruit ; les administrateurs peuvent en installer d'autres, qui s'exécutent dans un bac à sable. [Plugins fournis](plugins/README.md), [écrire des plugins](docs/plugins/README.md)
- **Agents IA** : connectez Claude ou une autre application MCP pour construire des scénarios et les vérifier selon la règle des 15 minutes à pied. [Guide](docs/user/ai-agents.md)
- **32 langues** dans l'application.

## Captures d'écran

| | |
|---|---|
| ![Plan schématique avec lignes de métro, régionales et de bus, zones tarifaires et symboles de gare](docs/images/schematic-network-map.png) | ![Horaires avec les services de véhicules par ligne et les départs d'une ligne de bus un dimanche](docs/images/timetables.png) |
| **Schéma** : le plan de réseau, avec thermomètres de ligne et export SVG, PNG et PDF | **Horaires** : services de véhicules et départs par type de jour |
| ![Synthèse de l'évaluation avec valeur actuelle nette, rapport avantages-coûts, taux de rentabilité, avantages face aux coûts et dispersion Monte-Carlo](docs/images/appraisal.png) | ![Carte SIG de couverture à pied : à quelle distance d'un arrêt vivent les habitants, du vert au rouge](docs/images/walk-coverage.png) |
| **Évaluation** : le projet en vaut-il la peine, et quelle est la fiabilité du résultat ? | **Couverture à pied** : qui vit à courte distance à pied d'un arrêt |
| ![Carte du bruit avec les niveaux L_den le long d'une ligne et les bâtiments voisins](docs/images/noise-map.png) | |
| **Carte du bruit** : L_den et L_night du service prévu, avec l'écran des bâtiments et du relief | |

## Démarrage rapide

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_VERSION, MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose pull                  # ready-made image from ghcr.io, nothing to build
docker compose up -d                 # two containers: mobsimlab and postgres
open http://localhost:8080
```

Chaque version publie une image prête à l'emploi pour serveurs Intel/AMD et ARM sur `ghcr.io/homlo-bike/mobsimlab`, étiquetée uniquement avec son numéro de version (par exemple `2026.11.1-alpha` ; il n'y a pas d'étiquette `latest`). Indiquez cette version dans `MOBSIMLAB_VERSION` du fichier `.env` avant de la télécharger ; pour mettre à jour, remplacez-la par la version plus récente et lancez `docker compose pull && docker compose up -d`. Pour construire l'image vous-même à partir de ce dépôt, lancez `docker compose up -d --build`.

Les versions sont créées en poussant une étiquette de version (`git tag -s v2026.11.1-alpha -m "MobSimLab 2026.11.1-alpha" && git push origin v2026.11.1-alpha`) ; le workflow **Release image** construit l'image, la teste rapidement et la publie.

### Connexion et première configuration

MobSimLab n'a pas de mots de passe locaux ; on se connecte avec un fournisseur OpenID Connect (Keycloak, Authentik, Entra ID, Google et d'autres).

1. Enregistrez MobSimLab chez votre fournisseur comme application web. URI de redirection : `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`. URI de redirection après déconnexion : `<MOBSIMLAB_PUBLIC_URL>/`.
2. Mettez l'URL de l'émetteur et l'identifiant client dans `.env` (`MOBSIMLAB_OIDC_ISSUER`, `MOBSIMLAB_OIDC_CLIENT_ID`). Si le fournisseur vous a donné un secret client, collez-le dans `deploy/secrets/oidc_client_secret`.
3. Démarrez les conteneurs. L'instance démarre en **mode configuration** : la première personne qui se connecte devient **Owner**, et toutes les autres sont refusées jusqu'à ce que l'Owner appuie sur **Finish setup**. Pour choisir cette première personne, définissez `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (une adresse vérifiée par le fournisseur) ou `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT`.
4. Après la configuration, les nouveaux utilisateurs attendent une approbation (l'inscription automatique est désactivée par défaut). Les Owners et Admins s'en occupent dans **Administration**, dans le menu du compte : approuver ou refuser des personnes, changer les rôles (Restricted suspend un compte sans le supprimer), fixer les règles d'inscription (inscription automatique, domaines de messagerie et groupes IdP autorisés) et associer des groupes IdP à des rôles. Seul un Owner peut créer des Owners ou des Admins, et le dernier Owner ne peut pas être supprimé.
5. Derrière un proxy inverse TLS, définissez `MOBSIMLAB_TRUSTED_PROXIES` avec l'adresse du proxy pour que les limites de connexion (10 par minute et par client par défaut) et les journaux d'audit voient la véritable adresse du client.

**Agents IA :** les Owners, Admins et Editors peuvent connecter Claude ou une autre application MCP à `<MOBSIMLAB_PUBLIC_URL>/mcp`. L'instance doit être joignable en HTTPS depuis l'application IA, et `MOBSIMLAB_PUBLIC_URL` doit être l'adresse qu'utilise l'application. Voir [docs/user/ai-agents.md](docs/user/ai-agents.md).

**Visionneuse statique :** `pnpm build:static` construit le site en lecture seule. Voir [docs/user/static-viewer.md](docs/user/static-viewer.md).

Compte Owner perdu ? Lancez `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner`. Cela rétrograde l'Owner actuel en Admin, le déconnecte, remet l'instance en mode configuration et consigne l'action dans le journal d'audit.

## Documentation

- [Architecture](docs/architecture/README.md), [hypothèses remises en question](docs/architecture/00-challenged-assumptions.md) et [Architecture Decision Records](docs/adr/README.md)
- Rapports d'exploration : [S1 co-simulation](docs/spikes/s1-cosimulation.md), [S2 performance du noyau ferroviaire](docs/spikes/s2-rail-kernel-performance.md), [S3 import OSM](docs/spikes/s3-osm-import.md)

## Contribuer

Lisez d'abord [CONTRIBUTING.md](CONTRIBUTING.md) et respectez le [code de conduite](CODE_OF_CONDUCT.md). Signalez les problèmes de sécurité comme indiqué dans [SECURITY.md](SECURITY.md). [ACCESSIBILITY.md](ACCESSIBILITY.md) présente l'objectif d'accessibilité et les limites connues.

## Licence

Le code est sous [GNU Affero General Public License v3.0 ou ultérieure](LICENSE). Le catalogue de véhicules, la bibliothèque d'hypothèses et la documentation sont sous CC BY 4.0.

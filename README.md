<p align="center">
  <img src="docs/images/logo.svg" alt="MobSimLab logo" width="120" height="120">
</p>

<h1 align="center">MobSimLab</h1>

<p align="center">Mobility Simulator Lab: plan, simulate and test public transport.</p>

<p align="center">
  <b>English</b> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.hi.md">हिन्दी</a>
</p>

MobSimLab is an open-source, self-hosted web app for public transport planning, GIS analysis and operations simulation. Draw bus, tram, metro and rail lines on the real street and terrain data, test whether they run on time and fit their passengers, and see what they cost, what they bring and whether the project is worth it.

![The street line tool: a BRT line drawn on the streets, with its length, stops, cycle time, vehicles needed and reliability in the side panel](docs/images/street-line-editor.png)

## What it does

**Draw the network**

- **Street lines**: bus, BRT, trolleybus and intercity bus lines routed on OpenStreetMap streets. [Guide](docs/user/street-line-tool.md)
- **Railways**: tram, light rail, metro, commuter, regional, intercity and high-speed lines with stations, tracks, switches and crossings, all to scale. [Guide](docs/user/railway-tool.md)
- **Vehicles and fleet**: a sourced vehicle catalogue, plus the project's own vehicles and its list of individual vehicles. [Guide](docs/user/vehicles-and-fleet.md)

**Test it**

- **Simulator**: do the rail lines fit the tracks, do the trains and buses run on time, do small delays die out, and does everyone fit in the vehicles. [Guide](docs/user/simulator.md)
- **Road simulation**: street lines run in traffic with Eclipse SUMO, from their depots and back, with a replay. [Guide](docs/user/road-simulation.md)
- **Multi-year runs**: every simulation year (10 by default, up to 60) runs by day type (weekday, Saturday, Sunday, public holiday) with the project's calendar and climate. [ADR-0020](docs/adr/0020-multi-year-day-types.md)
- **Journey planner**: door-to-door times from A to B through the day. [Guide](docs/user/journey-planner.md)

**Analyse it**

- **Schematic**: the lines as a transport map and as strip maps, exported as SVG, PNG or PDF. [Guide](docs/user/schematic.md)
- **GIS**: how streets are shared, walk coverage and stop spacing, population, regions and the noise map. [Streets](docs/user/gis-streets.md), [walk](docs/user/gis-walk.md), [population](docs/user/gis-population.md), [regions](docs/user/gis-regions.md)
- **Tables**: network and fleet figures, timetables with vehicle blocks (CSV, PDF and GTFS downloads), costs, benefits, fare revenue and scenario comparison. [Network](docs/user/network-tables.md), [costs](docs/user/cost-tables.md), [benefits](docs/user/benefit-tables.md), [fares](docs/user/fare-revenue.md)
- **Demand model**: a four-step weekday forecast (generation, distribution, mode choice and assignment) run with AequilibraE. [Guide](docs/user/demand-model.md)
- **Appraisal**: economic and financial net present value, rates of return, benefit-cost ratio, multi-criteria analysis, sensitivity and Monte Carlo ranges. [Guide](docs/user/appraisal.md)

**Share and extend it**

- **Projects**: share a project with others, make it public to everyone signed in to the instance, or save it as a `.mslab` file. [Project files](docs/user/project-files.md)
- **Static viewer**: a website with no server that shows saved projects read-only, ready for Cloudflare Pages. [Guide](docs/user/static-viewer.md)
- **Plugins**: bundled plugins add cable cars, ferries, people movers, on-demand buses, cargo bikes, energy and emissions, GTFS import and export and the noise map; Admins can install more, which run in a sandbox. [Bundled plugins](plugins/README.md), [writing plugins](docs/plugins/README.md)
- **AI agents**: connect Claude or another MCP app to build scenarios and check them against the 15-minute walk rule. [Guide](docs/user/ai-agents.md)
- **32 languages** in the app.

## Screenshots

| | |
|---|---|
| ![Schematic network map with metro, regional rail and bus lines, tariff zones and station symbols](docs/images/schematic-network-map.png) | ![Timetables tab with vehicle blocks per line and the departures of a bus line on a Sunday](docs/images/timetables.png) |
| **Schematic**: the network map, with strip maps and SVG, PNG and PDF export | **Timetables**: vehicle blocks and departures per day type |
| ![Appraisal summary with net present value, benefit-cost ratio, rate of return, benefits against costs and the Monte Carlo spread](docs/images/appraisal.png) | ![GIS walk coverage map showing how far residents live from a stop, from green to red](docs/images/walk-coverage.png) |
| **Appraisal**: is the project worth it, and how sure is the result | **Walk coverage**: who lives within a short walk of a stop |
| ![Noise map showing L_den levels along a line and the buildings beside it](docs/images/noise-map.png) | |
| **Noise map**: L_den and L_night from the planned service, screened by buildings and terrain | |

## Quick start

```bash
deploy/scripts/init-secrets          # a random database password in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_VERSION, MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose pull                  # ready-made image from ghcr.io, nothing to build
docker compose up -d                 # two containers: mobsimlab and postgres
open http://localhost:8080
```

The only secret you create is the database password (`deploy/secrets/db_password`; set `MOBSIMLAB_SECRETS_PATH` in `.env` to keep it elsewhere). `session_secret` and `master_key` are optional and used only when you provide them as Docker secrets (see `.env.example`); without `session_secret` a random key is made at each start, so people reload the page after a restart. Installs from 2026.11.1-alpha keep their four database passwords with `COMPOSE_FILE=compose.yaml:deploy/compose.separate-db-passwords.yaml` in `.env`.

Each release publishes a ready-made image for Intel/AMD and ARM servers to `ghcr.io/homlo-bike/mobsimlab`, tagged with its version only (for example `2026.11.1-alpha`; there is no `latest` tag). Set that version as `MOBSIMLAB_VERSION` in `.env` before pulling; to update, change it to the newer version and run `docker compose pull && docker compose up -d`. To build the image yourself from this checkout instead, run `docker compose up -d --build`.

Releases are made by pushing a version tag (`git tag -s v2026.11.1-alpha -m "MobSimLab 2026.11.1-alpha" && git push origin v2026.11.1-alpha`). The **Release image** workflow builds, smoke-tests and publishes the image. The **Release desktop** workflow creates the GitHub release as a pre-release and attaches the desktop installers.

### Desktop app

The desktop app for Windows, macOS (Apple Silicon) and Linux runs MobSimLab on your own computer without an account, or connects to a MobSimLab server with its single sign-on. Download it from the [releases](https://github.com/homlo-bike/MobSimLab/releases). See [docs/user/desktop.md](docs/user/desktop.md).

### Sign-in and first setup

MobSimLab has no local passwords; people sign in with an OpenID Connect provider (Keycloak, Authentik, Entra ID, Google and others).

1. Register MobSimLab with your provider as a web application. Redirect URI: `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`. Post-logout redirect URI: `<MOBSIMLAB_PUBLIC_URL>/`.
2. Put the issuer URL and client ID in `.env` (`MOBSIMLAB_OIDC_ISSUER`, `MOBSIMLAB_OIDC_CLIENT_ID`). If the provider gave you a client secret, paste it into `deploy/secrets/oidc_client_secret`.
3. Name the first Owner in `.env`: `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (an e-mail the provider has verified) or `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT` (the provider's user ID). Start the stack. The instance starts in **setup mode**: only that person can sign in, becomes **Owner**, and everyone else is refused until the Owner presses **Finish setup**. Without either setting nobody can sign in during setup, so nobody else at the provider can claim the instance first.
4. After setup, new users wait for approval (auto-registration is off by default). Owners and Admins handle this under **Administration** in the account menu: approve or reject people, change roles (Restricted suspends an account without deleting it), set sign-up rules (auto-registration, allowed e-mail domains and IdP groups) and map IdP groups to roles. Only an Owner can create Owners or Admins, and the last Owner cannot be removed.
5. Behind a TLS reverse proxy, set `MOBSIMLAB_TRUSTED_PROXIES` to the proxy's address so sign-in rate limits (10 per minute per client by default) and audit records see the real client address, and browsers that arrive over plain http are sent to https. See [docs/user/reverse-proxy.md](docs/user/reverse-proxy.md) for an nginx example.

**AI agents:** Owners, Admins and Editors can connect Claude or another MCP app at `<MOBSIMLAB_PUBLIC_URL>/mcp`. The instance must be reachable over HTTPS from the AI app, and `MOBSIMLAB_PUBLIC_URL` must be the address the app uses. See [docs/user/ai-agents.md](docs/user/ai-agents.md).

**Static viewer:** `pnpm build:static` builds the read-only website. See [docs/user/static-viewer.md](docs/user/static-viewer.md).

Lost the Owner account? Run `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner`. This demotes the current Owner to Admin, signs them out, returns the instance to setup mode and records the action in the audit log. Only the person named by `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` or `_SUBJECT` can then claim it, and never a Restricted account.

## Documentation

- [Architecture](docs/architecture/README.md), [challenged assumptions](docs/architecture/00-challenged-assumptions.md) and [Architecture Decision Records](docs/adr/README.md)
- Spike reports: [S1 co-simulation](docs/spikes/s1-cosimulation.md), [S2 rail kernel performance](docs/spikes/s2-rail-kernel-performance.md), [S3 OSM import](docs/spikes/s3-osm-import.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and follow the [code of conduct](CODE_OF_CONDUCT.md). Report security issues as described in [SECURITY.md](SECURITY.md). [ACCESSIBILITY.md](ACCESSIBILITY.md) sets out the accessibility target and the known limitations.

## Licence

The code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). The vehicle catalogue, the assumption library and the documentation are licensed under CC BY 4.0.

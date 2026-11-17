# Bundled plugins

Plugins add modes, parameters, tools and calculations to MobSimLab ([ADR-0036](../docs/adr/0036-plugins.md)). Each folder here is one plugin that ships with the image (`"bundled": true`). The manifest `mobsimlab-plugin.json` follows [contracts/plugin-manifest.schema.json](../contracts/plugin-manifest.schema.json); each mode file follows [contracts/plugin-mode.schema.json](../contracts/plugin-mode.schema.json).

| Folder | Id | Adds |
|--------|----|------|
| [aerial-lift](aerial-lift/) | `org.mobsimlab.aerial-lift` | Modes `cable_car` (MGD, 2S, 3S, funitel, pulsed) and `aerial_tramway`, context key `ropeway_system`, `ropeway.*` parameters, the **Cable car** tool on the straight spans kit ([ADR-0037](../docs/adr/0037-cable-car-and-ferry-lines.md)) |
| [cargo-bike](cargo-bike/) | `org.mobsimlab.cargo-bike` | The **Cargo bike** project tab: an electric cargo tricycle's round trip from a start point to a destination (routing that prefers bike lanes, heights from the terrain service, battery use), a range map from one point, the bike-lane gaps of the trip (main-road sections without a bike lane), bicycle charging points and secure or cargo bike parkings along it (OSM), and the yearly savings against a car in the start point's country with the CO₂ avoided and the rider's calories and weekly activity. `cargo_bike.*` parameters (35 kg bike, 80 kg load, 90 kg rider, 900 Wh battery, 250 W mid-drive, €4,000 kit), and example kit presets in `kits.json` (500, 900 and 2 × 900 Wh trikes, a two-wheeler) with estimated prices. Calculations `cargo_bike_range` and `cargo_bike_savings` (`crates/cargo-bike`). |
| [energy](energy/) | `org.mobsimlab.energy` | Calculation `energy_emissions` (module `crates/energy`, built by `tools/wasm/build-energy.sh`): electricity, diesel and CO2e a year per line, per mode and for the network, from each line's vehicle-km; `energy.*` parameters per core mode; shown in the Tables tab, where the project sets the grid's emission intensity and the battery bus share |
| [ferry](ferry/) | `org.mobsimlab.ferry` | Mode `ferry`, context key `vessel_type` (monohull, catamaran, hydrofoil), `ferry.*` parameters, the **Ferry** tool on the water route kit. Car ferries come later. |
| [gtfs](gtfs/) | `org.mobsimlab.gtfs` | Importer `gtfs_import` and exporter `gtfs_export` (module `crates/gtfs`, built by `tools/wasm/build-gtfs.sh`) for the published timetable. In the journey planner a GTFS feed (zip) becomes the project's existing network for one service day (the busiest Wednesday unless a date is given), cut to the map view if asked and kept as the `gtfs-network` drawing. Any bus route can become a street line and any tram, metro or train route a railway service line (its busiest stop sequence, names and headways; stations, double track and terminal crossovers for rail), and the feed then leaves it out. The project's own lines download as a weekday GTFS feed |
| [nasa-gibs](nasa-gibs/) | `org.mobsimlab.nasa-gibs` | Aerial basemaps from NASA's Global Imagery Browse Services (GIBS) for a day picked in the layer control: Harmonized Landsat Sentinel-2 (Sentinel-2 and Landsat 8 and 9, about 30 m per pixel, one day's passes with gaps and clouds) and VIIRS NOAA-20 true colour (about 250 m, the whole world each day). No API key. Too coarse to see streets or track. |
| [noise](noise/) | `org.mobsimlab.noise` | The noise map: calculation `noise_estimate` and map layer `noise_band` ([ADR-0038](../docs/adr/0038-service-line-noise-map.md)) |
| [on-demand-bus](on-demand-bus/) | `org.mobsimlab.on-demand-bus` | Mode `on_demand_bus` (GTFS 715), `drt.*` parameters, the **On-demand bus** tool on the service zone kit: outline a zone, set the requests an hour, fleet and hours, and get the vehicles needed, wait, ride and door-to-door time from continuous-approximation formulas; **Simulate the day** dispatches every booking trip by trip ([ADR-0042](../docs/adr/0042-on-demand-dispatch-simulation.md)); the zone shows in the journey planner ([ADR-0037 §7](../docs/adr/0037-cable-car-and-ferry-lines.md)) |
| [people-mover](people-mover/) | `org.mobsimlab.people-mover` | Modes `people_mover` (pinched loop with detachable trains) and `people_mover_shuttle` (two trains on a fixed rope), context key `apm_system`, `people_mover.*` parameters, the **People mover** tool on the straight spans kit: cable-hauled trains on an elevated guideway with piers ([ADR-0037 §7](../docs/adr/0037-cable-car-and-ferry-lines.md)) |

## What a plugin can contribute today

| Contribution | Status |
|--------------|--------|
| `modes`, `contexts`, `parameters`, `sources`, `tools` | Built. Parameters follow the assumption library rules (ADR-0018) with the plugin's modes and context keys. Tools use a core authoring kit: `straight-spans`, `water-route` or `service-zone` (`crates/mode-kits`). |
| `calculations`, `mapLayers` | Bundled plugins: runtime `bundled-wasm`, a core crate compiled to WebAssembly by `tools/wasm/build-<module>.sh`. Installed plugins: calculations with runtime `component`, their own WebAssembly component run in a sandbox (ADR-0036 Phase 2, [guide](../docs/plugins/README.md)), shown in the Tables tab, in the plugin's tab and to agents. Map layers stay bundled-only. |
| `importers`, `exporters` | A function converts between a file format and a published contract (today `published-timetable`), JSON in and out: a module function for bundled plugins (`bundled-wasm`; the app unzips and zips), a component for installed plugins (`component`). Shown in the journey planner. |
| `basemaps` | Bundled plugins: aerial imagery in the map's layer control, raster tiles under the OpenFreeMap Liberty place and street names, with the plugin's attribution and a note on its resolution. With `date`, the tile URLs hold `{date}` and the layer control offers a day (the newest by default). `tools/plugins/check.py` refuses a tile host that `MAP_ORIGINS` in `apps/api/src/app.setup.ts` (the CSP) does not list; installed plugins cannot add basemaps. |
| `tabs` | A project tab after the core tabs with the calculations it shows: a view the web app ships (`view`) for bundled plugins, the plugin's own page (`ui`) in a locked frame for installed plugins. `tools/plugins/check.py` refuses a core tab id, a tab two plugins contribute, and unknown calculations. |
| `vehicles` | Accepted by the schema; the cable car and ferry catalogue folders come with sourced vehicles. |
| `checks`, `engines`, `infrastructure`, `catalogues`, `kpis`, `schematics`, `panels` | Reserved for later phases; the schema accepts no entries yet. |

## Installing plugins and turning them on per project

Built in ADR-0036 Phase 1 (see *Phase 1 as built* in the ADR):

- **Admins and Owners install** a plugin under *Administration → Plugins* by uploading a `.msplugin` file. MobSimLab checks it first and shows the publisher, the signature, what it adds, what it may read and its licences; nothing is stored until **Install** is pressed. Several versions of a plugin can be installed side by side. Removing a version that projects use asks for confirmation, turns it off in those projects and keeps their drawings.
- **Project Owners turn plugins on or off** under *Preferences → Plugins* and pick the version of an installed plugin. Bundled plugins are on in every project until its Owner turns one off; installed plugins are off until turned on. Turning a plugin off hides its tools and keeps what was drawn with it. A copied project keeps its plugin choices.
- **Installed plugins** add modes, contexts, tools on the core kits, parameters and sources, and can run their own code: calculations, importers, exporters (tier `compute`) and tab pages (tier `ui`), in a sandbox without internet access (see [Plugins with their own code](../docs/plugins/README.md)). The Admin screen marks such plugins *Runs its own code in a sandbox* and holds the memory and time limits for every call. Map layers stay with bundled plugins.
- Installs, removals, keys and per-project changes are in the audit log.

## Making a third-party plugin

1. Lay the plugin out like the folders here: `mobsimlab-plugin.json` at the top, with the files it names. Do not set `"bundled"`. Use a reverse-DNS id of your own (`org.example.water-taxi`), mode and parameter ids that no other plugin uses, and licences from the licence gate's list (`tools/license-gate/policy.json`).
2. List every file with its SHA-256 in `SHA256SUMS`, as `sha256sum` writes it, and sign that list with your ECDSA P-256 or Ed25519 key:

   ```sh
   cd water-taxi
   find . -type f ! -name 'SHA256SUMS*' | sed 's|^\./||' | sort | xargs sha256sum > SHA256SUMS
   openssl dgst -sha256 -sign publisher.key SHA256SUMS | base64 -w0 > SHA256SUMS.sig
   # or: cosign sign-blob --key cosign.key SHA256SUMS > SHA256SUMS.sig
   zip -r ../water-taxi-1.0.0.msplugin .
   ```

3. Give the Admins of the instance your public key (`openssl pkey -in publisher.key -pubout`, or `cosign.pub`). They add it under *Trusted publishers*; only packages signed with a trusted key install. In development mode (`MOBSIMLAB_DEVELOPMENT_MODE=true`) an Owner can allow unsigned packages for testing.

A package may hold at most 500 files, 5 MB per file and 25 MB unpacked (10 MB as uploaded). The API checks it with the same rules as `tools/plugins/check.py` (`apps/api/src/plugins/validate.ts`; a test keeps the two in step).

## Checking and the web registry

```sh
uv run --no-project --with jsonschema --with pyyaml python tools/plugins/check.py --render
```

validates every plugin and writes `apps/web/src/plugins/bundled.generated.json`, which the web app reads through `apps/web/src/plugins/registry.ts` (modes, tools, calculations, and parameter values resolved per mode and context option; a plugin without modes of its own gets its values per core mode). CI runs it with `--check-rendered`.

## What the kits check, and what not yet

- **Straight spans kit:** used for ropeways (cabins on towers) and cable-hauled people movers (trains on a guideway carried by piers; the mode's `parameterPrefix` names its parameters, and trains are counted from the round trip because they stop in stations). Straight sections, automatic towers within the span limit that keep the recommended clearance under the loaded cabin with rope sag, span, clearance, tower height, station angle and capacity checks, running time, cabin interval or shuttle cycle, capacity and cabin count. The ground is a straight line between the station heights the planner types in; terrain and building heights come later.
- **Water route kit:** legs through the planner's via points, speed zones, berthing manoeuvre, dwell from gangway throughput, vessel blocks, and a berth check that runs three hours of service on the segment engine with each pier's berths as a reservable resource. Routing on an OSM water graph, bridges, locks and depth come later.
- Lines from both tools ride in the journey planner as frequency patterns. Drawings are kept in the browser per project until projects store drawings.

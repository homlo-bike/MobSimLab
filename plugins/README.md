# Bundled plugins

Plugins add modes, parameters, tools and calculations to MobSimLab ([ADR-0036](../docs/adr/0036-plugins.md)). Each folder here is one plugin that ships with the image (`"bundled": true`). The manifest `mobsimlab-plugin.json` follows [contracts/plugin-manifest.schema.json](../contracts/plugin-manifest.schema.json); each mode file follows [contracts/plugin-mode.schema.json](../contracts/plugin-mode.schema.json).

| Folder | Id | Adds |
|--------|----|------|
| [aerial-lift](aerial-lift/) | `org.mobsimlab.aerial-lift` | Modes `cable_car` (MGD, 2S, 3S, funitel, pulsed) and `aerial_tramway`, context key `ropeway_system`, `ropeway.*` parameters, the **Cable car** tool on the straight spans kit ([ADR-0037](../docs/adr/0037-cable-car-and-ferry-lines.md)) |
| [ferry](ferry/) | `org.mobsimlab.ferry` | Mode `ferry`, context key `vessel_type` (monohull, catamaran, hydrofoil), `ferry.*` parameters, the **Ferry** tool on the water route kit. Car ferries come later. |
| [cargo-bike](cargo-bike/) | `org.mobsimlab.cargo-bike` | The **Cargo bike** project tab: an electric cargo tricycle's round trip from a start point to a destination (routing that prefers bike lanes, heights from the terrain service, battery use), a range map from one point, the bike-lane gaps of the trip (main-road sections without a bike lane), bicycle charging points and secure or cargo bike parkings along it (OSM), and the yearly savings against a car in the start point's country with the CO₂ avoided and the rider's calories and weekly activity. `cargo_bike.*` parameters (35 kg bike, 80 kg load, 90 kg rider, 900 Wh battery, 250 W mid-drive, €4,000 kit). Calculations `cargo_bike_range` and `cargo_bike_savings` (`crates/cargo-bike`). |

## What a plugin can contribute today

| Contribution | Status |
|--------------|--------|
| `modes`, `contexts`, `parameters`, `sources`, `tools` | Built. Parameters follow the assumption library rules (ADR-0018) with the plugin's modes and context keys. Tools use a core authoring kit: `straight-spans` or `water-route` (`crates/mode-kits`). |
| `calculations`, `mapLayers` | Built for bundled plugins only, with runtime `bundled-wasm`: the code is a core crate compiled to WebAssembly by `tools/wasm/build-<module>.sh`. Sandboxed third-party components come with the plugin host (ADR-0036 Phase 2). |
| `tabs` | Built for bundled plugins only: a project tab after the core tabs, with a view the web app ships (`view`) and the calculations it shows. `tools/plugins/check.py` refuses a core tab id, a tab two plugins contribute, and unknown calculations. |
| `vehicles` | Accepted by the schema; the cable car and ferry catalogue folders come with sourced vehicles. |
| `checks`, `engines`, `infrastructure`, `catalogues`, `kpis`, `schematics`, `importers`, `exporters`, `panels` | Reserved for later phases; the schema accepts no entries yet. |

## Installing plugins and turning them on per project

Built in ADR-0036 Phase 1 (see *Phase 1 as built* in the ADR):

- **Admins and Owners install** a plugin under *Administration → Plugins* by uploading a `.msplugin` file. MobSimLab checks it first and shows the publisher, the signature, what it adds, what it may read and its licences; nothing is stored until **Install** is pressed. Several versions of a plugin can be installed side by side. Removing a version that projects use asks for confirmation, turns it off in those projects and keeps their drawings.
- **Project Owners turn plugins on or off** under *Preferences → Plugins* and pick the version of an installed plugin. Bundled plugins are on in every project until its Owner turns one off; installed plugins are off until turned on. Turning a plugin off hides its tools and keeps what was drawn with it. A copied project keeps its plugin choices.
- **Installed plugins are data plugins for now**: modes, contexts, tools on the core kits, parameters and sources. Calculations, map layers and the compute and UI tiers stay with bundled plugins until the sandboxed plugin host (Phase 2) exists, and the install check refuses them.
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

validates every plugin and writes `apps/web/src/plugins/bundled.generated.json`, which the web app reads through `apps/web/src/plugins/registry.ts` (modes, tools, calculations, and parameter values resolved per mode and context option). CI runs it with `--check-rendered`.

## What the kits check, and what not yet

- **Straight spans kit:** straight sections, automatic towers within the span limit that keep the recommended clearance under the loaded cabin with rope sag, span, clearance, tower height, station angle and capacity checks, running time, cabin interval or shuttle cycle, capacity and cabin count. The ground is a straight line between the station heights the planner types in; terrain and building heights come later.
- **Water route kit:** legs through the planner's via points, speed zones, berthing manoeuvre, dwell from gangway throughput, vessel blocks, and a berth check that runs three hours of service on the segment engine with each pier's berths as a reservable resource. Routing on an OSM water graph, bridges, locks and depth come later.
- Lines from both tools ride in the journey planner as frequency patterns. Drawings are kept in the browser per project until projects store drawings.

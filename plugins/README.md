# Bundled plugins

Plugins add modes, parameters, tools and calculations to MobSimLab ([ADR-0036](../docs/adr/0036-plugins.md)). Each folder here is one plugin that ships with the image (`"bundled": true`). The manifest `mobsimlab-plugin.json` follows [contracts/plugin-manifest.schema.json](../contracts/plugin-manifest.schema.json); each mode file follows [contracts/plugin-mode.schema.json](../contracts/plugin-mode.schema.json).

| Folder | Id | Adds |
|--------|----|------|
| [aerial-lift](aerial-lift/) | `org.mobsimlab.aerial-lift` | Modes `cable_car` (MGD, 2S, 3S, funitel, pulsed) and `aerial_tramway`, context key `ropeway_system`, `ropeway.*` parameters, the **Cable car** tool on the straight spans kit ([ADR-0037](../docs/adr/0037-cable-car-and-ferry-lines.md)) |
| [energy](energy/) | `org.mobsimlab.energy` | Calculation `energy_emissions` (module `crates/energy`, built by `tools/wasm/build-energy.sh`): electricity, diesel and CO2e a year per line, per mode and for the network, from each line's vehicle-km; `energy.*` parameters per core mode; shown in the Tables tab, where the project sets the grid's emission intensity and the battery bus share |
| [ferry](ferry/) | `org.mobsimlab.ferry` | Mode `ferry`, context key `vessel_type` (monohull, catamaran, hydrofoil), `ferry.*` parameters, the **Ferry** tool on the water route kit. Car ferries come later. |
| [gtfs](gtfs/) | `org.mobsimlab.gtfs` | Importer `gtfs_import` and exporter `gtfs_export` (module `crates/gtfs`, built by `tools/wasm/build-gtfs.sh`) for the published timetable. In the journey planner a GTFS feed (zip) becomes the project's existing network for one service day (the busiest Wednesday unless a date is given), cut to the map view if asked and kept as the `gtfs-network` drawing; the project's own lines download as a weekday GTFS feed |
| [noise](noise/) | `org.mobsimlab.noise` | The noise map: calculation `noise_estimate` and map layer `noise_band` ([ADR-0038](../docs/adr/0038-service-line-noise-map.md)) |
| [people-mover](people-mover/) | `org.mobsimlab.people-mover` | Modes `people_mover` (pinched loop with detachable trains) and `people_mover_shuttle` (two trains on a fixed rope), context key `apm_system`, `people_mover.*` parameters, the **People mover** tool on the straight spans kit: cable-hauled trains on an elevated guideway with piers ([ADR-0037 §7](../docs/adr/0037-cable-car-and-ferry-lines.md)) |

## What a plugin can contribute today

| Contribution | Status |
|--------------|--------|
| `modes`, `contexts`, `parameters`, `sources`, `tools` | Built. Parameters follow the assumption library rules (ADR-0018) with the plugin's modes and context keys. Tools use a core authoring kit: `straight-spans` or `water-route` (`crates/mode-kits`). |
| `calculations`, `mapLayers` | Built for bundled plugins only, with runtime `bundled-wasm`: the code is a core crate compiled to WebAssembly by `tools/wasm/build-<module>.sh`. Sandboxed third-party components come with the plugin host (ADR-0036 Phase 2). |
| `importers`, `exporters` | Built for bundled plugins only, with runtime `bundled-wasm`: a module function converts between a file format and a published contract (today `published-timetable`), JSON in and out; the app unzips and zips. |
| `vehicles` | Accepted by the schema; the cable car and ferry catalogue folders come with sourced vehicles. |
| `checks`, `engines`, `infrastructure`, `catalogues`, `kpis`, `schematics`, `panels` | Reserved for later phases; the schema accepts no entries yet. |

Install, enable per project, signatures and the public registry (ADR-0036 Phase 1) are not built yet. Bundled plugins are always available.

## Checking and the web registry

```sh
uv run --no-project --with jsonschema --with pyyaml python tools/plugins/check.py --render
```

validates every plugin and writes `apps/web/src/plugins/bundled.generated.json`, which the web app reads through `apps/web/src/plugins/registry.ts` (modes, tools, calculations, and parameter values resolved per mode and context option; a plugin without modes of its own gets its values per core mode). CI runs it with `--check-rendered`.

## What the kits check, and what not yet

- **Straight spans kit:** used for ropeways (cabins on towers) and cable-hauled people movers (trains on a guideway carried by piers; the mode's `parameterPrefix` names its parameters, and trains are counted from the round trip because they stop in stations). Straight sections, automatic towers within the span limit that keep the recommended clearance under the loaded cabin with rope sag, span, clearance, tower height, station angle and capacity checks, running time, cabin interval or shuttle cycle, capacity and cabin count. The ground is a straight line between the station heights the planner types in; terrain and building heights come later.
- **Water route kit:** legs through the planner's via points, speed zones, berthing manoeuvre, dwell from gangway throughput, vessel blocks, and a berth check that runs three hours of service on the segment engine with each pier's berths as a reservable resource. Routing on an OSM water graph, bridges, locks and depth come later.
- Lines from both tools ride in the journey planner as frequency patterns. Drawings are kept in the browser per project until projects store drawings.

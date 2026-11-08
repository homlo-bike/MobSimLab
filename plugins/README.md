# Bundled plugins

Plugins add modes, parameters, tools and calculations to MobSimLab ([ADR-0036](../docs/adr/0036-plugins.md)). Each folder here is one plugin that ships with the image (`"bundled": true`). The manifest `mobsimlab-plugin.json` follows [contracts/plugin-manifest.schema.json](../contracts/plugin-manifest.schema.json); each mode file follows [contracts/plugin-mode.schema.json](../contracts/plugin-mode.schema.json).

| Folder | Id | Adds |
|--------|----|------|
| [aerial-lift](aerial-lift/) | `org.mobsimlab.aerial-lift` | Modes `cable_car` (MGD, 2S, 3S, funitel, pulsed) and `aerial_tramway`, context key `ropeway_system`, `ropeway.*` parameters, the **Cable car** tool on the straight spans kit ([ADR-0037](../docs/adr/0037-cable-car-and-ferry-lines.md)) |
| [ferry](ferry/) | `org.mobsimlab.ferry` | Mode `ferry`, context key `vessel_type` (monohull, catamaran, hydrofoil), `ferry.*` parameters, the **Ferry** tool on the water route kit. Car ferries come later. |

## What a plugin can contribute today

| Contribution | Status |
|--------------|--------|
| `modes`, `contexts`, `parameters`, `sources`, `tools` | Built. Parameters follow the assumption library rules (ADR-0018) with the plugin's modes and context keys. Tools use a core authoring kit: `straight-spans` or `water-route` (`crates/mode-kits`). |
| `calculations`, `mapLayers` | Built for bundled plugins only, with runtime `bundled-wasm`: the code is a core crate compiled to WebAssembly by `tools/wasm/build-<module>.sh`. Sandboxed third-party components come with the plugin host (ADR-0036 Phase 2). |
| `vehicles` | Accepted by the schema; the cable car and ferry catalogue folders come with sourced vehicles. |
| `checks`, `engines`, `infrastructure`, `catalogues`, `kpis`, `schematics`, `importers`, `exporters`, `panels` | Reserved for later phases; the schema accepts no entries yet. |

Install, enable per project, signatures and the public registry (ADR-0036 Phase 1) are not built yet. Bundled plugins are always available.

## Checking and the web registry

```sh
uv run --no-project --with jsonschema --with pyyaml python tools/plugins/check.py --render
```

validates every plugin and writes `apps/web/src/plugins/bundled.generated.json`, which the web app reads through `apps/web/src/plugins/registry.ts` (modes, tools, calculations, and parameter values resolved per mode and context option). CI runs it with `--check-rendered`.

## What the kits check, and what not yet

- **Straight spans kit:** straight sections, automatic towers within the span limit that keep the recommended clearance under the loaded cabin with rope sag, span, clearance, tower height, station angle and capacity checks, running time, cabin interval or shuttle cycle, capacity and cabin count. The ground is a straight line between the station heights the planner types in; terrain and building heights come later.
- **Water route kit:** legs through the planner's via points, speed zones, berthing manoeuvre, dwell from gangway throughput, vessel blocks, and a berth check that runs three hours of service on the segment engine with each pier's berths as a reservable resource. Routing on an OSM water graph, bridges, locks and depth come later.
- Lines from both tools ride in the journey planner as frequency patterns. Drawings are kept in the browser per project until projects store drawings.

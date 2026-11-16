# Plugins with their own code

An installed plugin can bring code of its own: **calculations**, **importers**, **exporters** and **tab pages**
([ADR-0036](../adr/0036-plugins.md), *Phase 2 as built*). The code runs in a sandbox: it gets the project data
the app hands it, and nothing else. It cannot reach the internet, files, other projects or the person's
account. [examples/plugins/timetable-csv](../../examples/plugins/timetable-csv) has one of each.

How to lay out, sign and install a package is in [plugins/README.md](../../plugins/README.md#making-a-third-party-plugin).

## Code: WebAssembly components

Calculations, importers and exporters are WebAssembly **components** for the worlds of
[contracts/wit/plugin.wit](../../contracts/wit/plugin.wit) (`mobsimlab:plugin@1.0.0`):

| World | Export | Gets | Returns |
|-------|--------|------|---------|
| `calculation` | `calculate(id, input)` | JSON `{ inputs, parameters, options }` | JSON with `table`, `kpis`, `findings` ([plugin-output.schema.json](../../contracts/plugin-output.schema.json)) |
| `importer` | `import-files(id, files, options)` | The uploaded file | JSON `{ timetable, summary }`, the timetable as [published-timetable](../../contracts/published-timetable.schema.json) |
| `exporter` | `export-files(id, input)` | JSON `{ timetable, options }` | The files to download |

Return `Err("message")` for a problem the person should read; it is shown as "<plugin> could not calculate:
message". `id` is the id from the manifest, so one component can serve several calculations.

A component may import only `mobsimlab:plugin/host`: `log(level, message)` (at most 200 lines a call, 500
characters each) and `progress(done)`. Anything else, including any WASI interface, is refused at install. Build
for `wasm32-unknown-unknown`, not a WASI target. In Rust:

```sh
cargo build --release --target wasm32-unknown-unknown   # with wit-bindgen generating the world
wasm-tools component new target/wasm32-unknown-unknown/release/my_plugin.wasm -o wasm/calculation.wasm
```

`tools/plugins/build-example.sh` builds the example this way. Any language that makes components without WASI
imports works.

### What a calculation gets

`inputs` holds only the kinds the calculation lists in `inputs` and the plugin's permissions allow:

| Kind | Permission | What it is today |
|------|------------|------------------|
| `timetable` | `read:timetable` | The published timetable of the project's lines |
| `street_lines` | `read:network` | The street line tool's lines (in the app; `null` for agents) |
| `network` | `read:network` | For agents, the scenario's `{ stops, lines }`; `null` in the app for now |
| `rail_design`, `fleet`, `geodata` | as named in the ADR | `null` for now |

`parameters` holds the plugin's own parameter values when it lists `parameters` as an input.

### Limits

Each call gets at most the memory and time an Admin set under *Administration → Plugins* (256 MB and 30 s
unless changed). Running over them stops the call with a message.

## Manifest

```json
"tiers": ["compute", "ui"],
"contributes": {
  "calculations": [{ "id": "route_summary", "label": "Route summary", "runtime": "component",
    "component": "wasm/calculation.wasm", "inputs": ["timetable"], "outputs": ["table", "kpis"],
    "where": ["tables", "plugin-tab"] }],
  "importers": [{ "id": "csv_import", "label": "CSV timetable", "format": "csv-timetable", "extensions": [".csv"],
    "contract": "published-timetable", "runtime": "component", "component": "wasm/importer.wasm" }],
  "exporters": [{ "id": "csv_export", "label": "CSV timetable", "format": "csv-timetable", "extensions": [".csv"],
    "contract": "published-timetable", "runtime": "component", "component": "wasm/exporter.wasm" }],
  "tabs": [{ "id": "csv-routes", "label": "Routes", "ui": "tab/index.html", "calculations": ["route_summary"] }]
},
"permissions": ["read:timetable", "write:scenario"]
```

- Components need the `compute` tier, tab pages the `ui` tier.
- `where`: `tables` shows the calculation in the Tables tab, `plugin-tab` lets the plugin's tab run it.
- Importers need `write:scenario`; exporters need `read:timetable`.
- Agents connected to MobSimLab (ADR-0035) can list and run calculations with `list_plugin_calculations` and
  `run_plugin_calculation`; their answer is marked as a plugin's data.

## Tabs

A tab page is an HTML file in a folder of the package (`tab/index.html`) with its scripts, styles, images and
fonts next to it. It is shown in a frame with `sandbox="allow-scripts"` and a Content Security Policy that allows
only the package's own files: no inline scripts, no network (`connect-src 'none'`), no forms, no cookies or
storage. A line under the frame names the plugin and its publisher.

The page talks to the app with `postMessage`. Send `{ mobsimlab: 1, id, method, params }` to `window.parent`; the
answer comes back with the same `id` as `{ mobsimlab: 1, id, result }` or `{ mobsimlab: 1, id, error }`. One
request at a time.

| Method | Params | Result |
|--------|--------|--------|
| `context` | | `{ plugin: { id, name, version }, tab, language, theme, permissions, calculations }` |
| `data` | `{ kind: "timetable" \| "street_lines" }` | That data, if the plugin's permissions allow it |
| `run` | `{ calculation, options? }` | The calculation's output; only calculations the tab lists |

See `examples/plugins/timetable-csv/tab/tab.js` for a small client.

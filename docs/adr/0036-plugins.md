# ADR-0036: Plugins add modes, infrastructure, calculations and schematics as signed packages of data and sandboxed WebAssembly, installed by Admins and enabled per project

- Status: Accepted (product owner, 2026-11-02); see *Product owner answers* at the end
- Date: 2026-11-02
- Deciders: product owner, architecture
- Related: ADR-0037 (cable car and ferry service lines), FR-PLAT-04, FR-PLAT-05, FR-ASM-01..05, FR-COST-03, FR-SCH-01..03, C-10, ADR-0002 (licence), ADR-0003 (two containers), ADR-0004 (polyglot runtime), ADR-0007 (co-simulation), ADR-0009 (unified graph), ADR-0012 (audit), ADR-0013 (scenario overlays), ADR-0014 (results storage), ADR-0017 (outbound gateway), ADR-0018 (assumption engine), ADR-0021 (`.mslab` format), ADR-0025 (schematics), ADR-0026 (vehicle catalogue), ADR-0031 / ADR-0033 / ADR-0034 (Rust kernels as WebAssembly), ADR-0035 (MCP server), [threat model](../security/threat-model.md)

## Context

The product owner asked (2026-11-02) for **plugins that add functionality to the app**: transport modes, infrastructure, calculations, schematics and similar. In the same message they asked for cable car and ferry service lines (researched separately) and for a noise map of service lines. Both are good test cases for a plugin model: either they can be built on it, or the model is missing something.

### What the code base has today

Every extension seam is currently a hard-coded list. That is fine for one team, but it is exactly what a plugin would need to add to:

| What a plugin would add | Where it lives now | Shape |
|-------------------------|--------------------|-------|
| Street modes | `apps/web/src/features/street-lines/types.ts` (`type Mode = "bus" \| "brt" \| …`), `modes.ts` (`MODES`, `MODE_ORDER`) | TypeScript union and record |
| Rail modes | `apps/web/src/features/railways/types.ts` (`RailMode`), `modes.ts` (`RAIL_MODES`), `crates/rail-design` | TypeScript union, Rust enum |
| Tools in the top bar | `apps/web/src/App.tsx` (`"street" \| "railway" \| "journey"`, one button and one panel each) | Hard-coded union |
| Model parameters | `assumptions/parameters/*.yaml`, checked by `tools/assumptions/check.py` (ADR-0018) | Versioned YAML with sources |
| Catalogues | `vehicles/<mode>/*.json` (ADR-0026), `assumptions/switches.yaml`, `assumptions/supply-systems.yaml` | JSON / YAML validated by schema |
| KPIs | `apps/api/src/agents/kpis.ts` (`KPIS`, versioned) | TypeScript array |
| Agent tools | `apps/api/src/agents/mcp.tools.ts` (`server.registerTool(...)`) | Code |
| Calculations | Rust crates compiled to WebAssembly and loaded by `apps/api/src/agents/wasm.ts` and the web app (street routing, walk analysis, rail design, journey planner) | JSON in, JSON out |
| Data exchange between parts | `contracts/*.schema.json` (rail topology, published timetable) | JSON Schema, checked in CI |
| Schematics | LOOM in the tool-runner, SVG editor (ADR-0025) | Planned |
| Simulation engines | Co-sim coordinator over SUMO and the rail kernel (07 §1, ADR-0007) | Planned, Python + Rust |

Two things in that table matter a lot for the design. First, the calculation kernels **already** take JSON and return JSON across a WebAssembly boundary, and the same `.wasm` runs in the browser, the API and the worker. Second, the published contracts already describe the data that calculations read. A plugin model can reuse both instead of inventing a new runtime.

### Forces

1. **Results must stay reproducible and sourced (ADR-0018).** A plugin cannot be a way to slip uncited numbers or non-deterministic code into a result that a public body relies on.
2. **Projects are shared and exported (ADR-0021).** A project that uses a plugin must say so, and must open on another instance either with the same plugin or with a clear message.
3. **Two containers, no new services (ADR-0003).** Plugins cannot bring their own servers or containers.
4. **Plugins are third-party code.** Self-hosted instances hold confidential pre-decision plans (threat model A1). A plugin must not be able to read other projects, reach the internet, read secrets or slow the instance down.
5. **Three languages (ADR-0004).** A plugin should not have to be written three times to run in the browser, the API and the worker.
6. **Planners are not programmers.** Many useful plugins are data only: a national vehicle catalogue, a country's design guidance as assumption values, a house style for schematics.

### How others do it

| Product | Model | What we take from it |
|---------|-------|----------------------|
| QGIS | Python plugins with full access to the process, from a reviewed repository | Huge ecosystem, but a plugin can do anything; not acceptable for multi-user servers with private data |
| VS Code | Manifest with **contribution points** (commands, views, settings) and activation events; code runs in a separate extension host, unsandboxed | The manifest and contribution-point idea; not the trust model |
| Figma | Plugin logic in a sandboxed JavaScript realm, UI in an iframe, talking by `postMessage`; permissions declared in the manifest | Separation of logic and UI; UI in a sandboxed iframe |
| Grafana | Signed plugins (Grafana Labs, commercial, community, private), backend parts as separate processes over gRPC | Signature levels and an Admin trust policy |
| Zed, Envoy (proxy-wasm), Shopify Functions, Extism | Extensions as **WebAssembly** modules with a typed interface, memory and time limits, no ambient I/O | Sandboxed, deterministic, language-neutral compute |
| MATSim, SUMO, OpenTripPlanner | Modules or "sandbox" features compiled into the core, plus TraCI-style remote control | Engine-level extension is hard; keep the clock in the core and let extensions supply behaviour |
| PTV Visum, Aimsun | Scripting (Python/COM) against the full model | Powerful for experts, but tied to one desktop session and unsandboxed |

## Decision

### 1. A plugin is a package of contributions, in three tiers

A plugin is a signed `.msplugin` file (ZIP) with a manifest `mobsimlab-plugin.json`. It contributes things to named **contribution points** (§3). Each contribution is in one of three tiers, and the manifest says which tiers it uses, because each tier needs more trust than the one before:

| Tier | Contains | Runs | Example |
|------|----------|------|---------|
| **Data** | JSON / YAML validated by our schemas: modes, vehicle types, assumption entries with sources, switch and supply-system catalogue entries, KPI definitions, map and schematic styles, infrastructure element types | Nothing runs. The core reads it | A national bus catalogue; Swiss design guidance for stop spacing |
| **Compute** | WebAssembly components implementing a published interface (§4) | In a sandbox in the worker, the API or a browser Web Worker | A noise method, a ferry running-time model, a cable car capacity check, a schematic layout algorithm |
| **UI** | Static HTML/JS/CSS for panels | In a sandboxed iframe with a message API (§6) | A custom chart panel for a plugin's results |

Most plugins only need Data and Compute. The core renders forms, tables and map layers for them from JSON Schema and style JSON, so a plugin gets a working UI without shipping any.

There are **no native plugins** (no shared libraries, no Python or Node packages loaded into our processes, no extra executables). That rules out some things a plugin could do, which is the point.

### 2. The manifest

`contracts/plugin-manifest.schema.json` (JSON Schema 2020-12) is the source of truth. A sketch:

```json
{
  "$schema": "https://mobsimlab.org/schemas/plugin-manifest/1.json",
  "id": "org.example.ropeway",
  "name": "Ropeways",
  "version": "1.2.0",
  "publisher": { "name": "Example Transit Lab", "url": "https://example.org" },
  "license": "AGPL-3.0-or-later",
  "dataLicense": "CC-BY-4.0",
  "engines": { "mobsimlab": ">=1.4 <2", "pluginApi": "1" },
  "tiers": ["data", "compute"],
  "contributes": {
    "modes": [{ "id": "aerial_lift.mgd", "file": "modes/mgd.json" }],
    "infrastructure": [{ "id": "ropeway.tower", "file": "infra/tower.json" }],
    "vehicles": [{ "dir": "vehicles/" }],
    "parameters": [{ "file": "assumptions/ropeway.yaml" }],
    "sources": [{ "file": "assumptions/sources.yaml" }],
    "calculations": [{ "id": "ropeway.running_time", "component": "wasm/ropeway.wasm", "world": "mobsimlab:plugin/mode-dynamics@1.0.0" }],
    "checks": [{ "id": "ropeway.span_clearance", "component": "wasm/ropeway.wasm", "world": "mobsimlab:plugin/check@1.0.0" }],
    "kpis": [{ "file": "kpis.yaml" }],
    "mapLayers": [{ "id": "ropeway.lines", "style": "styles/ropeway.json" }]
  },
  "permissions": ["read:network", "read:timetable", "write:results"],
  "dependsOn": { "org.mobsimlab.cable-core": "^1.0" }
}
```

- **Ids are reverse-DNS and namespaced.** Everything a plugin contributes is addressed as `<plugin id>/<item id>` internally, and as `plugin.<short>.<item>` where users see it, so two plugins cannot shadow each other or the core.
- **`engines`** names the MobSimLab versions and the plugin API major version the plugin was built for. An instance refuses to enable a plugin whose range it does not satisfy.
- **`permissions`** list what data the compute part may be given (§5). The install screen shows them in plain words.
- **`license` and `dataLicense`** are SPDX identifiers and go through the licence gate (`tools/license-gate`) on install, like our own dependencies. Data contributions must be under a licence that allows bundling into `.mslab` exports (ADR-0021, threat model I5).

### 3. Contribution points

Each point is a registry in the core that today's hard-coded list becomes (Phase 0, §9). The core's own modes, catalogues and tools are registered the same way, so the core is the first "plugin" and the registries are tested from day one.

| Point | What a plugin adds | Validated by | Appears in |
|-------|--------------------|--------------|------------|
| `modes` | A transport mode: id, label, colour, **family** (street, rail, guided, aerial, water, …), GTFS `route_type` (extended route types where needed), which authoring tool draws it, which engine runs it, default assumption contexts | Mode schema | Tool palette, line panel, vehicle catalogue filter, timetables, reports, GTFS export |
| `infrastructure` | An element type: geometry (point, line, polygon), JSON Schema of its properties, map style, which modes may use it, and the checks that apply | Element schema | Editors' palettes, map, inspector, project file |
| `vehicles` | Vehicle types per the catalogue schema with per-field sources (ADR-0026) | `vehicles/schema` and `tools/vehicles/check.py` | Vehicle catalogue, fleet |
| `parameters`, `sources` | Assumption library entries, each with a basis and sources, including the mandatory global fallback (ADR-0018) | `tools/assumptions/check.py` | Project Preferences → Parameters, assumptions report |
| `catalogues` | Switch and crossing types, supply systems, stop and platform standards | Catalogue schemas | Railway editor, supply checks |
| `calculations` | A compute function over a published contract (§4) that returns tables, GeoJSON, raster grids or KPI values | WIT interface + output schema | Analysis menu, map layers, reports, MCP (§7) |
| `checks` | A design check that returns findings (ok / warning / error, location, message, rule reference) | WIT interface | Live checks in editors, `validate_scenario` |
| `kpis` | KPI definitions with formula, unit, direction and source (ADR-0035 §7) | KPI schema | Benchmarks, `compare_results` |
| `schematics` | Diagram styles (line widths, station symbols, label rules) as data, and layout algorithms as compute | Style schema, WIT interface | Schematic generator next to LOOM (ADR-0025) |
| `importers`, `exporters` | Converters between a published contract and a file format (for example a national timetable format) | WIT interface, file limits | File → Import / Export |
| `engines` | Behaviour for a mode in the simulation (§8) | WIT interface | Simulation runs |
| `mapLayers` | MapLibre style JSON over GeoJSON or grids that the plugin's calculations produce | MapLibre style spec subset | Map layer list |
| `panels` | A UI tier panel (§6) | Manifest | Side panel |

A plugin cannot change core behaviour, replace a core contribution, or hook into another plugin's internals. It can depend on another plugin (`dependsOn`) and use its published contributions, for example a ferry operators' catalogue that depends on the ferry mode plugin.

### 4. Compute: WebAssembly components with published interfaces

- **Format:** WebAssembly **components** (Component Model, WASI 0.2) with interfaces described in **WIT**. The interfaces live in a new `contracts/wit/` folder as the package `mobsimlab:plugin@1.0.0`, with one **world** per contribution kind: `calculation`, `check`, `mode-dynamics`, `schematic-layout`, `importer`, `exporter`.
- **Data in and out are the published contracts.** A function receives the inputs it asked for, serialised against our JSON Schemas (`rail-topology`, `published-timetable`, and new ones for street lines, stops, the unified graph view and vehicle types), plus its resolved parameters as `AssumedValue`s. It returns JSON against its declared output schema. There is no live object API into our internals, so internals can change without breaking plugins, and the contracts that are checked in CI today become the plugin API.
- **One binary, three hosts.** A Rust host crate `crates/plugin-host` embeds **Wasmtime** and runs components in the worker (through `mobsim-py`, like the rail kernel) and in the tool-runner. In the API and in the browser, components are transpiled to core WebAssembly plus JavaScript glue with **jco** at install time and run in a Node `worker_thread` or a browser Web Worker. Plugin authors can write in any language that targets components (Rust, C/C++, Go, C#, Python via componentize-py, JavaScript via ComponentizeJS); we publish a Rust SDK and templates first.
- **No ambient I/O.** The host links **no** WASI filesystem, socket, HTTP, environment or wall-clock imports. Randomness is a seeded generator from the run seed. Time is the simulation clock passed in. The only imports are a logger (rate-limited, to the plugin log) and a progress callback.
- **Limits.** Memory cap per instance (default 256 MiB), CPU budget through Wasmtime fuel and epoch interruption (default 30 s for a calculation, a per-step budget for engines), input and output size caps. Exceeding a limit fails the call with a clear error, never the process.
- **Determinism.** NaN canonicalisation and no threads in the host configuration, so the same component, inputs and parameters give the same bytes on every host. CI for a plugin (the `mobsimlab plugin test` command, §10) runs its golden tests on all three hosts.

### 5. Permissions and data access

Compute never fetches data. The core assembles the inputs for each call from what the manifest's `permissions` allow and the current user can read, and only for the **current project and scenario**:

| Permission | Gives the component |
|------------|---------------------|
| `read:network` | The scenario's network view (graph, stops, stations, tracks, the plugin's own infrastructure elements) |
| `read:timetable` | The published timetable of the scenario |
| `read:fleet` | Vehicle types and fleet |
| `read:geodata` | Imported layers (OSM features, population, DEM, water bodies) clipped to the study area |
| `read:results` | Results of runs of this scenario |
| `write:results` | Its output stored as a result of the call or run (ADR-0014) |
| `write:scenario` | Proposed changes, returned as a command batch that the user (or the agent's scenario, ADR-0035 §3) applies through the normal command model; never direct writes |

There is no permission for the internet, other projects, users, secrets, settings or the audit trail. A plugin that needs external data (for example AIS ship tracks for a ferry calibration) ships an importer, and the user brings the file. Downloads stay in the outbound gateway (ADR-0017), configured by an Admin as a normal provider.

### 6. UI integration

- **Without UI code** (the default): the core draws everything from the manifest. A mode appears in the tool palette and line panel; parameters appear in Project Preferences; calculation inputs become a form generated from their JSON Schema; outputs show as a table, a chart from a small declarative chart spec, or a map layer from the style JSON; findings from checks appear with the core's own live checks.
- **Authoring tools.** New modes reuse one of the core's **authoring kits** rather than bringing their own editor: the point circuit on streets (ADR-0029), the station-first track drawing (ADR-0030), and two new kits that cable cars and ferries need anyway: **straight spans between stations and supports** (aerial lifts, people movers) and **routes over water between terminals** (ferries, water buses). A mode chooses a kit and supplies its parameters and checks. `App.tsx`'s fixed tool union becomes a tool registry that lists the kits' tools for the enabled modes.
- **UI tier panels** run in an `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so they get an opaque origin and cannot read cookies, storage or the app's DOM. They are served from a plugin-asset route with a strict CSP (`default-src 'none'`, scripts and styles only from the plugin's own files, `connect-src 'none'`). They talk to the app through `postMessage` using a small typed host API (read the current selection, run one of the plugin's own calculations, show a map layer the plugin owns, open a dialog). Every message is checked against the plugin's permissions.
- **Plugin UIs follow the app's theme and language** through CSS custom properties and i18next resource files in the package.

### 7. Relation to the MCP server (ADR-0035)

They solve different problems and stay separate:

- **MCP** lets an agent outside MobSimLab *use* the simulator. **Plugins** change *what the simulator can do*. MobSimLab does not become an MCP client, and a plugin cannot call MCP, an AI model or any other service. Using external MCP servers as plugins was considered and rejected (see Alternatives).
- **Plugin calculations and checks become MCP tools automatically**, named `plugin.<short>.<name>`, with input and output schemas from the WIT world and the declared JSON Schemas, `readOnlyHint: true` and the `analysis:run` scope. They are listed only for projects where the plugin is enabled. An agent can therefore ask for a ferry running-time estimate or a plugin's noise grid exactly as it asks for `coverage_report` today. Plugin KPIs join the KPI catalogue resource and `benchmark_scenarios`.
- **Prompt injection:** plugin names, descriptions and outputs are returned to agents as marked data, as for user text today. A plugin cannot add MCP prompts or resources, so it cannot put instructions in front of an agent.

### 8. New transport modes as plugins: cable car and ferry

A mode is more than a colour. It needs a network representation, an authoring tool, vehicles, parameters, running times, capacity, a simulation behaviour, passenger stops, GTFS export and, for the noise map, emission data. The model above covers all of them:

| Need | Cable car (aerial lift) | Ferry | Contribution |
|------|-------------------------|-------|--------------|
| Network | Ropeway sections between stations, support towers as infrastructure, a new `aerial` edge family in the unified graph (ADR-0009) | Water routes between terminals and berths, `water` edge family, avoid land and shallow areas from the water layer | `modes`, `infrastructure` |
| Authoring | Straight spans kit | Water route kit | Core kit + plugin parameters |
| Vehicles | Cabins (monocable, bicable, tricable, aerial tram) | Vessels (passenger ferry, water bus; car ferries (ro-pax) later, not now (product owner, 2026-11-02; ADR-0037)) | `vehicles` |
| Running time and capacity | Rope speed, cabin interval, station dwell on the detached grip, or shuttle cycle for aerial trams | Sailing speed profile, manoeuvre and berthing time, passenger loading | `engines` (`mode-dynamics`), `parameters` |
| Checks | Span length, ground clearance against the DEM, angle at towers, wind limits | Water depth, berth length, crossing shipping lanes | `checks` |
| Simulation | Mesoscopic: departures at the cabin interval, travel time per section, capacity per cabin | Mesoscopic: trips with sail and berth times, capacity by deck | `engines` |
| GTFS | `route_type` 6 (aerial lift) | `route_type` 4 (ferry) | `modes` |

**Simulation engines.** The coordinator keeps the master clock (ADR-0007), as SUMO and the rail kernel already accept. A mode plugin's `engines` contribution does not own a loop; it implements a small **mesoscopic segment engine** interface that the coordinator drives: `depart(trip, t)`, `advance(t) -> events` (arrivals, departures, holds), `capacity(vehicle)`, `dwell(stop, boardings, alightings)`, and `reserve(resource, from, to) -> granted | wait(until)` for resources that one vehicle at a time may hold (berths, locks, the single track of an aerial tramway or a funicular passing loop). The coordinator owns the reservation table, so conflicts between plugins, and with core engines that share a resource, are resolved in one place. The core supplies the generic segment engine; the plugin supplies the numbers and rules. Microscopic interaction with road traffic or rail signalling is not a plugin feature; modes that need it (for example a guided bus on SUMO lanes) stay in the core engines. Persistence (ADR-0028) is enforced by the coordinator, not by the plugin: vehicles start and end in their declared depots or terminals.

**Decision (product owner, 2026-11-02).** Build cable car and ferry **as the first plugins, bundled with the image** (`org.mobsimlab.aerial-lift`, `org.mobsimlab.ferry`) once Phases 0 to 3 exist, and build the two new authoring kits and the segment engine in the core. Bundling means users get them without installing anything, while the plugin boundary is proven by two real modes before anyone else depends on it. Funiculars, people movers, demand-responsive services and bike or scooter sharing fit the same model. Monorails, air taxis and hyperloop are out of scope (product owner, 2026-11-02: not economically sustainable), so no plugin for them is planned. If the cable car and ferry work starts before Phase 3, it should still use the registries from Phase 0 so the modes can move into plugins without data migration.

**Noise map.** The noise estimate is a natural `calculation` (inputs: network, timetable, fleet, terrain; output: a grid and per-segment levels) with source data per vehicle type as `vehicles` and `parameters` contributions. Where the core method belongs is decided separately; this design only makes sure a plugin could add another national method next to it, and that vehicle noise data from a plugin's catalogue is used by the core method.

### 9. Lifecycle, trust and versioning

- **Install** is instance-wide and an **Admin** action (Owners hold every Admin right, so they can too; Editors and below cannot): upload a `.msplugin` file, or pick from the **public MobSimLab plugin registry** or another registry an Admin has added (fetched through the outbound gateway, ADR-0017). The install screen shows the publisher, signature status, tiers, permissions, licences and the contributions. Installation is audited (ADR-0012).
- **Enable per project.** A project Owner enables an installed plugin for a project and pins its version. Disabling hides the plugin's tools and keeps its data, marked as belonging to a disabled plugin.
- **Public registry.** The MobSimLab project runs a public plugin registry: an index of signed packages with publisher, version, licence, permissions and download hash, served as static files so any instance can mirror it. Listing needs a verified publisher and a passing `mobsimlab plugin check`; it is a catalogue, not an endorsement, and each instance's trust policy still decides what installs. Instances on private networks can use uploads or a mirrored copy.
- **Signatures.** Packages are signed with **Sigstore** (cosign bundle in the package), checked against the instance's trust policy: `official` (MobSimLab release key), `trusted publishers` (an Admin's list) and `unsigned`, which an Owner can switch on **only in development mode** (§10); outside development mode unsigned packages are always refused. Each package carries an SBOM and a SHA-256 of every file; the hash of the whole package is what projects and results record.
- **Versioning.** Plugins use SemVer. The plugin API (manifest schema, contribution schemas, WIT package) has its own major version; a major bump has a deprecation period of at least two minor MobSimLab releases in which both versions load. Data a plugin wrote is stored with the plugin id and version, and a plugin can ship **migrations** (data-tier JSON Patch or a compute `migrate` function) that run when a project upgrades it.
- **Reproducibility.** Every result manifest (ADR-0014) lists the plugin ids, versions and package hashes it used. Re-running an old result with a newer plugin version is a new run; old results are not silently recalculated.
- **Project files.** `.mslab` (ADR-0021) gains `requiredPlugins` with version ranges and hashes. Opening a project on an instance without a required plugin opens it read-only for that plugin's objects, shows them as opaque elements with their stored geometry, and names the missing plugin; nothing is dropped. Plugin data is exported in the plugin's own namespace inside the ZIP.
- **Uninstall** is refused while a project uses the plugin, unless an Admin confirms and the affected projects keep opaque data.

### 10. Developer experience

- `mobsimlab plugin new | check | test | pack | sign` in the existing CLI (`apps/api/src/cli`). `check` runs the same validators as our CI (manifest, vehicle and assumption checks, licence gate, WIT compatibility); `test` runs golden tests on all three hosts.
- A Rust SDK crate with the WIT bindings and typed contract structs (generated by `typify` from `contracts/`, as ADR-0004 already does), templates for a data-only plugin, a calculation and a mode, and a guide in `docs/plugins/`.
- A **development mode** where an Owner can load an unpacked plugin folder and reload it without restarting the instance.

### 11. Security

New threats for the threat model (§4, a new "Plugins" table):

| ID | Threat | Mitigation |
|----|--------|------------|
| PL1 | Malicious plugin exfiltrates project data | No network, file, environment or clock imports; data only passed in for the current project and permitted kinds; UI iframes without same-origin and with `connect-src 'none'` |
| PL2 | Plugin code escapes the sandbox | Wasmtime with a pinned, patched version and no WASI capabilities; components run in worker processes or `worker_thread`s, never the API's main thread; the existing process hardening (seccomp, rlimits, non-root) applies |
| PL3 | Plugin exhausts CPU or memory | Fuel / epoch limits, memory caps, output size caps, per-user run quotas count plugin time |
| PL4 | Tampered or typosquatted package | Sigstore signature against the trust policy, per-file hashes, Admin-only install, audit event, reverse-DNS ids shown with the publisher |
| PL5 | Plugin changes results silently (bad numbers, non-determinism) | Assumption rules apply to plugin parameters; result manifests record plugin hashes; golden tests on three hosts; outputs labelled with the plugin in every report |
| PL6 | Plugin UI tricks the user (fake sign-in, fake consent) | UI only inside a labelled side panel frame with the plugin name; no pop-ups, no navigation, no full-screen; host API cannot open the consent or account pages |
| PL7 | Licence problems from bundled plugin data | Licence gate on install; data licence must allow `.mslab` export or the plugin's data is not exportable, as for sources today (I5) |

### 12. Delivery in phases

| Phase | Scope | Useful on its own because |
|-------|-------|----------------------------|
| 0 | Turn the hard-coded lists into registries: modes (street and rail), tools in `App.tsx`, KPIs, catalogues; manifest and contribution schemas in `contracts/`; the core registers itself through them | Removes the unions that every new mode has to edit today, including cable car and ferry |
| 1 | Data-tier plugins: install, enable per project, signatures, `.mslab` `requiredPlugins`, Project Preferences and catalogue integration, audit | National catalogues and guidance without code |
| 2 | Compute: `crates/plugin-host`, WIT package, `calculation` and `check` worlds, jco for API and browser, auto MCP tools, result provenance, `mobsimlab plugin` CLI and Rust SDK | Calculations such as alternative noise or accessibility methods |
| 3 | Modes and engines: infrastructure elements in the unified graph, the straight spans and water route kits, the mesoscopic segment engine, `mode-dynamics` and `engines`; cable car and ferry as bundled plugins | Two new modes, and proof that the model holds |
| 4 | Schematic styles and layouts, importers and exporters, UI-tier panels, the public plugin registry | The rest of the asked-for scope |

## Alternatives considered

| Option | Why not |
|--------|---------|
| Python plugins in the worker (QGIS style) | Full process access to every project and secret; results depend on whatever the plugin imports; would only run in the worker, not the browser or API |
| JavaScript plugins in the API or browser main thread | Same trust problem; a bug blocks the API's event loop; no determinism guarantees |
| Native shared libraries or extra executables in the tool-runner | Hardest to sandbox, platform-specific builds, breaks image signing and the two-container rule in spirit |
| Each plugin as its own service or container, called over HTTP or gRPC (Grafana backend style) | A third container (ADR-0003), network access from plugins, and operators would need to run and update them |
| External MCP servers as plugins, MobSimLab as MCP client | Outbound calls with project data, results that depend on someone else's server and possibly a model; contradicts ADR-0017, ADR-0018 and ADR-0035 §1 |
| Plain core WebAssembly modules with a hand-written JSON ABI (as the kernels use now) | Works, but every plugin re-implements memory handling and string passing; the Component Model and WIT give typed, versioned interfaces and multi-language tooling for the same runtime cost |
| Data-only plugins, no code | Safe, but cannot add a running-time model, a check or a noise method, which is most of what was asked |
| Plugins with direct read access to the database (views or RLS) | Couples plugins to our schema forever and bypasses permission checks in the service layer |
| Build every new mode in the core, no plugins | Fine for cable car and ferry alone, but every country-specific catalogue, method and style would need a core release; the hard-coded lists would keep growing |

## Consequences

- Phase 0 is worth doing regardless of the rest: every new mode currently touches TypeScript unions, Rust enums and hard-coded records in several places.
- The published contracts in `contracts/` become a public API with compatibility rules. Changes need a version and a deprecation period, not just a CI update.
- New work: `crates/plugin-host` (Wasmtime), the WIT package, jco in the build, the plugin install and enable flow in the API and UI, the tool registry in the web app, the two authoring kits and the segment engine, `.mslab` format version bump, threat model update, CLI, SDK and guide.
- The image grows by Wasmtime (in the worker) and the jco runtime; no new process or container.
- Some ideas cannot be plugins: anything that needs the internet at run time, direct database access, a new microscopic engine that interacts with SUMO or the rail kernel, or changes to permissions and auth. Those stay core work.
- Licensing needs a legal check before Phase 1: whether a plugin running in our host is a "work based on" MobSimLab under AGPL-3.0, and therefore which plugin licences we accept. Until then, the trust policy accepts AGPL-compatible licences only.

## Product owner answers (2026-11-02)

1. **Install:** Admins install plugins (Owners hold every Admin right). Project Owners enable them per project.
2. **Cable car and ferry** are the first built-in plugins (§8).
3. **Public registry:** yes, the project runs a public plugin registry (§9). Instances can still install uploads and add other registries.
4. **Unsigned plugins:** an Owner may allow them only in development mode.
5. Earlier in the day, in the cable car and ferry work (ADR-0037): car ferries come later, and monorails, air taxis and hyperloop are out of scope.

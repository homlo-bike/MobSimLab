# 02 — Requirements

Each requirement has an ID so tests, ADRs and issues can reference it. Priority: **M** = must for v1.0, **S** = should, **C** = could. "Brief" means the requirement comes directly from the product brief; anything else is derived.

## Functional requirements

### FR-PLAT — Platform, projects, files

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-PLAT-01 | Users create, open, save, save-as, duplicate, archive and delete projects. | M |
| FR-PLAT-02 | Projects have visibility Private, Shared (named users/groups with a role) or Public (read-only to anyone, including anonymous if the admin allows). | M |
| FR-PLAT-03 | File menu: New, Open, Save, Save As, Export, Import, Settings, Project Preferences, Help (Documentation, Tutorial, Demonstration, Example Projects, GitHub URL, Demo URL). | M |
| FR-PLAT-04 | Projects export to a versioned `.mslab` file (ZIP) including custom vehicles, sources and assumptions; import migrates older versions forward. | M |
| FR-PLAT-05 | Project Preferences: all model variables (FR-ASM-05), network/mode/line colours, gauge defaults, platform standards, energy and electrification standards, service windows, peak periods, holiday calendars, reserve fleet % (default 15 %). | M |
| FR-PLAT-06 | Scenarios: named variants of a project's base network; compare any two scenarios side by side. | M |
| FR-PLAT-07 | About, Licenses and Attribution pages generated from the source registry and dependency SBOM. | M |

### FR-OBJ — Persistent objects and metadata

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-OBJ-01 | Every persistent object has: `id` (global UUIDv7), `name`, `description`, `createdAt`, `updatedAt`, `createdBy`, `modifiedBy`, `comments`, `tags`, `sources`, custom fields. | M |
| FR-OBJ-02 | Every change to a persistent object writes an audit record (who, when, what, before, after, reason). | M |
| FR-OBJ-03 | Persistent assets are only created or removed by explicit user or API action, never by the simulation. | M |
| FR-OBJ-04 | Admins define custom field schemas per object type, per project. | S |

### FR-AUTH — Users and access

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-AUTH-01 | Login only via OIDC (Authorization Code + PKCE). Multiple providers allowed. | M |
| FR-AUTH-02 | The first user to log in becomes Owner. The instance stays in setup mode, refusing all other logins, until the Owner completes the setup wizard (see C-07). | M |
| FR-AUTH-03 | Instance roles Owner, Admin, User, Viewer, Restricted. | M |
| FR-AUTH-04 | Map IdP groups to roles automatically; admins can override per user. | M |
| FR-AUTH-05 | Admins enable/disable auto-registration, restrict, delete users, manage projects. | M |
| FR-AUTH-06 | Project-level roles (Project Owner, Editor, Commenter, Viewer) separate from instance roles. | M |

### FR-GIS — Geodata

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-GIS-01 | Import the OSM feature classes listed in the brief for a user-drawn or administrative boundary. | M |
| FR-GIS-02 | Overpass client: configurable endpoint, throttling, retry with backoff, geographic limits, timeouts, caching, provider health. | M |
| FR-GIS-03 | PBF import path for large areas. | M |
| FR-GIS-04 | Population from WorldPop and GHSL; uploads of GeoTIFF, GeoJSON, CSV (with lat/lon or zone join), with source, confidence, timestamp, resolution, coverage. | M |
| FR-GIS-05 | DEM import for project area (Copernicus GLO-30 default; GeoTIFF upload). | M |
| FR-GIS-06 | Everything is a layer: visible/hidden, opacity, min/max zoom, order, style. | M |
| FR-GIS-07 | Basemaps: OpenFreeMap (Liberty, Bright, Positron), Sentinel-2 Cloudless, optional Esri imagery, offline styles, external WMTS/WMS/XYZ, with optional username/password via proxy. | M |
| FR-GIS-08 | OSM and ODbL attribution shown on every map view and export that contains OSM data. | M |
| FR-GIS-09 | Provider framework for WorldPop, GHSL, Open-Elevation, Elevation-API.eu, Mobility Database, GBFS, GTFS, GTFS Validator, Transit Costs, World Bank, OC4IDS, Nager.Date, weather, OpenRouteService, CAMARA. Each configurable and individually disable-able. | M |

### FR-NET — Network and design

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-NET-01 | One unified graph of nodes (intersections, stations, stops, switches, platforms, depot gates) and edges (roads, rail tracks, walk links, cycle links). | M |
| FR-NET-02 | All routing (passenger, vehicle, train) uses the unified graph and one routing library. | M |
| FR-NET-03 | Track types: surface, elevated, underground, bridge, existing corridor, ramp, depot track. Segment types: line, arc, transition curve (clothoid). | M |
| FR-NET-04 | Validate radius, cant, cant deficiency, gradient, clearance, tunnel and bridge constraints; elevation sampled every 50 m; below recommended = warning, below minimum = error. | M |
| FR-NET-05 | Stations named automatically by priority: nearby station, nearby stop, OSM landmark, street name, district. Editable. | M |
| FR-NET-06 | Stations within a configured distance grouped; interchange stations act as one station. | M |
| FR-NET-07 | Station creation wizard: 1–2 side platforms and N island platforms; elevators, ramps, stairs, accessibility metadata. | M |
| FR-NET-08 | Platform validator: platform height, floor height, horizontal and vertical gap, platform length; editable standards; default EU TSI PRM. | M |
| FR-NET-09 | Bus/BRT/trolleybus depots from a polygon with entrances, exits, parking, charging, maintenance, reserve, circulation; slots generated automatically; dynamic sizing. | M |
| FR-NET-10 | Rail depots from storage tracks; capacity check against fleet with warnings. | M |
| FR-NET-11 | Lines, routes, patterns, stop sequences for all 11 modes; regional and long-distance rail may share infrastructure. | M |
| FR-NET-12 | GTFS import of existing services into the network. | M |

### FR-VEH — Vehicles

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-VEH-01 | Built-in catalogue, one JSON per vehicle under `vehicles/<mode>/<manufacturer>_<model>.json`. | M |
| FR-VEH-02 | Full vehicle data model from the brief, each field with provenance. | M |
| FR-VEH-03 | Custom vehicle libraries and uploads, validated by JSON Schema, stored inside the project. | M |
| FR-VEH-04 | Fleet: individual vehicles (instances of a vehicle type) with depot assignment, age, status. | M |

### FR-SIM — Simulation

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-SIM-01 | Road modes (bus, BRT, trolleybus, intercity bus) simulated in SUMO with congestion, signals, intersections, dwell. | M |
| FR-SIM-02 | Rail modes simulated in the rail operations kernel: block reservation, signals, route locking, switches, interlocking, dispatching, platform assignment, rerouting. | M |
| FR-SIM-03 | Street-running trams and level crossings co-simulated between SUMO and the rail kernel. | M |
| FR-SIM-04 | Vehicles accelerate, brake, queue, wait, obey signals and speed limits; never overlap. | M |
| FR-SIM-05 | Articulated, Jacobs-bogie, low-floor and gangway vehicle geometry shown and used for clearance checks. | M |
| FR-SIM-06 | Simulation view: play, pause, reset, speed; read-only. | M |
| FR-SIM-07 | Scenarios: weekday, weekend, holiday, peak, off-peak, disruption, equipment failure, infrastructure failure. | M |
| FR-SIM-08 | Multi-year simulation via day types and calendar expansion; user-defined years; Nager.Date holidays; seasons. | M |
| FR-SIM-09 | Depot movements simulated with the same rules as the network. | M |
| FR-SIM-10 | Runs are reproducible: same inputs + seed = same results. | M |

### FR-TT — Timetables

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-TT-01 | Workflow: warm-up run → collect trips → running times by period → build timetables → validate → simulate. | M |
| FR-TT-02 | Early vehicles hold at timing points. | M |
| FR-TT-03 | Peak, off-peak, weekend, holiday schedules. | M |
| FR-TT-04 | Vehicle and crew-free block (vehicle schedule) generation respecting reserve fleet. | M |
| FR-TT-05 | Export GTFS, CSV and PDF timetables. | M |
| FR-TT-06 | Rail timetables checked for conflicts (headway, platform, route) before simulation. | M |

### FR-DEM — Demand

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-DEM-01 | Four-step model: generation, distribution, mode choice (walk, cycle, transit, car), assignment. | M |
| FR-DEM-02 | Drivers: population, jobs, retail, tourism, schools, universities, hospitals, CBDs. | M |
| FR-DEM-03 | Cycle infrastructure extends stop catchments; pedestrian zones increase transit attractiveness. | M |
| FR-DEM-04 | Calibration against observed counts when provided. | S |

### FR-COST — Cost and appraisal

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-COST-01 | Capital, lifecycle, operating, maintenance cost. | M |
| FR-COST-02 | FNPV, FIRR, ENPV, ERR, BCR, MCA. | M |
| FR-COST-03 | Externalities: emissions, noise, accidents, health, congestion. | M |
| FR-COST-04 | Sensitivity and switching-value analysis. | M |

### FR-ASM — Assumptions and sources

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-ASM-01 | Missing values handled by the 8-step assumption workflow in the brief. No built-in AI. Every default is cited, documentation-supported, or a documented educated guess. | M |
| FR-ASM-02 | Assumed values stored as `{value, assumed, low, central, high, sensitivity, sourceId, rationale}`. | M |
| FR-ASM-03 | Source registry: name, URL, licence, use case, date retrieved, for every dataset, method, calculation, assumption, API, vehicle spec. | M |
| FR-ASM-04 | Assumptions report export per project. | M |
| FR-ASM-05 | Every value that acts as a variable in the project is adjustable in the Project Preferences window, with its basis, source, range and a reset to default. | M |

### FR-SCH — Schematics

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-SCH-01 | Generate schematic diagrams per mode layer (Bus, BRT, Tram, Metro, Regional, Long-distance). | M |
| FR-SCH-02 | Edit: drag stations, curved lines, simplification, water bodies. | M |
| FR-SCH-03 | Export SVG and PDF. | M |

### FR-LOG — Logging and audit

| ID | Requirement | Pri |
|----|-------------|-----|
| FR-LOG-01 | Levels TRACE, DEBUG, INFO, WARN, ERROR, CRITICAL, AUDIT; sinks console, file, PostgreSQL. | M |
| FR-LOG-02 | Frontend logs (Pino) batched to the backend. | M |
| FR-LOG-03 | Audit viewer for admins with filters and export. | M |

## Non-functional requirements

Targets are for a reference host: 8 vCPU, 32 GB RAM, SSD. They will be confirmed by the Phase 0 spikes.

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-SEC-01 | Security | OWASP ASVS 4.0.3 Level 2 | All L2 controls pass, tracked in a checklist |
| NFR-SEC-02 | Security | No high/critical known vulnerabilities in shipped image | CI gate (Trivy, npm audit, pip-audit, cargo-audit) |
| NFR-SEC-03 | Security | No secrets in code, image or logs | gitleaks in CI; log redaction tests |
| NFR-PERF-01 | Performance | UI map interaction | 60 fps pan/zoom with 50k features visible; 5,000 animated vehicles at ≥ 30 fps |
| NFR-PERF-02 | Performance | API latency | p95 < 200 ms for CRUD at 50 concurrent users |
| NFR-PERF-03 | Performance | Rail kernel | 2,000 trains, 1 simulated day, ≥ 50× real time on one core |
| NFR-PERF-04 | Performance | SUMO road sim | City of 500k inhabitants, 1 peak hour with background traffic, ≥ 10× real time |
| NFR-PERF-05 | Performance | Demand model | 1,000 zones, full four-step, < 10 min |
| NFR-SCAL-01 | Scalability | Concurrent simulation runs | Configurable; default 2 per worker process |
| NFR-REL-01 | Reliability | API survives worker crash | Worker crash marks run failed; API unaffected |
| NFR-REL-02 | Reliability | No data loss on restart | All state in PostgreSQL or project volume; runs resumable from checkpoints |
| NFR-ACC-01 | Accuracy | Running times | Within ±3 % of OSRD on reference rail test networks |
| NFR-ACC-02 | Accuracy | Reproducibility | Bit-identical results for same inputs, seed and version |
| NFR-ACC-03 | Accuracy | Units | SI units internally; explicit units on every API field |
| NFR-MAINT-01 | Maintainability | Test coverage | ≥ 80 % lines on domain modules; mutation testing on calculation modules |
| NFR-MAINT-02 | Maintainability | Docs | Public functions documented (purpose, inputs, outputs, dependencies, side effects); lint-enforced |
| NFR-MAINT-03 | Maintainability | Generated maps | Module, function and dependency maps regenerated in CI |
| NFR-OSS-01 | Compliance | Licence gate | CI fails on a dependency licence not on the allowlist |
| NFR-OSS-02 | Compliance | Generated documents | LICENSE, NOTICE, ATTRIBUTION, SECURITY.md, PRIVACY.md, THIRD_PARTY_LICENSES.md produced by CI |
| NFR-OSS-03 | Compliance | SBOM | CycloneDX SBOM attached to every release |
| NFR-A11Y-01 | Accessibility | UI | WCAG 2.2 AA for all non-map controls; keyboard operable |
| NFR-I18N-01 | Internationalisation | UI | All strings externalised (i18next); English first; units metric with imperial display option |
| NFR-PRIV-01 | Privacy | Personal data | Only OIDC subject, email, name, group claims stored; GDPR export and erase |
| NFR-OPS-01 | Operations | Install | `docker compose up` from a clean host with one generated secrets file |
| NFR-OPS-02 | Operations | Backup | Documented `pg_dump` + volume backup; restore tested in CI |
| NFR-OPS-03 | Operations | Observability | Health, readiness endpoints; Prometheus metrics endpoint (opt-in) |

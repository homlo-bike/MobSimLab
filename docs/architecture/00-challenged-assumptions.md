# 00 — Challenged assumptions

The brief asks us to "challenge unrealistic assumptions". This document does that. Each item states what the brief says, why it is a problem, and what we propose. Items marked **Decision needed** change the product and need the product owner's approval. Everything else is a technical clarification that the rest of the architecture already follows.

Severity: **High** = would block delivery or create legal/security exposure. **Medium** = would cause major rework or poor results. **Low** = clarification.

---

## C-01 · One application container for frontend, backend, GIS, routing, SUMO and rail simulation — High · **Decided**

**Brief:** Two runtime services only: `mobsimlab` (frontend, backend, GIS, routing, simulation) and `postgres`.

**Problem.**
- SUMO is a C++ program. The rail operations kernel needs to be compiled, CPU-heavy code. NestJS is a single-threaded Node.js process. Putting all of them in one container means one process crash, memory leak, or CPU-bound simulation can take down the web UI and API for every user.
- Containers are designed around one main process. Running several needs a process supervisor inside the container.
- A city-scale simulation can use several CPU cores and several GB of RAM for hours. It cannot share a scheduling budget with the API without starving it.
- It cannot scale: there is no way to add more simulation capacity without adding more copies of the whole application.

**Decision (product owner, 2026-10-27; ADR-0003).** Exactly two containers. Simulation runs inside the `mobsimlab` container (backend side), built as separate processes so it cannot take the API down:

- Inside `mobsimlab`, a small supervisor (s6-overlay) runs three kinds of process: the `api` (NestJS, also serves the built frontend on port 8080), one or more `sim-worker` processes, and an on-demand `tool-runner` for batch tools (GTFS Validator, SUMO `netconvert`, osmium).
- Processes talk through a job queue stored in PostgreSQL (pg-boss) and a local socket for live simulation frames. No Redis or message broker is needed.
- Workers get CPU and memory limits, and a per-instance cap on concurrent simulation runs.

Simulation runs on the backend, not in the browser: a browser tab cannot run SUMO or the rail kernel at city scale, and results must be shared and reproducible for every user. The browser renders playback. There is no third container. Larger installations scale by giving the `mobsimlab` container more CPU and memory and raising the number of `sim-worker` processes (`MOBSIMLAB_SIM_WORKERS`).

---

## C-02 · NodeJS/NestJS as the backend for everything — High · **Decided**

**Brief:** Backend is NodeJS + TypeScript + NestJS.

**Problem.**
- Rail operations for "thousands of trains", geometric vehicle kinematics, and four-step demand models are numeric workloads. Node.js is a poor fit: single-threaded event loop, no SIMD, garbage-collector pauses, slow numeric arrays compared to compiled code.
- The mature open-source tools we are told to reuse are not JavaScript: SUMO (C++, with `libsumo` bindings for C++, Python and Java), AequilibraE (Python, four-step demand modelling), SUMO's own tooling (Python), the MobilityData GTFS Validator (Java).
- "Never reinvent existing mature solutions" and "NestJS only" contradict each other.

**Proposal (ADR-0004).** Use NestJS for what it is good at: the HTTP/WebSocket API, authentication, authorization, persistence, orchestration, provider gateway. Add two compute layers:

- **`sim-worker` in Python 3.12**, because that is where `libsumo` (in-process SUMO, far faster than TraCI over TCP) and AequilibraE already live.
- **Rail operations kernel and vehicle kinematics in Rust**, packaged as a Python extension module (PyO3). Rust gives C-like speed and memory safety. There is no mature embeddable open-source rail microsimulator we can reuse (see C-05).

TypeScript stays the language of the API and the UI. Shared contracts (JSON Schema → generated TypeScript types and Python/Rust types) prevent drift.

**Decision (product owner, 2026-10-27):** any language is allowed as long as it stays compatible with the project. The polyglot runtime (TypeScript + Python + Rust) is accepted.

---

## C-03 · "Vehicle movement must be based on geometry… wheel paths determine motion" together with "use SUMO, don't reinvent traffic simulation" — High

**Problem.** SUMO models each vehicle as a point moving along a lane, with a length and a rectangle for drawing. It does not simulate wheels, axles or articulation. Nobody runs full 2-D multibody dynamics for thousands of vehicles in a planning tool; it would be thousands of times slower and add no planning value.

**Proposal (ADR-0008).** Two layers:

1. **Motion layer (authoritative).** Every vehicle moves along a path in one dimension: distance along path, speed, acceleration. SUMO does this for road vehicles. The rail kernel does it for trains. Safety (no overlap, no collision) is guaranteed here: car-following and junction rules in SUMO; block and route reservation in the rail kernel.
2. **Geometry layer (derived, deterministic).** For each vehicle, the position of every axle, bogie, body section, gangway and coupler is computed from the path position and the vehicle's geometry definition. Each axle sits at a known distance behind the front along the same path (rail), or follows a kinematic single-track tractrix model (articulated buses). Articulation angles, body swing-out and swept envelopes come from this.

The geometry layer is used for drawing, swept-path and clearance checks during design, platform-gap checks, and depot manoeuvre validation. It is the honest meaning of "motion based on geometry" at planning scale.

---

## C-04 · "Nothing spawns automatically, nothing disappears automatically" — Medium

**Problem.** Background car traffic is necessary for realistic bus congestion. In every traffic simulator, including SUMO, car traffic is generated from demand and cars leave the network when they arrive. Passengers likewise appear and leave. A literal reading of the rule would ban congestion modelling.

**Proposal (ADR-0028).** The persistence rule applies to **modelled assets**: transit vehicles, infrastructure, depots, lines, users, projects. These have global IDs and audit history, start in a depot or a defined location, and only leave by an explicit action (retirement, deletion). **Background traffic and passengers are declared demand objects** (an explicit, audited "traffic demand" or "passenger demand" record). The individual cars and passengers they generate are transient agents with no global ID. They enter and leave only at declared network boundaries or zones, never in the middle of a link.

---

## C-05 · Rail operations "using concepts from OpenTrack, Open Rails, Railway Manager, Rail Network Route Finder" — Medium

**Problem.** OpenTrack is proprietary. Open Rails is a GPL-3.0 C# train-driving game. Neither can be embedded. The most relevant open-source project is **OSRD** (Open Source Railway Designer, SNCF Réseau / OpenRail Association), which does infrastructure modelling, running-time calculation, signalling simulation and conflict detection. But OSRD is a large multi-service platform (Rust, Kotlin/JVM, React, message broker, cache) and cannot fit the two-container deployment.

**Proposal (ADR-0006).** Build a focused rail operations kernel in Rust. Reuse OSRD's published data model ideas (RailJSON) and its running-time approach as references, and SUMO's rail signal semantics where it helps interoperability. Reuse established algorithms from libraries (`petgraph`, `pathfinding` for Dijkstra, A*, Yen's K-shortest paths). Treat OSRD as a **validation oracle**: run the same test network in both and compare running times.

---

## C-06 · Multi-year simulation at microscopic detail — High

**Problem.** One year has 31.5 million seconds. A city network with SUMO congestion runs at maybe 10–100× real time on one core. Microscopic simulation of every day for several years would take days to weeks per scenario.

**Proposal (ADR-0020).** Professional practice is to simulate **representative day types** (for example: school weekday, holiday weekday, Saturday, Sunday, public holiday, each per season) in full detail, then expand to annual and multi-year results with calendar weights (from Nager.Date holidays and user-defined seasons). Year-to-year changes (demand growth, fleet ageing, new infrastructure opening) are applied between years. Users can still run any specific day in full detail. Continuous multi-day runs are supported for fleet and depot questions (charging, maintenance cycles), but at a coarser time step.

---

## C-07 · "First user logging into an instance automatically becomes Owner" — Medium · **Decided**

**Concern raised.** If the OIDC provider allows open sign-up, whoever logs in first takes full control.

**Decision (product owner, 2026-10-27; ADR-0015).** MobSimLab is self-hosted and not exposed to the internet, so the brief's rule stays: **the first user to log in becomes Owner**. The instance then stays in **setup mode** until the Owner finishes the setup wizard (identity providers, group mappings, registration policy, providers, basemaps, defaults). In setup mode every other login is refused with "This instance is being set up", so nobody else can reach the instance before the Owner has configured it.

Optional hardening for operators whose IdP is shared with other people: `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (or `_SUBJECT`) restricts who may become the first Owner. It is off by default. Auto-registration is **off** by default.

---

## C-08 · Overpass as the main OSM import path — Medium

**Problem.** Public Overpass servers have strict fair-use limits (roughly 10,000 queries and about 1 GB per day per user on the main instance) and time out on large areas. Importing all the requested feature types (roads, buildings, land use, POIs…) for a metropolitan region through Overpass is slow, unreliable, and against the spirit of the usage policy.

**Proposal (ADR-0010).** Support both, picked automatically by area size:
- **Overpass** for small areas and incremental refresh (configurable endpoint, throttling, retries, timeouts, cache, health status, as requested).
- **PBF extracts** (Geofabrik or a user-provided file) processed with `osmium` and `osm2pgsql` (flex output) for anything above a configurable area threshold.

Both paths produce the same PostGIS tables.

---

## C-09 · Elevation checks every 50 m using public elevation APIs — Medium

**Problem.**
- Free global DEMs (SRTM, Copernicus GLO-30) have a 30 m grid and vertical errors of several metres. They are surface models: they include buildings and trees. Gradient checks derived from them are **planning-grade**, not engineering-grade.
- A 50 km alignment sampled every 50 m is 1,000 requests per edit. Public APIs (Open-Elevation, Elevation-API.eu) will rate-limit this.

**Proposal.** Import DEM tiles once per project area into PostGIS raster (Copernicus GLO-30 by default, user GeoTIFF upload for better local data such as LiDAR). Sample locally. Keep the external APIs as optional fallbacks. The UI labels gradient and clearance results with the DEM source and its stated accuracy, and the assumptions engine records it.

---

## C-10 · "AI Assumption Engine" — Medium · **Decided**

**Concern raised.** If a language model invents defaults and low/central/high ranges, results are not reproducible, not traceable to a source, and can be confidently wrong.

**Decision (product owner, 2026-10-27; ADR-0018).** There is **no built-in AI**. The assumption engine is deterministic:

- Every value is **cited** or **supported by documentation**.
- Where no information exists, the maintainers write an **educated guess** into the assumption library, with its reasoning and a low/central/high range. It is labelled "educated guess" everywhere it is used.
- **Every value that acts as a variable in the project can be adjusted by the user in the Project Preferences window** (see [09 §1.5](09-planning-models.md#15-project-preferences-every-variable-is-editable)).
- Sensitivity is computed numerically (one-at-a-time tornado charts, optional Monte Carlo).

---

## C-11 · Vehicle catalog with every field filled for 2–10 models per category across 18 manufacturers — Medium

**Problem.** Many requested fields are not public: wheel and axle positions, door positions, capital cost, operating cost, maintenance assumptions, minimum radius for some models. Capital costs vary widely by contract and year. Filling these with guesses and shipping them as "specifications" would be misleading.

**Proposal (ADR-0026).** Every field in every vehicle file has a provenance entry: `source` (registry ID), `assumed` flag, and low/central/high when assumed. Values from manufacturer brochures are marked as such. Unknown values are explicit assumptions with ranges. Manufacturer names and model names are used for identification only (nominative use) with a trademark notice. The first catalog release targets 2–3 well-documented models per category, grown by contributors over time. The brief's 2–10 target is the long-term goal.

---

## C-12 · Some listed data sources are not free or open — High (licensing)

| Source | Issue |
|--------|-------|
| Sentinel-2 cloudless (EOX) | Only the 2016 layer is CC BY 4.0. 2018 and later layers are CC BY-NC-SA 4.0 (non-commercial). Transit agencies and consultancies are commercial users. Default to the 2016 layer and warn. |
| Esri World Imagery | Proprietary terms, requires an Esri account/API key for most uses, no caching. Optional, off by default, user-provided key. |
| CAMARA Population Density API | Open API specification, but data comes from mobile network operators under commercial agreements. Adapter only; no default provider. |
| Weather APIs | Most free tiers are non-commercial (for example Open-Meteo's free API). Adapter with user-provided endpoint. |
| OpenRouteService | Public API needs a key and has quotas. It is also a second routing engine, which conflicts with "avoid duplicate routing engines". Use only as an optional external comparison, never inside simulation. |
| Transit Costs Project | Dataset is published via NYU's repository; reuse licence must be confirmed before bundling. Until then: link, do not bundle. |
| OpenStreetMap | ODbL share-alike applies to **derived databases** that are publicly shared. Public projects that include OSM-derived data must carry ODbL notices, and the project export must say so. |

Full detail in the [license compliance report](../compliance/license-compliance-report.md).

---

## C-13 · Logging: "AUDIT" as a log level, and logs in PostgreSQL — Medium

**Problem.** Audit records have different rules from logs: they must not be lost, must not be sampled, must be tamper-evident, and have their own retention. Mixing them into log levels means a log-level change can silently disable auditing. Writing TRACE/DEBUG logs into PostgreSQL will bloat the database and slow down the simulation.

**Proposal (ADR-0012, ADR-0022).** Keep `AUDIT` as a level name in the logger API for developer convenience, but route it to a **separate append-only, hash-chained audit table** written in the same database transaction as the change it describes. Console and file sinks take any level. The PostgreSQL log sink takes `WARN` and above only, with retention. Also: Pino is mainly a Node.js logger and Winston is too; the brief puts Pino on the frontend and Winston on the backend. That works (Pino has a browser build), and browser logs are shipped to the backend in batches. We keep that split as requested.

---

## C-14 · "Every function must contain comments explaining purpose, inputs, outputs, dependencies and side effects" and "function dependency maps" before coding — Low

**Problem.** A function map cannot be written before the functions exist. Boilerplate comments on trivial private helpers become stale noise.

**Proposal.** This plan gives **planned** module and key-function maps (see [11-diagrams.md](11-diagrams.md)). After coding starts, maps are **generated** in CI (`dependency-cruiser` for TypeScript, `pydeps` for Python, `cargo-modules` for Rust, plus a call-graph extractor) so they never drift. Every exported/public function gets a structured doc comment (TSDoc, Python docstring, Rust doc) with purpose, inputs, outputs, dependencies and side effects, enforced by lint rules. Private one-line helpers need only a one-line comment.

---

## C-15 · "Simulation view: read-only editing" — Low

Read as: the simulation view is read-only. Network editing is disabled while a simulation is shown; the only controls are play, pause, reset, speed and scenario selection. Edits happen in the design view and require a new simulation run.

---

## C-16 · Port 8080 with OIDC, CSRF and secure cookies — Low

OIDC and `Secure` cookies require HTTPS. The container serves plain HTTP on 8080 and **must** sit behind a TLS-terminating reverse proxy in any non-local deployment. The app refuses to start in production mode unless `MOBSIMLAB_PUBLIC_URL` is `https://`. A sample Caddy configuration will be documented (not a required service).

---

## C-17 · "Do not optimize for backward compatibility unless published" — Low

Accepted for code and APIs. **Project files are user data**, so the project file format is versioned from day one with forward migrations. Losing users' saved projects on upgrade is not acceptable even before 1.0.

---

## C-18 · Basemap layers with username/password — Medium (security)

Sending credentials to the browser exposes them to every viewer of a shared project. **Proposal:** protected layers are fetched through a backend tile proxy that injects encrypted, stored credentials. The proxy enforces an allowlist and SSRF protections (ADR-0017). The same gateway serves configurable Overpass and provider endpoints.

---

## C-19 · GTFS Validator requires Java — Low

The MobilityData GTFS Validator is a Java application. Bundling a JRE adds roughly 150–200 MB to the image. **Proposal:** bundle a minimal JRE (jlink) in the image and run the validator as an on-demand tool. Alternative if image size matters: optional add-on image.

---

## Decisions log

| ID | Question | Decision |
|----|----------|----------|
| C-01 | Container topology | Exactly two containers; simulation inside `mobsimlab` (2026-10-27) |
| C-02 | Languages | Any language compatible with the project; TypeScript + Python + Rust accepted (2026-10-27) |
| C-07 | First user becomes Owner | Kept; instance locked in setup mode until the Owner finishes setup (2026-10-27) |
| C-10 | Assumption engine | No built-in AI; cited values or documented educated guesses; all variables editable in Project Preferences (2026-10-27) |
| ADR-0002 | Licence | AGPL-3.0-or-later (2026-10-27) |

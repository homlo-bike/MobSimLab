# ADR-0035: AI agents connect from outside through an MCP server; MobSimLab supplies deterministic scenario, benchmark and walk-coverage tools

- Status: Proposed (design for product owner review, 2026-11-01)
- Date: 2026-11-01
- Deciders: product owner, architecture
- Related: FR-PLAT-05, FR-PLAT-06, FR-ASM-01..05, FR-DEM-03, FR-NET-01, C-10, ADR-0012 (audit), ADR-0013 (scenario overlays), ADR-0014 (results storage), ADR-0015 (OIDC), ADR-0017 (outbound gateway), ADR-0018 (no built-in AI), ADR-0020 (day types), ADR-0023 (job queue), ADR-0027 (collaboration), ADR-0031 (street routing), ADR-0032 (railway operations), ADR-0034 (journey time planner, in progress), [06 §9.3](../architecture/06-gis.md), [09 §2.2](../architecture/09-planning-models.md)

## Context

The product owner asked (2026-11-01) for a way to connect MobSimLab to AI, for example Claude, so that users can have **agents create, optimise and benchmark scenarios** for transport services, **measure the distance between stops or stations**, and **check whether a 15-minute walk rule is met**. Industry standards are to be used throughout.

Forces:

1. **ADR-0018 still holds.** There is no built-in AI. Results must be reproducible and every value cited, documented or a labelled educated guess. An agent is a *user of the simulator*, not part of it. Its reasoning is never an input to a result; only the scenario it builds is.
2. **Users already have agents.** Claude (claude.ai, Claude Desktop, Claude Code, the Claude API and Agent SDK) and other clients speak the **Model Context Protocol (MCP)**, an open protocol for exposing tools, resources and prompts to AI applications. Building an MCP server once makes MobSimLab usable from all of them, with the user's own subscription or API key. MobSimLab never holds a model key and never calls a model.
3. **Agents are fast and careless.** They will try hundreds of variants and can be steered by text they read (prompt injection). They must work only inside scenarios, within the user's permissions, with budgets, and leave an audit trail.
4. **The analyses must be useful without AI.** Stop spacing and walk coverage are standard planning checks. They belong in the product (map layers, reports), and the agent tools are thin wrappers over the same services.
5. **"The 15-minute rule" has several meanings** in practice, and each has a published method:

| Meaning | Established method | Reference |
|---------|--------------------|-----------|
| Everyone lives within an X-minute walk of a stop | Network walk catchment (isochrone) on the pedestrian graph, population covered | TCQSM 3rd ed. (TCRP Report 165, 2013), ch. 3 and 5 (service coverage); already used for `mode.catchment_m` |
| Access to public transport as a UN indicator | **SDG indicator 11.2.1**: share of population within 500 m walking distance of a low-capacity stop (bus, tram) or 1000 m of a high-capacity one (rail, metro, ferry), on the street network | UN-Habitat, SDG 11.2.1 metadata and *Global Urban Indicators* guidance |
| Access weighted by service level | **PTAL** (Public Transport Accessibility Level): walk time to stops (default 8 min to bus, 12 min to rail at 80 m/min) plus half the headway, summed as equivalent doorstep frequency | Transport for London, *Assessing transport connectivity in London* (PTAL methodology), 2015 |
| Frequent service only | "People near frequent transit": as above, counting only stops with a headway ≤ 15 min (or a set value) in the period | ITDP, *People Near Frequent Transit* metric; TCQSM service frequency LOS |
| Daily needs within 15 minutes (the "15-minute city") | Cumulative-opportunity accessibility: number of destinations by category reachable within 15 min walk (or cycle, or walk + transit) | Moreno et al., "Introducing the 15-Minute City", *Smart Cities* 4(1), 2021; Geurs & van Wee, *J. Transport Geography* 12(2), 2004 |
| Stop spacing | Distance between consecutive stops along the route, compared with mode guidance | TCQSM 3rd ed. (stop spacing and its trade-off with walk access); assumption library entries |

## Decision

### 1. One MCP server inside the API, no model inside MobSimLab

- A new NestJS module **`agents`** serves an MCP endpoint at **`/mcp`** using the **Streamable HTTP** transport of the current MCP specification (revision 2025-11-25 at the time of writing; the server negotiates the protocol version with each client). It runs in the existing `mobsimlab` container; no new service (ADR-0003).
- Every MCP tool is a **thin adapter over an existing module's service interface** (03 §4): the same validation (Zod / JSON Schema 2020-12), the same permission checks, the same rate limits, the same audit events. There is no logic that only agents can reach. Tool input and output schemas are generated from the same JSON Schemas as the OpenAPI 3.1 contract, so REST, UI and MCP cannot drift.
- MobSimLab is **inbound only** for AI: it does not call any model, store any model key or send project data to an AI provider. Data leaves the instance only because the user's own agent asks for it with the user's own credentials. The outbound gateway (ADR-0017) is unchanged.
- For clients that only speak stdio, we publish a small **`@mobsimlab/mcp-bridge`** CLI that forwards stdio to the remote endpoint with the user's token. It contains no tools of its own.
- Users can still drive the same features without MCP through the REST API (OpenAPI 3.1), for scripts and CI.

### 2. Authorization: OAuth 2.1 as the MCP spec requires, capped by the user's role

- `/mcp` is an **OAuth 2.1 protected resource**. It publishes **Protected Resource Metadata (RFC 9728)** and answers unauthenticated calls with `401` and a `WWW-Authenticate` header pointing at it, as the MCP authorization spec requires.
- MobSimLab runs a small **authorization server** in the `auth` module (metadata per **RFC 8414**, **PKCE (RFC 7636)** mandatory, **resource indicators (RFC 8707)** so tokens are bound to this instance's `/mcp`). Login is delegated to the instance's OIDC provider (ADR-0015), so there is still only one place where people sign in. We do not ask the OIDC provider to issue tokens to agents, because most providers do not support the dynamic client registration MCP clients use.
- **Client registration:** Client ID Metadata Documents where the client supports them, else **Dynamic Client Registration (RFC 7591)**, which an Admin can switch off in instance settings (then only pre-registered clients work).
- **Consent screen** shows the client name, the projects and the scopes. Scopes:

| Scope | Allows |
|-------|--------|
| `project:read` | Read network, lines, stops, timetables, assumptions, KPIs and run results of the chosen projects |
| `analysis:run` | Run analyses (stop spacing, catchments, coverage, accessibility). Read-only on project data |
| `scenario:write` | Create agent scenarios and edit them. Never the base network |
| `simulation:run` | Start, cancel and read simulation runs and experiments on scenarios, within the agent budget |

  The effective permission is always **the intersection** of the token's scopes and the user's current project role (05). An agent can never do more than its user, and if the user loses a role the token loses it immediately.
- Access tokens live 1 hour, refresh tokens rotate and expire after 30 days of non-use; both are revocable on a **Connected agents** page in the user's settings, which lists each client, its scopes, last use and recent actions. Tokens are stored hashed. For headless use (CI) a user can create a **personal access token** with the same scopes and an expiry date.

### 3. Agents work in scenarios only, and people promote

- An agent can create scenarios (ADR-0013 overlays) in projects where its user may edit. Every scenario it creates carries `origin = agent` and the client's name, and shows an "Agent" badge in the scenario list and history.
- An agent **cannot** edit the base network, promote a scenario to base, delete a scenario it did not create, change project sharing, users, providers or instance settings. Promotion stays a human action in the UI (ADR-0013, ADR-0027).
- Edits go through the **same command model** as the editors (add, move or remove a stop; change a route circuit per ADR-0029; set the frequency or headway per service period and day type; change vehicle type or fleet; add a rail line from stations per ADR-0032). A batch of commands is applied atomically and returns the validation results (the same checks the UI shows), so the agent sees what a planner would see.
- **Assumption overrides** by an agent use the normal audited override path (ADR-0018) with a required rationale, are scoped to the agent's scenario, and are listed as "agent override" in the assumptions report. An agent cannot add values to the assumption library.
- Every tool call that changes something writes an audit event (ADR-0012) with `actor = user`, `via = agent client`, the tool name and a hash of the arguments. Read calls are logged at INFO, not audited.

### 4. Tools, resources and prompts

The first set of tools (names are stable API; each declares MCP tool annotations such as `readOnlyHint`, `destructiveHint` and `idempotentHint`):

| Group | Tools | Notes |
|-------|-------|-------|
| Discover | `list_projects`, `get_project`, `list_scenarios`, `get_network_summary`, `list_lines`, `get_line`, `list_stops`, `search_places` | `search_places` searches the project's own OSM import, not the internet |
| Scenarios | `create_scenario` (from base or a parent scenario), `apply_changes` (command batch), `validate_scenario`, `diff_scenarios`, `delete_agent_scenario` | `delete_agent_scenario` only for scenarios the same client created |
| Analysis | `measure_stop_spacing`, `walk_catchment`, `coverage_report`, `find_coverage_gaps`, `suggest_stop_locations`, `accessibility_to_destinations`, `plan_journey` | §5 and §6; `plan_journey` wraps the journey time planner (ADR-0034) |
| Simulation and benchmark | `start_run`, `get_run_status`, `cancel_run`, `get_kpis`, `create_experiment`, `run_sweep`, `compare_results` | §7; long runs return a job id at once and report progress with MCP progress notifications |
| Export | `export_gtfs`, `export_report` | GTFS Schedule zip validated by the MobilityData GTFS Validator; report as PDF/HTML from the existing report service |

**Resources** (read-only, addressable by URI, so the agent can cite them): the KPI catalogue (§7), the assumption library with sources, the project's assumptions report, the JSON Schemas of the command model, and the result manifests of runs (ADR-0014). Map geometries are returned as **GeoJSON (RFC 7946)**, large tables as links to Parquet files the user can also download, never as megabytes of text in the conversation.

**Prompts** (MCP prompt templates the user can pick in their client): "Benchmark these scenarios", "Check walk coverage and stop spacing", "Find the cheapest change that reaches a coverage target". They describe a workflow with the tools; they add no hidden behaviour.

### 5. Stop and station spacing (deterministic, also in the UI)

`measure_stop_spacing(scenario, line?, mode?)` and a map layer in the line editor:

- **Along-route spacing** per route pattern and direction: the distance between consecutive stops measured on the route geometry (chainage of the stop's projection onto the route), which is what the vehicle drives. For rail, between the platform stopping points of ADR-0032 §1.
- **Walking distance between neighbouring stops** on the pedestrian graph, which shows overlapping catchments (two stops 250 m apart along the route can be 600 m apart on foot across a river).
- Per line and per mode: count, mean, median, 10th/90th percentile, min, max and a histogram; segments below or above the guidance range are flagged on the map.
- The guidance range comes from a new assumption-library entry **`mode.stop_spacing_m`** (low / central / high per mode, cited, TCQSM 3rd ed. as the first source, with UITP and national guidance added where the project's country has them). It appears in Project Preferences like every variable (FR-ASM-05). No spacing value is hard-coded.

### 6. Walk catchments and the 15-minute rule (deterministic, also in the UI)

- **Network, not crow-flies.** Catchments are computed on the walk edges of the unified graph (06 §6: footways, sidewalks, crossings, steps, pedestrian zones), never as circular buffers. A circular buffer is reported only as a comparison figure, because many published plans still use it.
- **Engine.** One **multi-source Dijkstra** from every stop (or every platform entrance) over the walk graph gives each node its walk time to the nearest stop. It is added to the `street-routing` crate (ADR-0031) as a walk profile, so the worker computes reports and the browser (WebAssembly) draws live isochrones while a planner drags a stop. Cost per edge is length ÷ `demand.walk_speed_kmh`, plus a delay per signalised crossing and a gradient factor (both new library entries, cited), and steps are excluded for the step-free variant (FR-DEM-03 accessibility penalty).
- **Population.** Population comes from the project's population layer (WorldPop or GHSL, 06) disaggregated to buildings where they exist, else to H3 cells at the resolution the demand model uses (09 §2.1). Coverage is the population of covered cells or buildings; the share is against the study area's total.
- **Rules are presets, the minutes are variables.** `coverage_report(scenario, preset, period, day_type)` with presets:

| Preset | Rule | Default |
|--------|------|---------|
| `walk_minutes` | Walk time to the nearest stop ≤ X min | X = **15** (new entry `analysis.walk_rule_minutes`, editable); about 1.1 km at the central 4.5 km/h |
| `sdg_11_2_1` | 500 m to low-capacity, 1000 m to high-capacity stops, network distance | UN-Habitat definition, fixed so results are comparable between cities |
| `catchment_by_mode` | Mode catchment from `mode.catchment_m` | Matches the demand model's access links |
| `frequent_only` | As `walk_minutes`, counting only stops with headway ≤ H in the period | H = 15 min (`analysis.frequent_headway_min`) |
| `ptal` | TfL PTAL index and bands 0 to 6b per cell | TfL 2015 parameters, with the walk speed and access times taken from TfL's method rather than the project's |
| `fifteen_minute_city` | Count of destinations per category (food shop, primary school, GP or clinic, pharmacy, park, workplace) reachable within X min by walk, cycle, or walk + transit | Categories from OSM tags (list versioned in the library), X = 15 |

  Every report states the preset, the parameters and their basis, so "15-minute coverage: 82 %" is never shown without "walk, 4.5 km/h, network distance, all stops, weekday AM peak".
- **Walk + transit door to door.** "Within 15 minutes by walk and public transport" uses the journey time planner (ADR-0034, `crates/journey-planner`, RAPTOR over the scenario's timetable), not a separate router. It needs a **one-to-many** variant of the planner (every stop and cell reachable from an origin within a time budget), which the RAPTOR rounds already compute internally. Origins are sampled on the H3 grid and evaluated with the planner's `profile` query over the period's departure-time window; the reported value is the median over the window, as in standard accessibility analysis, so a single lucky departure does not count. Access and egress walks come from the walk-graph Dijkstra above, replacing the planner's current straight-line × detour-factor estimate once the walk graph exists.
- **Gaps and candidate stops.** `find_coverage_gaps` returns uncovered populated areas as GeoJSON polygons with their population. `suggest_stop_locations(k, line?)` solves the **Maximal Covering Location Problem** (Church & ReVelle, *Papers of the Regional Science Association* 32, 1974) on candidate points along existing routes (or along streets the mode may use, per ADR-0029), with a minimum spacing from `mode.stop_spacing_m`. It is solved with a greedy start and an exact MIP (HiGHS, MIT licence) under a time limit, and returns the population gained per added stop. It is a deterministic optimiser, not AI.

### 7. Benchmarking and optimisation

- **KPI catalogue.** A versioned YAML catalogue, reviewed like the assumption library, defines every KPI: id, name, unit, formula, aggregation over periods and day types (ADR-0020), direction (higher or lower is better) and source. The first entries follow established definitions: TCQSM quality-of-service measures (frequency, hours of service, service coverage, passenger load, reliability), **EN 13816** service-quality criteria for availability and time, UIC 406 capacity consumption for rail (ADR-0032), vehicle-km, vehicle-hours and peak vehicles, fleet including reserve, average journey time, wait, walk and transfers from the passenger engine, load factor, punctuality, CO₂e, OPEX, CAPEX, and the appraisal results of 09 §3. Agents and the UI read the same catalogue, so a benchmark means the same thing in both.
- **Experiments.** `create_experiment(scenarios[], day_types[], seeds[], kpis[])` stores a benchmark definition; running it fans out the runs through pg-boss (ADR-0023) and `compare_results` returns one table: KPI × scenario with the mean and the spread across seeds, and a flag when the difference between two scenarios is smaller than that spread. Runs are deterministic for a given input hash and seed, so the same experiment gives the same numbers tomorrow; an unchanged scenario is not run twice (results are reused by input hash).
- **Sweeps.** `run_sweep(scenario, parameters, design)` varies chosen variables (headways per period, fleet size, stop set, dwell, vehicle type) over a grid or a **Latin hypercube** design, in the worker, without one agent round trip per variant. Results come back as a Pareto front over the chosen KPIs (for example coverage against OPEX). The agent proposes structural changes (a new line, a re-routing); the sweep tunes numbers. That split keeps agents cheap and results explainable.
- **Budgets.** Each token has a run budget (simulated vehicle-hours and worker-minutes per day, set by an Admin, default modest) and a limit on concurrent runs; the normal per-user run limits (05) apply too. When the budget is spent the tools return a clear error with the reset time, never a silent queue.

### 8. Security

- The agent connection is added to the threat model (docs/security/threat-model.md) as a new actor and trust boundary.
- **Prompt injection.** Text that people typed into a project (names, comments, descriptions) is returned in clearly marked fields as data. No tool fetches arbitrary URLs, runs code, sends email or reaches beyond the projects the token was granted, so injected text has nothing dangerous to call. No tool can change permissions or sharing.
- **Least privilege** by scopes and role intersection (§2), project selection at consent, and the agent-only write area (§3).
- **Resource limits:** response size caps with pagination, run budgets, the existing rate limiter (05) keyed by token as well as by user.
- **Accountability:** audit events for every change (§3), the Connected agents page, and revocation that takes effect on the next call.

### 9. Delivery in phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| A | MCP endpoint, OAuth 2.1 and consent, read tools, resources; `measure_stop_spacing`, `walk_catchment`, `coverage_report` (walk, SDG 11.2.1, by mode) | Phase 1 auth (done), walk graph build, population layer |
| B | Agent scenarios, `apply_changes`, `validate_scenario`, `diff_scenarios`; Connected agents page | Scenario overlays, editor command model |
| C | Runs, KPI catalogue, experiments and `compare_results`; `frequent_only`, `ptal` | Simulation, timetables (ADR-0032) |
| D | Sweeps, `find_coverage_gaps`, `suggest_stop_locations`, `fifteen_minute_city`, `plan_journey`, prompts, stdio bridge | Journey planner (ADR-0034), demand model |

The coverage and spacing analyses ship as map layers and reports in the same phases, so planners without an agent get them too.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Built-in chat with Claude through the outbound gateway, using an instance-wide API key | Contradicts ADR-0018; the instance would send project data to a model provider and pay for it; results would depend on model output. Can be revisited by the product owner as an optional add-on later, and would then reuse these same tools |
| REST API only, let each user write their own agent glue | Works for scripts (and stays available), but every agent client would need custom setup and tool descriptions; MCP is the open standard the major AI clients support |
| A separate MCP service or container calling the REST API | A third container (ADR-0003) and a second place for permissions and audit; an in-process module reuses both |
| Delegate token issuing for agents to the OIDC provider | Most providers lack dynamic client registration and audience-bound tokens for third-party MCP clients; a small authorization server in front of OIDC works with every provider |
| Agents edit the base network directly | One bad prompt changes everyone's base; scenarios plus human promotion make every agent change reviewable and reversible |
| Circular buffers for catchments | Overstate coverage across rivers, rail lines and motorways; network distance is the SDG 11.2.1 and TCQSM practice |
| Agents call `start_run` hundreds of times to optimise numbers | Slow, costly in tokens, hard to reproduce; in-worker sweeps with a documented design do the same deterministically |
| A built-in genetic or black-box optimiser for whole networks | Out of scope for now; structural design stays with the planner or the planner's agent, numeric tuning with sweeps and MCLP |

## Consequences

- Users can point Claude (or any MCP client) at `https://<instance>/mcp`, sign in once, pick projects and scopes, and ask it to build and compare scenarios. MobSimLab stays model-free and its results stay reproducible.
- Stop spacing and 15-minute walk coverage become standard reports and map layers for everyone, with the rule, the parameters and their sources printed next to every number.
- New work: the `agents` module, the authorization server and consent UI, the walk profile and multi-source Dijkstra in `street-routing`, the KPI catalogue, experiments and sweeps in the worker, the MCLP solver (HiGHS added to the licence gate), and the threat-model update.
- New assumption-library entries, each cited or documented: `mode.stop_spacing_m`, `analysis.walk_rule_minutes`, `analysis.frequent_headway_min`, `walk.crossing_delay_s`, `walk.gradient_factor`, and the destination category list for the 15-minute city preset.
- The MCP tool names and schemas become a public contract; changes follow the same versioning and deprecation rules as the REST API.
- MCP is young and its authorization part has changed between revisions. The adapter is kept thin and tested against the official MCP conformance tooling and Claude's connector, so a spec revision means updating one module.

## Questions for the product owner

1. Which reading of "the 15-minute rule" should be the headline number on reports: **15-minute walk to any stop** (proposed default), SDG 11.2.1, or the 15-minute city (daily needs)? All presets will be available either way.
2. Should agents be allowed for users with the Viewer role (read and analyse only), or only for Editors and above?
3. Is an optional in-app chat (with an API key the Owner provides) something you want later? It would need a change to ADR-0018, so this ADR does not include it.

# 04 — Domain model, data model and database architecture

ER diagrams and the UML class diagram for this chapter are in [11-diagrams.md](11-diagrams.md#2-uml-class-diagrams).

## 1. Domain model

The domain splits into bounded contexts. Each maps to one or more backend modules and one database schema.

| Context | Key aggregates | Notes |
|---------|----------------|-------|
| Identity & Access | User, Group, RoleAssignment, ProjectMembership | Instance roles vs project roles |
| Project | Project, Scenario, Preferences, Comment | A project owns everything below |
| Provenance | Source, Assumption, AssumptionLibraryEntry, AuditRecord | Cross-cutting, referenced by every asset |
| Geodata | OsmFeature, ImportJob, PopulationGrid, DemTile, Zone, Layer | Imported reference data, read-only to users |
| Network | GraphNode, GraphEdge, TrackSegment, Alignment, Signal, Switch, Barrier | The unified graph and its engineering detail |
| Stations | Station, StationGroup, Platform, Access (stair, lift, ramp), Stop | Stops = bus/tram stops; stations contain platforms |
| Service | Line, Route, Pattern, PatternStop, ServicePeriod, Calendar | GTFS-compatible concepts |
| Fleet | VehicleType, Vehicle, Depot, DepotZone, DepotSlot, DepotTrack | VehicleType comes from catalogue or project |
| Timetable | Timetable, Trip, StopTime, Block, RunningTimeProfile | Generated, then user-editable |
| Simulation | SimulationRun, DayType, Disruption, RunEvent, KPI | Run outputs are immutable |
| Demand | DemandModel, Zone, Matrix, ModeChoiceModel, AssignmentResult | |
| Costing | CostModel, CostItem, AppraisalResult, Externality, McaCriterion | |
| Schematics | Diagram, DiagramNode, DiagramEdge, DiagramLayer | Derived from network, then edited |

### Core invariants

1. Every persistent asset belongs to exactly one project and is visible only through that project's permissions.
2. A scenario never changes base rows; it stores overlay rows (ADR-0013).
3. A `Vehicle` is always at a defined place: a depot slot/track, or a network position recorded at simulation start. It cannot be created by a simulation.
4. A `SimulationRun` is immutable after completion. Changing inputs means a new run.
5. Any numeric input may be a plain value or an `AssumedValue`; calculations accept both.
6. Every `Source` has a licence; data with an unknown licence cannot be bundled or exported publicly.
7. All lengths in metres, times in seconds, speeds in m/s, mass in kg, money in minor units with ISO 4217 currency and price-base year.

## 2. Data model conventions

### 2.1 Global identifier

- **UUIDv7** for every persistent object (ADR-0011). Time-ordered, so it indexes well, and globally unique across instances so project files can be merged and moved without ID clashes.
- External IDs (OSM `node/123`, GTFS `stop_id`) stored separately in `external_refs` with their namespace.

### 2.2 Metadata envelope

Every asset table includes these columns (via a shared SQL template applied by migrations):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | UUIDv7 |
| `project_id` | `uuid` FK | Owning project (null for instance-level objects) |
| `scenario_id` | `uuid` null | Null = base; set = overlay row (ADR-0013) |
| `name` | `text` | |
| `description` | `text` | |
| `tags` | `text[]` | GIN index |
| `custom` | `jsonb` | Custom fields, validated against project's custom field schema |
| `source_ids` | `uuid[]` | Links to `provenance.source` |
| `created_at`, `updated_at` | `timestamptz` | Set by DB trigger, not by clients |
| `created_by`, `modified_by` | `uuid` | Set from session context (`SET LOCAL mobsimlab.user_id`) by trigger |
| `version` | `int` | Optimistic locking; incremented by trigger |
| `deleted_at` | `timestamptz` null | Soft delete for persistent assets; hard purge is an explicit admin action |

Comments are a separate table (`collab.comment`) referencing `(object_type, object_id)`, so threads and mentions work across all objects.

### 2.3 Assumed values

Numeric fields that may be assumed are stored as `jsonb` with a JSON Schema:

```json
{
  "value": 22.5,
  "unit": "s",
  "assumed": true,
  "low": 15, "central": 22.5, "high": 35,
  "distribution": "triangular",
  "sensitivity": { "metric": "annual_opex", "elasticity": 0.41, "rank": 3 },
  "assumptionId": "0190f…",
  "sourceId": "0190e…",
  "rationale": "Dwell time default for 3-door articulated bus, TCQSM 3rd ed. ch. 6",
  "overriddenBy": null
}
```

Frequently queried values (vehicle length, capacity) are also projected into typed columns by a generated column for indexing.

## 3. Database architecture

### 3.1 Schemas

| Schema | Owner module | Content |
|--------|--------------|---------|
| `iam` | iam/auth | users, identities, groups, role assignments, sessions |
| `project` | projects | projects, scenarios, memberships, preferences |
| `provenance` | sources/assumptions | sources, assumption library, assumption instances |
| `audit` | audit | `audit.record` (partitioned by month), chain heads |
| `logs` | logging | `logs.entry` (partitioned by day, WARN+) |
| `provider` | providers/gateway | provider configs, encrypted credentials, health, HTTP cache index |
| `geo` | gis | OSM features (by class), population rasters, DEM rasters, zones, import jobs |
| `net` | network/stations | graph nodes/edges, track segments, alignments, signals, switches, stations, platforms, stops |
| `svc` | transit/timetables | lines, routes, patterns, calendars, timetables, trips, stop times, blocks |
| `fleet` | vehicles/depots | vehicle types, vehicles, depots, zones, slots, depot tracks |
| `sim` | simulation | runs, day types, disruptions, KPI aggregates, event summaries, result file index |
| `demand` | demand | models, zones, matrices metadata, results |
| `cost` | costing | cost models, items, appraisal results |
| `schem` | schematics | diagrams and elements |
| `jobs` | pg-boss | job queue tables |

### 3.2 Spatial data

- Geometry in **EPSG:4326** for storage and exchange; each project has a **working projected CRS** (auto-selected UTM zone, overridable) and engineering geometry (alignments, depots, platforms) is stored in that CRS as well (`geom_local`), because radius, length and clearance checks must be done in metres. Transformations through PostGIS `ST_Transform`.
- Elevation stored as `z` on alignment vertices (PostGIS `LINESTRINGZ`) and as measured profiles (`LINESTRINGZM`, M = chainage).
- Indexes: GiST on all geometry; BRIN on time columns of large tables; GIN on `tags` and selected `jsonb` paths.
- Vector tiles: served by the API with `ST_AsMVT` from per-layer SQL functions, cached by `(layer, z, x, y, dataVersion)`.
- Rasters (population, DEM): `postgis_raster` with out-db storage is **not** used (path traversal risk and backup complexity); rasters are tiled in-db at 256×256 per project area.

### 3.3 Row-level security (defence in depth)

All project-scoped tables have RLS enabled. The API sets `SET LOCAL mobsimlab.user_id` and `mobsimlab.project_ids` per transaction. RLS policies check membership/visibility. The application also checks permissions (primary control); RLS stops a missed check from leaking data across projects. The worker role sees only rows for the run's project, via a `SET LOCAL mobsimlab.run_id` policy.

### 3.4 Audit storage

`audit.record(id, at, actor_id, actor_ip_hash, action, object_type, object_id, project_id, before jsonb, after jsonb, reason, request_id, prev_hash, hash)`

- Written by row triggers on all asset tables, in the same transaction as the change.
- `hash = sha256(prev_hash || canonical_json(record))` per project chain; instance chain for admin actions. A nightly job verifies chains and reports breaks as CRITICAL.
- `mobsimlab_app` has `SELECT` only and appends through the `audit.append()` function, which owns the chain-head lock and the hash; it has no `INSERT`, `UPDATE` or `DELETE` on audit tables. `audit.verify(chain)` returns the first broken record. Client IPs are stored only as a keyed hash. Retention and purge by the migrator role through a documented admin procedure, itself audited.

### 3.5 Simulation results

Results are big. One day of 1,000 vehicles at 1 Hz is 86 million position samples. They are **not** stored as rows (ADR-0014):

- Trajectories and events → Arrow IPC / Parquet files under `/data/projects/<projectId>/runs/<runId>/`, zstd-compressed, with a manifest and SHA-256 per file.
- KPIs and summaries (per trip, per stop, per line, per hour) → PostgreSQL tables in `sim`, partitioned by run.
- Playback streams frames from the Parquet files through the API at the requested speed and viewport.

### 3.6 Scenario overlays (ADR-0013)

- Base rows have `scenario_id IS NULL`.
- A scenario change inserts an overlay row with the same logical `id`, `scenario_id = S`, and an `op` of `upsert` or `delete`.
- Reads use a view per table: `base rows LEFT ANTI JOIN overlay deletes UNION overlay upserts` for the active scenario. Indexes include `(id, scenario_id)`.
- "Promote scenario to base" is an explicit, audited operation.

### 3.7 Migrations and data lifecycle

- SQL migrations, forward-only, reviewed. Each migration runs in a transaction with a lock timeout.
- Partition maintenance (logs daily, audit monthly) by a scheduled pg-boss job.
- `VACUUM`/autovacuum tuned for high-churn job tables; job table archived after 7 days.
- Final review phase includes an "unused table" check: any table with no reads in the code search and no rows in demo data is flagged.

### 3.8 Capacity estimate (reference project: city of 1 M inhabitants)

| Data | Size |
|------|------|
| OSM features (all classes) | 2–5 GB in PostGIS with indexes |
| Population + DEM rasters | 0.2–1 GB |
| Network, service, timetable | < 500 MB |
| One run (day, 2,000 vehicles, trajectories at 1 Hz) | 1–3 GB Parquet |
| Audit (1 year, 20 active users) | 1–5 GB |

Operators should plan 50–200 GB of disk for an active instance.

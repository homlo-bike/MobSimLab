# 10 — Collaboration and project storage

## 1. Collaboration architecture (ADR-0027)

### 1.1 Sharing model

| Visibility | Who can see | Who can edit |
|------------|-------------|--------------|
| Private | Project members only | Members with Editor/Owner role |
| Shared | Named users and IdP groups with a project role | Editors/Owners |
| Public | Everyone on the instance; anonymous visitors too if the admin enables public anonymous access | Editors/Owners only |

Public projects that contain OSM-derived data show the ODbL notice (C-12). Making a project public is an audited action and shows a licence check (are all included datasets allowed to be shared publicly?).

### 1.2 Concurrent editing

v1 does **not** use real-time co-editing of the same object (CRDT/OT). Reasons: geometry edits on a network graph have strong invariants (connectivity, switch legs, platform edges) that CRDT merges can silently break; most planning teams work on different scenarios or areas.

Instead:

- **Optimistic locking:** every write carries the object's `version`. Conflicts return HTTP 409 with the current object; the UI shows a merge dialog (keep mine / keep theirs / field-by-field).
- **Presence:** the WebSocket shows who is in the project, which scenario, and which object they have selected (coloured outlines on the map).
- **Soft locks:** selecting an object for editing shows "being edited by X" to others (advisory, expires after 2 min idle).
- **Change feed:** committed changes are broadcast to all viewers of the project/scenario so maps update live.
- **Scenarios as branches:** each team member can work in their own scenario; differences are shown as a diff layer and list; changes can be cherry-picked into another scenario or promoted to base.
- **Comments and mentions:** threads on any object or map location; mentions notify (in-app; e-mail optional via SMTP config).

### 1.3 Change history

Because every write is audited (04 §3.4), each object has a full history view and **undo** for the user's own recent changes (implemented as compensating writes, also audited). Project-level "restore to point in time" creates a new scenario from the audit log state at that time.

## 2. Project storage architecture

### 2.1 Where data lives

| Data | Store |
|------|-------|
| Project metadata, network, service, fleet, scenarios, assumptions, sources | PostgreSQL |
| Imported reference data (OSM, rasters) | PostgreSQL (`geo`), shared per project area hash to avoid duplication across projects of the same area |
| Uploaded originals (GTFS zip, GeoTIFF, CSV) | `/data/projects/<projectId>/uploads/` with SHA-256 name, metadata in DB |
| Custom vehicles | DB (`fleet.vehicle_type`, origin=project) + included in export |
| Run outputs | `/data/projects/<projectId>/runs/<runId>/` (Parquet/Arrow + manifest) |
| Caches (HTTP, tiles) | `/data/cache/` — disposable |
| Logs | `/data/logs/` + DB (WARN+) |

### 2.2 Project file format `.mslab` (ADR-0021)

A ZIP container, versioned, readable with standard tools:

```text
project.mslab
├── manifest.json            format version, app version, project id, created, checksums, licences summary
├── project.json             project metadata, preferences, custom field schemas
├── scenarios/<id>.json      scenario metadata
├── data/<entity>.ndjson     one JSON object per line per entity type (nodes, edges, stations, lines, …)
│                            geometry as GeoJSON in EPSG:4326 + local CRS definition
├── vehicles/<mode>/*.json   custom vehicle types (same schema as catalogue)
├── assumptions.json         assumption instances + overrides
├── sources.json             source registry entries used by this project
├── attachments/             user uploads (optional, user chooses)
├── runs/<runId>/            optional: run results (large)
├── ATTRIBUTION.md           generated: all sources and licences contained
└── signatures/ (optional)   detached signature for integrity
```

- JSON Schemas for every file are published, so other tools can read and write `.mslab`.
- **Import** validates schemas, checks checksums, applies forward migrations (`format 1.x → current`), remaps IDs only on conflict (UUIDv7 makes conflicts rare), and runs in the sandboxed tool-runner with zip-bomb limits.
- Reference data (OSM, rasters) is **not** included by default (size, and it can be re-imported); the manifest records what was used (source, timestamp, bbox) so it can be rebuilt. Optional "full export" includes it.

### 2.3 Other import/export formats

| Format | Import | Export |
|--------|--------|--------|
| GTFS (schedule) | Yes (validated with MobilityData validator) | Yes (validated before download) |
| GTFS-Flex / GTFS-Realtime | No (v1) | No |
| GBFS | Read via provider | — |
| GeoJSON / GeoPackage | Layers, zones, alignments | Any layer |
| SUMO network/routes | — | Yes (for expert users) |
| RailJSON (OSRD-style) | Planned (S) | Yes (for validation against OSRD) |
| OC4IDS | Cost/project data | Project cost data |
| OMX | Demand matrices | Demand matrices |
| CSV / XLSX | Tables (stops, costs) | Tables, timetables, appraisal |
| SVG / PDF / PNG | — | Maps, schematics, reports |
| NeTEx | — | Candidate for later |

### 2.4 Quotas and retention

Per-project quotas (storage, number of runs kept) configurable by admins. Old runs can be archived (KPIs kept, trajectories deleted) — an explicit, audited action, never automatic unless the admin sets a retention policy.

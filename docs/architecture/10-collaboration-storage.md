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

**Drawings (v1).** Until the network is stored object by object, what the editors draw is saved as one JSON document per project and kind in `project.drawing` (migration 0005): `street-lines`, `railway` and `street-setups` (GIS tab). `GET /api/projects/:id/drawings` returns them all; `PUT /api/projects/:id/drawings/:kind` with `{ doc, baseVersion }` replaces one and returns the new `version`, or 409 with the current drawing when `baseVersion` is stale. The web app saves 0.8 s after the last change, one save per kind at a time, retries lost connections with back-off, and on 409 shows a banner to keep one's own drawing or take the other one. Owners and Editors write; everyone who can read the project reads. The API checks each kind's outline (apps/api/src/projects/drawings.ts) and a size limit of 8 MB; saves are audited as `project.drawing_saved` with versions and size but not the document. Duplicating a project copies its drawings. A new editor adds a kind there and in `apps/web/src/projects/drawings.ts`.

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
├── manifest.json            format version, app version, project id and name, date, what is included,
│                            SHA-256 and size of every other file
├── project.json             name, description, area, modes
├── plugins.json             plugins switched on or off for the project (bundled, or installed with a version)
├── data/<kind>.json         one saved drawing per tool (railway, street-lines, depots, preferences, scenarios, …):
│                            kind, schema version, document as the tool saves it (geometry in EPSG:4326)
├── runs/<runId>/            optional: finished simulation runs (run.json, network.txt, lines.txt,
│                            replay.json.gz for road runs)
└── ATTRIBUTION.md           generated: contents and the sources the project refers to
```

Format 1.0.0 (2026-11-16) has no custom vehicles, attachments, sources registry or signatures yet, because
projects cannot hold them; they come as a later minor version (`vehicles/<mode>/*.json`, `attachments/`,
`sources.json`, `signatures/`).

- JSON Schemas for every file are published, so other tools can read and write `.mslab`.
- **Import** always creates a new project owned by the person who opens it, with new ids. It runs in the sandboxed tool-runner (`apps/api/src/tool-runner`) with ZIP limits (200 MB file, 5000 entries, 70 MB per file, 512 MB unpacked, compression ratio), checks the checksums and every file against its schema, and applies forward migrations (`apps/api/src/mslab/migrations.mts`); the API then checks every drawing again against the editor's outline. Drawings of tools or plugins this instance lacks are left out and listed.
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

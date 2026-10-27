# Architecture Decision Records

ADRs are **Proposed** until the architecture pull request is approved, except those already decided by the product owner. Template: [0000-template.md](0000-template.md).

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Proposed |
| [0002](0002-license-agpl.md) | Licence MobSimLab under AGPL-3.0-or-later | Accepted |
| [0003](0003-deployment-topology.md) | Exactly two containers; simulation runs as supervised processes inside `mobsimlab` | Accepted |
| [0004](0004-polyglot-runtime.md) | NestJS for the API, Python for the simulation worker, Rust for compute kernels | Accepted |
| [0005](0005-sumo-road-engine.md) | Eclipse SUMO via libsumo is the road traffic engine | Proposed |
| [0006](0006-rail-operations-kernel.md) | Custom rail operations kernel in Rust, with OSRD as reference and validation oracle | Proposed |
| [0007](0007-co-simulation.md) | Lock-step co-simulation between SUMO and the rail kernel with portal handover | Proposed |
| [0008](0008-vehicle-geometry.md) | One-dimensional authoritative motion with derived multi-body geometry | Proposed |
| [0009](0009-unified-graph.md) | One unified transport graph in PostGIS, one routing library, engine-specific exports | Proposed |
| [0010](0010-osm-import-paths.md) | OSM import via Overpass for small areas and PBF extracts for large areas | Proposed |
| [0011](0011-identifiers-and-metadata.md) | UUIDv7 global identifiers and a shared metadata envelope | Proposed |
| [0012](0012-audit-trail.md) | Append-only, hash-chained audit trail separate from logs | Proposed |
| [0013](0013-scenario-overlays.md) | Scenarios as copy-on-write overlays on the base network | Proposed |
| [0014](0014-simulation-results-storage.md) | Simulation trajectories in Arrow/Parquet files, aggregates in PostgreSQL | Proposed |
| [0015](0015-oidc-first-owner-setup.md) | OIDC-only authentication; first user becomes Owner in setup mode | Accepted |
| [0016](0016-secrets-and-credential-encryption.md) | Docker secrets for instance secrets; envelope encryption for provider credentials | Proposed |
| [0017](0017-outbound-gateway.md) | All outbound HTTP through one gateway module | Proposed |
| [0018](0018-assumption-engine.md) | Deterministic assumption engine with cited or documented values; no built-in AI | Accepted |
| [0019](0019-demand-model-aequilibrae.md) | Four-step demand model built on AequilibraE | Proposed |
| [0020](0020-multi-year-day-types.md) | Multi-year simulation through representative day types and calendar expansion | Proposed |
| [0021](0021-project-file-format.md) | Versioned `.mslab` ZIP project format with JSON Schemas | Proposed |
| [0022](0022-logging.md) | Logging with Pino (frontend) and Winston (backend), DB sink WARN and above | Proposed |
| [0023](0023-job-queue-pg-boss.md) | Job queue in PostgreSQL with pg-boss | Proposed |
| [0024](0024-map-rendering.md) | MapLibre GL for the map, deck.gl for moving vehicles and heavy overlays | Proposed |
| [0025](0025-schematics-loom.md) | Generate schematic diagrams with LOOM, edit them in our SVG editor | Proposed |
| [0026](0026-vehicle-catalogue-provenance.md) | Vehicle catalogue as sourced JSON files with per-field provenance | Proposed |
| [0027](0027-collaboration-model.md) | Optimistic locking, presence and scenario branches instead of real-time co-editing | Proposed |
| [0028](0028-persistence-semantics.md) | Persistence rule applies to modelled assets; background traffic and passengers are declared demand | Proposed |

# ADR-0009: One unified transport graph in PostGIS, one routing library, engine-specific exports

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-NET-01, FR-NET-02

## Context

The brief requires one graph for all modes and no duplicate routing engines. SUMO, AequilibraE and the rail kernel each need their own network format.

## Decision

- PostGIS `net.node` / `net.edge` is the single source of truth for roads, rail tracks, walking and cycling links, with typed nodes (intersections, stations, stops, switches, platforms, depot gates).
- Rust builds mode-specific in-memory views (CSR) for routing using `petgraph`/`pathfinding` (Dijkstra, A*, Yen K-shortest).
- SUMO and AequilibraE networks are **generated exports** of the same graph; transit paths are computed by us and passed explicitly. SUMO rerouting only for background traffic.
- No pgRouting, OSRM, GraphHopper or OpenRouteService in the model.
- Spatial SQL via Kysely + raw SQL, no ORM over PostGIS.

## Alternatives considered

| Option | Why not |
|--------|---------|
| pgRouting in DB | Second routing implementation; GPL-2.0+ extension; slow for repeated simulation queries |
| Separate graphs per mode | Brief forbids; inconsistency |

## Consequences

- Exporters to SUMO/AequilibraE must be well tested (round-trip tests on reference networks).
- Graph rebuilds incremental on edits (event flow 4.1).

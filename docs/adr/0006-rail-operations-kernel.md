# ADR-0006: Custom rail operations kernel in Rust, with OSRD as reference and validation oracle

- Status: Proposed
- Date: 2026-10-27
- Related: FR-SIM-02, NFR-PERF-03, NFR-ACC-01, C-05

## Context

The brief asks for block reservation, signals, route locking, switches, interlocking, dispatching, platform assignment, timetable planning and rerouting at the scale of thousands of trains, "using concepts from" OpenTrack, Open Rails, Railway Manager and Rail Network Route Finder. OpenTrack is proprietary. Open Rails is a C# driving game. OSRD (OpenRail Association) is the closest open-source system, but it is a multi-service platform (Rust, Kotlin/JVM, message broker) that cannot be embedded in our deployment. SUMO has rail support (rail signals, bidirectional tracks) but no full interlocking/dispatching model.

## Decision

- Build a focused kernel in Rust: `rail-model`, `rail-dynamics`, `rail-interlocking`, `rail-dispatch`, `rail-sim`.
- Use established algorithms from crates (`petgraph`, `pathfinding`) rather than custom implementations.
- Align the infrastructure model with OSRD's RailJSON concepts; provide RailJSON export.
- Use OSRD as a **validation oracle** in CI (reference networks; running times within ±3 %).
- Interlocking safety invariants tested with property-based tests (`proptest`).
- Spike S2 (Phase 0) must show 2,000 trains/day at ≥ 50× real time before Phase 4 commits to the design.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Embed OSRD | Too many services; JVM core; conflicts with ADR-0003 |
| SUMO rail only | No route setting/interlocking/dispatching model; trains as road-like vehicles |
| Port Open Rails | Driving game architecture; C#; GPL-3.0 |

## Consequences

- Largest custom component; needs rail-operations domain expertise in reviews.
- Clear, testable scope; licence-clean.

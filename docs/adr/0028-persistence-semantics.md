# ADR-0028: Persistence rule applies to modelled assets; background traffic and passengers are declared demand

- Status: Proposed
- Date: 2026-10-27
- Related: FR-OBJ-03, C-04

## Context

"Nothing spawns, nothing disappears" conflicts with how traffic and passenger demand work in every simulator.

## Decision

- Persistent assets (vehicles, stations, stops, tracks, roads, signals, switches, depots, lines, infrastructure, users, projects) have global IDs, metadata and audit, and are only created/removed by explicit action. Simulation never creates or deletes them.
- Transit vehicles start and end runs in depots; no teleporting.
- Background traffic and passengers are explicit, audited demand objects; their transient agents enter and leave only at declared zones or network boundaries.

## Consequences

The rule is enforceable and testable (a run must end with the same set of persistent vehicles it started with, all at known locations).

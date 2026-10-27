# ADR-0007: Lock-step co-simulation between SUMO and the rail kernel with portal handover

- Status: Proposed
- Date: 2026-10-27
- Related: FR-SIM-03, ADR-0005, ADR-0006

## Context

Trams run both on streets (with cars, signals) and on segregated track. Level crossings link rail and road. Running a tram in only one engine either loses road interaction or rail signalling.

## Decision

- A Python **coordinator** owns the master clock and advances SUMO (fixed step) and the rail kernel (event-driven, `advance_to(t)`) in lock-step.
- **Portal nodes** mark where a vehicle moves between engines. Handover only when the receiving side's entry space is free; the vehicle waits otherwise. Position and persistent ID are preserved; no teleport.
- **Level crossings** are owned by the rail kernel; the coordinator drives SUMO signal states.
- When no interaction is pending in the next window, the rail kernel may run ahead in larger chunks.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Trams fully in SUMO | Loses interlocking on segregated sections |
| Trams fully in rail kernel, cars ignore them | Unrealistic street running and signal priority |
| HLA/FMI co-simulation standard | Heavy for two in-process engines; can wrap later |

## Consequences

- Coordinator is on the hot path; keep per-step work small (libsumo subscriptions, batched calls).
- Handover logic needs careful testing (queues at portals, failures at portals).

# ADR-0005: Eclipse SUMO via libsumo is the road traffic engine

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-SIM-01, FR-SIM-04, C-04

## Context

The brief says to use SUMO for buses, BRT, trolleybuses, congestion, signals, intersections and dwell, and not to reinvent traffic simulation.

## Decision

- Use SUMO (pinned minor version, official packages) **in-process via libsumo** from the Python worker. Fall back to TraCI (separate SUMO process) for debugging with `sumo-gui`.
- Generate SUMO networks from the unified graph (ADR-0009) with `netconvert`; never let SUMO import OSM directly in production (one graph rule).
- Give SUMO explicit routes for transit vehicles; dwell times are set by our passenger engine.
- Disable teleporting for transit vehicles (`time-to-teleport -1`); report gridlocks.
- Insert transit vehicles only at depot slots; remove only when back in depot at run end (persistence rule, ADR-0028).

## Alternatives considered

| Option | Why not |
|--------|---------|
| MATSim | Agent-based mesoscopic; Java; less detailed intersections/signals |
| Custom road model | Brief forbids; large effort |
| CityFlow, others | Less mature, smaller community |

## Consequences

- libsumo allows only one SUMO instance per process: each concurrent run needs its own worker process (fits ADR-0003).
- SUMO's 1-D vehicle model drives our geometry layer (ADR-0008).
- SUMO licence (EPL-2.0 / GPL-2.0-or-later secondary) to be re-verified at adoption and recorded.

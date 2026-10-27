# ADR-0013: Scenarios as copy-on-write overlays on the base network

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-PLAT-06, ADR-0027

## Context

Planners compare variants. Copying the whole network per scenario wastes space and makes "apply this fix to all scenarios" hard.

## Decision

Base rows have `scenario_id IS NULL`. Scenario changes are overlay rows (same logical id, `scenario_id`, op upsert/delete). Reads go through views resolving base + overlay for the active scenario. Scenarios may have a parent scenario (one level of nesting in v1). Promotion to base is explicit and audited.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Full copy per scenario | Storage, divergence |
| Temporal tables / bitemporal | Complex queries; doesn't model branches |
| Git-like object store | Too complex for SQL/PostGIS queries |

## Consequences

All repository queries go through scenario-aware views; tested by a shared test suite per table.

# ADR-0025: Generate schematic diagrams with LOOM, edit them in our SVG editor

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-SCH-01..03

## Context

Automatic octilinear transit map layout is a research problem with a mature open-source implementation: LOOM (University of Freiburg; reported as GPL-3.0, to be verified).

## Decision

Run LOOM (`topo`, `loom`, `octi`) as a separate program in the tool-runner to generate initial layouts. Store results as editable diagrams in our schema; edit in a React SVG editor. Keep user-pinned positions across re-layouts.

## Consequences

GPL-3.0 tool shipped as separate program (compatible with AGPL-3.0 anyway). If LOOM output does not meet quality needs, fall back to a simpler force-directed + octilinear snapping algorithm.

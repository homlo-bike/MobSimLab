# ADR-0018: Deterministic, sourced assumption engine; LLM optional and off by default

- Status: Proposed (needs product owner confirmation, see C-10)
- Date: 2026-10-27
- Related: FR-ASM-01..04, C-10

## Context

The brief calls it an "AI Assumption Engine". Results must be reproducible and defensible.

## Decision

- Defaults and ranges come from a versioned YAML assumption library with sources, matched by context (most specific wins).
- Stored as `AssumedValue` with low/central/high, distribution, sensitivity, source, rationale.
- Sensitivity: one-at-a-time tornado, optional Monte Carlo, switching values.
- Optional LLM assistant: explain and draft only, user must accept, off by default, data sharing controlled by project owner.
- Missing library entry → validation error asking the user, never an invented value.

## Consequences

Library curation is ongoing work; contributors add entries with sources via PRs.

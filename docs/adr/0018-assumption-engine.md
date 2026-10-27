# ADR-0018: Deterministic assumption engine with cited or documented values; no built-in AI

- Status: Accepted (product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-ASM-01..05, FR-PLAT-05, C-10

## Context

The brief calls it an "AI Assumption Engine". The product owner decided: no built-in AI; all values are cited or supported by documentation; where no information exists, an educated guess is made; every value that acts as a variable can be adjusted in the Project Preferences window.

## Decision

- Defaults and ranges come from a versioned YAML **assumption library**, reviewed like code. Each entry has a basis: `cited`, `documented` (derivation written down) or `educated-guess` (reasoning written down, wide range).
- Context matching: most specific entry wins, then mode-level, then a **mandatory global fallback** (CI fails if a parameter has none). Nothing is invented at run time.
- Stored on objects as `AssumedValue` with low/central/high, distribution, sensitivity, basis, source and rationale.
- **Project Preferences → Parameters** lists every model variable, generated from the library schema, with value, basis, source, range, usages and reset to default. Edits are audited overrides and mark dependent results stale.
- Sensitivity: one-at-a-time tornado, optional Monte Carlo, switching values.
- No AI/LLM component.

## Consequences

Library curation is ongoing; contributors add entries with sources via PRs. Every new model variable must be added to the library (and so appears in Project Preferences) before it can be used.

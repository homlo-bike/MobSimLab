# ADR-0019: Four-step demand model built on AequilibraE

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-DEM-01..04

## Context

The brief requires a four-step model. Writing gravity models, logit mode choice, traffic equilibrium assignment and transit optimal strategies from scratch is large and error-prone. AequilibraE is a mature open-source Python toolkit with these components.

## Decision

Use AequilibraE in the Python worker for skimming, distribution (gravity, IPF), traffic assignment (bi-conjugate Frank-Wolfe) and transit assignment (Spiess–Florian). Implement trip generation and mode choice utilities in our code (simple, transparent formulas). Networks exported from the unified graph. Matrices in OMX.

**Licence gate (verified 2026-10-27):** AequilibraE's LICENSE is the MIT licence text with one added clause: "Reference to the software has to be made in all documentation for work developed with the software." This is compatible with AGPL-3.0-or-later, but the added clause makes it a non-OSI variant. We treat it as an attribution obligation: every report or export produced with a demand run cites AequilibraE automatically, and it is listed in `ATTRIBUTION`. The licence gate allowlists it by name (not as plain MIT).

## Alternatives considered

| Option | Why not |
|--------|---------|
| ActivitySim | Activity-based; heavy data needs; out of v1 scope |
| Custom implementation | Reinvents mature code |
| Commercial (VISUM, Emme, Cube) | Not open |

## Consequences

Python dependency confirmed; four-step results transparent and reproducible.

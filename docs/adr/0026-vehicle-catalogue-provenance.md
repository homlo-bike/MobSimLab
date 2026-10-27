# ADR-0026: Vehicle catalogue as sourced JSON files with per-field provenance

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-VEH-01..03, C-11

## Context

The brief asks for a large catalogue with many fields that are not publicly documented.

## Decision

One JSON file per vehicle under `vehicles/<mode>/<manufacturer>_<model>.json`, validated by JSON Schema in CI. Required core fields must be sourced; all others sourced or assumed with ranges. Catalogue data under CC BY 4.0 with attribution. Names used nominatively with trademark notice; no copied brochure text or images. Start with 2–3 well-documented models per mode, grow to the brief's 2–10.

## Consequences

Slower initial catalogue growth, but trustworthy numbers.

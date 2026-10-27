# ADR-0021: Versioned `.mslab` ZIP project format with JSON Schemas

- Status: Proposed
- Date: 2026-10-27
- Related: FR-PLAT-04, C-17

## Context

Projects must be saved, exported, imported and carry custom vehicles. Code may break compatibility before 1.0, user data must not.

## Decision

ZIP with `manifest.json`, NDJSON per entity, GeoJSON geometry, custom vehicles, assumptions, sources, generated `ATTRIBUTION.md`, optional run results and attachments. Semantic format version with forward migrations; published JSON Schemas. Import in sandboxed tool-runner with zip-bomb limits.

## Alternatives considered

| Option | Why not |
|--------|---------|
| GeoPackage (SQLite) | Good for geometry; less friendly for diffs and partial reads of non-spatial data; can be added as an optional export |
| pg_dump subset | Tied to DB internals |

## Consequences

Migration code for every format change; tests with fixture files of each version.

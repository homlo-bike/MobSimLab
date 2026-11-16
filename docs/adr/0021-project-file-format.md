# ADR-0021: Versioned `.mslab` ZIP project format with JSON Schemas

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
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

## Implementation (2026-11-16)

- Format 1.0.0 is built in `apps/api/src/mslab` with the layout of [10 §2.2](../architecture/10-collaboration-storage.md#22-project-file-format-mslab-adr-0021). Agreed with the product owner: each saved drawing is one JSON file `data/<kind>.json` in the shape the editor saves it, instead of NDJSON per entity, because the tools save whole documents; nothing is lost and the round trip is exact.
- Opening a file always creates a new project owned by the person who opens it. Run ids are always new; the project id is new too, so ids never conflict.
- Run results are optional (**Include saved simulation runs**); only finished runs are saved, with the replay of road runs.
- Custom vehicles, attachments, signatures and the "full export" with reference data are not in format 1.0.0, because projects cannot hold them yet; they are additions for a later minor version.
- JSON Schemas are in `contracts/mslab`, generated from `format.mts` and the editors' drawing outlines and checked by `apps/api/test/mslab-schemas.test.ts`.
- The import runs in the sandboxed tool-runner (`apps/api/src/tool-runner`), the first part of the tool-runner of ADR-0003.

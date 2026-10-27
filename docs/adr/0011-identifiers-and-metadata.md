# ADR-0011: UUIDv7 global identifiers and a shared metadata envelope

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-OBJ-01

## Context

Every object needs a global ID, metadata and audit history. Projects move between instances via files.

## Decision

- UUIDv7 for all persistent objects (time-ordered for index locality, globally unique).
- Shared column set (id, project_id, scenario_id, name, description, tags, custom, source_ids, created/updated at/by, version, deleted_at) applied by a migration template.
- `created_*`/`modified_*`/`version` set by DB triggers from session context, not by clients.
- External identifiers in a separate `external_refs` table.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Bigint sequences | Not globally unique across instances |
| UUIDv4 | Random; poor index locality |
| ULID | Equivalent; UUIDv7 is now an IETF standard (RFC 9562) with native type |

## Consequences

Uniform audit and metadata handling; triggers must be present on every asset table (CI check).

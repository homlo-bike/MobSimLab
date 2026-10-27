# ADR-0012: Append-only, hash-chained audit trail separate from logs

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-OBJ-02, FR-LOG-01, C-13

## Context

The brief lists AUDIT as a log level and wants every important action auditable. Logs are lossy by design (levels, sampling, rotation); audit must not be.

## Decision

- Audit records written by DB triggers and explicit service calls **in the same transaction** as the change.
- `audit.record` is append-only (no UPDATE/DELETE grants), partitioned by month, hash-chained per project and per instance; nightly chain verification.
- The logger's `audit()` method exists for developer convenience but routes to the audit module, never to log sinks.

## Consequences

- Audit volume must be planned for (see capacity estimate).
- Purge requires a documented admin procedure that is itself audited.

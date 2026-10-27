# ADR-0022: Logging with Pino (frontend) and Winston (backend), DB sink WARN and above

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-LOG-01..03, C-13

## Context

Brief: Pino frontend, Winston backend, levels TRACE..CRITICAL + AUDIT, sinks console/file/PostgreSQL.

## Decision

As specified, with: custom level map (TRACE 10 … CRITICAL 60); AUDIT routed to the audit module (ADR-0012); PostgreSQL sink only for WARN+ with daily partitions and retention; JSON structured logs with correlation IDs; shared redaction list; frontend batches to an authenticated, rate-limited endpoint. Workers use structlog (Python) and tracing (Rust) with the same JSON shape.

## Consequences

Consistent, queryable logs without database bloat.

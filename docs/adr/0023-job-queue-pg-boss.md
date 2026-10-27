# ADR-0023: Job queue in PostgreSQL with pg-boss

- Status: Proposed
- Date: 2026-10-27
- Related: ADR-0003

## Context

Imports, simulations, demand runs and exports are long-running jobs. The deployment has only PostgreSQL as infrastructure.

## Decision

Use pg-boss (`SKIP LOCKED`-based) for durable jobs with retries, priorities, singleton keys (one run per worker), and a transactional outbox for domain events. Python workers consume the same tables via a thin client (SQL contract tested against pg-boss's schema version).

## Alternatives considered

| Option | Why not |
|--------|---------|
| Redis + BullMQ | Extra service |
| RabbitMQ | Extra service |
| Graphile Worker | Equivalent; pg-boss has simpler multi-language consumption |

## Consequences

Python consumer must track pg-boss schema changes (pinned version, contract test).

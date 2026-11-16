# ADR-0023: Job queue in PostgreSQL with pg-boss

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
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

## As built (first use, 2026-11)

- The first jobs are the simulator tab's rail capacity runs that Owners and Editors start on the server ("Run on the server and save"). A run is a row in `simulation.run` (db/migrations/0007_simulation_runs.sql), saved with the project; the job only names the run.
- pg-boss 12.38.0 is pinned in `apps/api`. The migration creates the `pgboss` schema; the API installs and upgrades pg-boss's tables into it on the first send (as the app role, which owns them), runs pg-boss's supervisor, and grants the worker role `SELECT, UPDATE` on `pgboss.job` only.
- One queue, `simulation-run`: standard policy, no retries (a run is deterministic), 6 h expiry, 120 s heartbeat.
- The Python worker (`worker/src/mobsim_worker/queue.py`) takes, beats and settles jobs with the same statements pg-boss uses for that queue shape, fenced on the attempt. The contract test is `apps/api/test/simulation.int.test.ts`: it starts the real worker against a real pg-boss install and runs jobs end to end.
- `MOBSIMLAB_SIM_WORKERS` (1–64, default 1) sets how many worker processes take runs at the same time. Above 1, the `mobsim-worker` entry point (the s6 `worker` service) starts and supervises that many processes; a process that dies is started again with a growing wait, and `SKIP LOCKED` gives every job to exactly one process.
- The run row is the source of truth: the worker only starts a run that is still queued, writes only while it is running, and settles the run before the job. When pg-boss fails a job whose worker stopped beating, the API marks its run failed the next time the run is read.

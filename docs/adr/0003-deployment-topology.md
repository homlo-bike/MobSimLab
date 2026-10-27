# ADR-0003: Two-container default with supervised processes and an optional worker container

- Status: Proposed (needs product owner decision, see C-01)
- Date: 2026-10-27
- Related: C-01, NFR-REL-01, NFR-OPS-01

## Context

The brief requires Docker Compose with two services, `mobsimlab` (all application parts) and `postgres`, port 8080. Simulation is CPU and memory heavy and long-running; the API must stay responsive. A single process for everything would let one simulation crash or starve the whole platform.

## Decision

- Keep the two services, names and port from the brief as the default `compose.yaml`.
- Inside `mobsimlab`, run **s6-overlay** as PID 1 supervising: a one-shot migration step, the `api` process (NestJS, serves SPA and API on 8080), N `sim-worker` processes, and a log collector. Batch tools (`netconvert`, `osmium`, `osm2pgsql`, GTFS Validator, LOOM) are spawned on demand by the `tool-runner` in sandboxed child processes.
- Communication between API and workers only via PostgreSQL (pg-boss jobs, results) and a Unix domain socket for live frames, so workers can be moved to another container.
- Provide an **optional** `mobsimlab-worker` service (Compose profile `scale`) using the same image with `command: worker`, for larger installs.

## Alternatives considered

| Option | Why not |
|--------|---------|
| One process (NestJS calls SUMO in-process) | Crash and CPU isolation impossible; Node not suited (ADR-0004) |
| Many containers (api, worker, sumo, tiles, redis) | Violates brief; harder self-hosting |
| Kubernetes-first | Overkill for the target audience; can come later via Helm using the same image |

## Consequences

- Image is larger (SUMO, Python, JRE, GDAL); target ≤ 2 GB.
- Need s6 service definitions and health checks per process; container health = all longruns healthy.
- Scaling out is a configuration change, not a refactor.

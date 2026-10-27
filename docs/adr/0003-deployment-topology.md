# ADR-0003: Exactly two containers; simulation runs as supervised processes inside `mobsimlab`

- Status: Accepted (product owner, 2026-10-27)
- Date: 2026-10-27
- Related: C-01, NFR-REL-01, NFR-OPS-01

## Context

The brief requires Docker Compose with two services, `mobsimlab` (all application parts) and `postgres`, port 8080. The product owner confirmed: keep exactly two containers, with simulation running in the backend (or frontend). Simulation is CPU and memory heavy and long-running; the API must stay responsive.

## Decision

- Exactly two services: `mobsimlab` (port 8080) and `postgres`. No third container.
- Simulation runs on the **backend side, inside `mobsimlab`**. The browser only renders results and playback; it does not run simulations (a browser tab cannot run SUMO, and results must be shared and reproducible).
- Inside `mobsimlab`, **s6-overlay** is PID 1 and supervises: a one-shot migration step, the `api` process (NestJS, serves SPA and API on 8080), N `sim-worker` processes (`MOBSIMLAB_SIM_WORKERS`, default 2), and a log collector. Batch tools (`netconvert`, `osmium`, `osm2pgsql`, GTFS Validator, LOOM) are spawned on demand by the `tool-runner` in sandboxed child processes.
- API and workers communicate via PostgreSQL (pg-boss jobs, results) and a Unix domain socket for live frames.
- Larger installs scale vertically: more CPU/RAM for the container and more worker processes.

## Alternatives considered

| Option | Why not |
|--------|---------|
| One process (NestJS calls SUMO in-process) | Crash and CPU isolation impossible |
| Simulation in the browser | Cannot run SUMO or the rail kernel at scale; results not shareable or reproducible across users |
| Optional third worker container | Rejected by product owner |
| Kubernetes-first | Overkill for the target audience |

## Consequences

- Image is larger (SUMO, Python, JRE, GDAL); target ≤ 2 GB.
- s6 service definitions and health checks per process; container health = all longruns healthy.
- A worker crash fails only its run; the API keeps serving.

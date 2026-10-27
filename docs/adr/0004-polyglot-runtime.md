# ADR-0004: NestJS for the API, Python for the simulation worker, Rust for compute kernels

- Status: Proposed (needs product owner decision, see C-02)
- Date: 2026-10-27
- Related: C-02, C-05, NFR-PERF-03..05

## Context

The brief fixes NodeJS + NestJS for the backend. It also requires reuse of mature tools (SUMO, GTFS Validator, demand models) and rail simulation of thousands of trains. The relevant mature tools are C++ (SUMO, with official libsumo bindings for Python, Java, C++), Python (AequilibraE, SUMO tools) and Java (GTFS Validator). Node.js is single-threaded and slow for numeric loops.

## Decision

- **TypeScript/NestJS**: API, auth, permissions, persistence, orchestration, gateway, file import/export.
- **Python 3.12 `sim-worker`**: co-simulation coordinator, SUMO via libsumo, AequilibraE demand model, timetable generation, result writing.
- **Rust**: rail operations kernel, passenger engine, kinematics; exposed to Python with PyO3 (wheels built in CI).
- **Contracts**: JSON Schema is the single source of truth; types generated for TS, Python (pydantic), Rust (serde).

## Alternatives considered

| Option | Why not |
|--------|---------|
| Node only (TraCI over TCP from Node, rail kernel in TS) | TraCI per-step overhead is high; TS rail kernel unlikely to reach 2,000 trains at 50× real time; would have to reimplement four-step modelling |
| Node + Rust via napi-rs, no Python | Loses libsumo Python bindings and AequilibraE; would need a C++ shim for libsumo and own demand code |
| Java/Kotlin worker (OSRD core style) | Heavier runtime; no demand-model library advantage |
| Everything in Python | Rail kernel too slow in pure Python; API stack differs from brief |

## Consequences

- Three toolchains in CI; contributors may work in only one.
- Clear boundaries reduce coupling: each language owns a layer.
- Build time and image size increase; mitigated with multi-stage builds and caching.

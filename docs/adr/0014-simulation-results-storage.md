# ADR-0014: Simulation trajectories in Arrow/Parquet files, aggregates in PostgreSQL

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: NFR-PERF-01, 04 §3.5

## Context

A run produces up to hundreds of millions of samples. Storing them as rows would bloat the database and backups.

## Decision

Per-run folder on the data volume with Parquet (zstd) for trajectories, events and passenger loads; Arrow IPC for fast replay; manifest with SHA-256 per file. KPIs and summaries in PostgreSQL. Replay streams from files.

## Consequences

Backups must include the data volume. Run results can be archived by deleting trajectories and keeping KPIs. Researchers can read results with any Arrow/Parquet tool.

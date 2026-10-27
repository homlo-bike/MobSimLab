# ADR-0027: Optimistic locking, presence and scenario branches instead of real-time co-editing

- Status: Proposed
- Date: 2026-10-27
- Related: FR-PLAT-02, FR-PLAT-06

## Context

Shared projects need multi-user work. Network graphs have strong invariants that automatic merges (CRDT) can break.

## Decision

Optimistic locking with version numbers and a merge dialog; WebSocket presence, soft locks and live change feed; scenarios as personal branches with diff and cherry-pick; comments and mentions on any object.

## Consequences

Simpler, safer v1. Real-time co-editing (e.g. Yjs for comments/notes) can be added later where invariants are weak.

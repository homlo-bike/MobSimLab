# Spike S2: rail kernel performance

- Date: 2026-10-27
- Status: **Passed** (target ≥ 50× real time for one day with 2,000 trains; measured ≈ 13,400× at dt = 1 s and ≈ 2,600× at dt = 0.2 s on one core)
- Code: [`crates/rail-sim`](../../crates/rail-sim), benchmark binary `bench_s2`
- Related: NFR-PERF-03, [07 §4](../architecture/07-simulation.md), ADR-0007

## What the prototype implements

- Train detection sections (TDS) with length, speed limit and gradient.
- Fixed-block, signal-to-signal interlocking. A route covers every section from one signal to the next and is locked **atomically** (all or nothing). Sections are released one by one as the tail clears them (sectional release).
- A train never moves beyond its movement authority (end of its last locked route). Routes are requested when the authority ahead falls below braking distance + 10 s of running + 200 m (all three are config values).
- Longitudinal dynamics: traction limited by max acceleration and power (P / m·v), Davis resistance A + Bv + Cv², gradient, service braking curves to the authority end, to stops and to lower speed limits ahead. The braking curve is solved exactly for the discrete integrator, so trains stop at the target without overshoot.
- Scheduled stops with dwell, cyclic (loop) paths and non-cyclic paths with an exit portal for co-simulation handover (used by S1).
- Deadlock detection (no movement while trains wait, 900 s timeout) and an optional event log.
- `check_invariants()`: every section under a train body is reserved by that train, and no head is past its authority.

## Reference scenario

`LoopNetworkParams::default()`:

| Item | Value |
|------|-------|
| Lines | 40 loop lines, 90 km each (150 blocks × 600 m) |
| Trains | 50 per line, 2,000 total; generic 200 m / 400 t / 4 MW EMU |
| Stations | every 4th block (2.4 km), 30 s dwell |
| Speeds | 160 km/h line speed, 90 km/h on every 10th block, ±0.5 % gradients |
| Conflicts | line pairs share a flat crossing section; the route over the crossing includes the next block |
| Sections | 6,020 |

## Results

Host: cloud container, Intel Xeon @ 2.30 GHz, 4 vCPU (one core used), Rust 1.97 release build, `lto = "thin"`.

| dt | Wall time for 86,400 s | Speed-up | Train-km | Avg speed | Routes set | Stop arrivals | Deadlocks |
|----|-----------------------|----------|----------|-----------|------------|---------------|-----------|
| 1.0 s | 6.4 s | ≈ 13,400× | 2.71 M | 56.5 km/h | 4.52 M | 1.15 M | 0 |
| 0.2 s | 29–33 s | ≈ 2,600–3,000× | 2.75 M | 57.2 km/h | 4.58 M | 1.16 M | 0 |

Safety invariants were checked every simulated hour in the benchmark and after every step in the tests; no violation occurred.

Reproduce: `cargo run --release -p rail-sim --bin bench_s2 -- 86400 1.0`

## Tests

`crates/rail-sim/tests/invariants.rs`:

- property test: random loop networks (1–4 lines, 12–40 blocks, 500–1,500 m blocks, 10–50 % occupancy, dt 0.5/1/2 s) keep both invariants every step for 30 minutes and never deadlock;
- placement on an occupied section is refused;
- a train stops at the signal before a blocked section and continues when it is unblocked;
- station stop at the exact position with at least the scheduled dwell;
- exit portal: the train runs out, its sections are released after the tail clears;
- five following trains on one loop keep separation.

## Conclusions and limits

- Performance is two orders of magnitude above the target, so ADR-0007 (custom Rust kernel) stands and parallelism (`rayon`) is not needed yet. The headroom pays for the features still missing.
- Not yet in the prototype (Phase 6 scope): switches and flank protection, overlaps beyond the signal, approach locking and route cancellation, multi-aspect signalling and ETCS/CBTC moving block, dispatching and platform assignment, rerouting, emergency braking, OSRD comparison for accuracy (NFR-ACC-01).
- The number of rejected route requests is high (trains re-request every step while the block ahead is occupied). It does not hurt performance here; the production kernel will be event-driven (wake on release), as planned in 07 §4.5.

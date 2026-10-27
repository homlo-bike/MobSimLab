# Spike S1: SUMO and rail kernel co-simulation in one process

- Date: 2026-10-27
- Status: **Passed** (tram crosses rail → street → rail without teleport, distance continuous, level crossing safe, overhead measured)
- Code: [`worker/spikes/s1_cosim.py`](../../worker/spikes/s1_cosim.py), bindings [`crates/mobsim-py`](../../crates/mobsim-py)
- Related: [07 §5](../architecture/07-simulation.md), ADR-0005, ADR-0006

## Setup

One Python 3.12 process runs SUMO 1.28.0 through libsumo and the Rust rail kernel through PyO3 bindings (`mobsim_kernels`, built with maturin, abi3).

```text
 R2 kernel track  (0,2000) → (0,3000)
        ▲  portal Q: SUMO holds the tram at a stop; kernel admits it atomically, SUMO vehicle removed
 street (SUMO)    P (0,1000) → M (0,1500) → Q (0,2000), cars join from a side street at M, leave at Q
        ▲  portal P: kernel opens the exit only if the street entry is free; SUMO vehicle inserted
 R1 kernel track  (0,0) → (0,1000), level crossing with a two-way road at y = 500
```

Road demand: 600 veh/h each way across the level crossing and 300 veh/h on the side street (1,500 cars per hour in total). Step length 0.5 s for both engines.

## Coordinator rules tested

1. **Rail → road.** The kernel's exit portal opens only while the first 50 m of the street are free. When the head reaches the portal, the tram is inserted into SUMO with the kernel's speed, one step ahead (SUMO places a new vehicle without moving it in its insertion step). While the tail is still on kernel track, the kernel moves it at the SUMO speed and keeps the sections reserved until the tail clears.
2. **Road → rail.** A SUMO stop at the end of the street holds the tram. The coordinator asks the kernel to admit it (`add_train`, which reserves the entry route atomically or fails). On success the SUMO vehicle is removed in the same step. The kernel path starts with a 40 m stub that overlaps the end of the street, so the body is never in two places.
3. **Level crossing.** The crossing section starts blocked for rail. When a train approaches, the road light goes yellow (3 s), then red. Only after 8 s of red and an empty junction box does the coordinator unblock the crossing section, so the kernel can lock the route over it. After the tail clears, the section is blocked again and the road goes green.

## Results

`python s1_cosim.py --steps 7200` (one simulated hour), same host as S2:

| Check | Result |
|-------|--------|
| Tram reached the end of R2 (`Terminated`), same ID `tram1` throughout | ✅ |
| Teleports | 0 |
| Max distance discontinuity (|Δs − v̄·dt| per step, across both handovers) | 0.15 m |
| Steps with road green while the crossing section was reserved | 0 |
| Kernel safety invariants (checked every step) | ✅ |
| SUMO-only baseline, 7,200 steps, 1,500 cars | 0.26 s wall |
| Co-simulation, same | 0.34 s wall |
| Coordinator time (kernel steps, JSON state reads, TraCI queries) | ≈ 5 µs per step |
| Total overhead vs baseline | ≈ 11 µs per step |

## Findings

- libsumo and the PyO3 extension coexist in one interpreter without problems. Calling the kernel per step is cheap; the overhead is dominated by Python glue and will scale with the number of trains near portals, not with network size.
- **Portal geometry must come from the SUMO network.** netconvert shortens lanes at junctions, so the street lanes total 945.6 m rather than the nominal 1,000 m. The production export must place portal stubs using SUMO's lane lengths and internal lanes, not nominal geometry.
- Removing a SUMO vehicle that is held at a stop prints "aborts stop". This is expected and harmless; production code will call `resume` before removal to keep logs clean.
- The road insertion check and level-crossing timing are coordinator rules in Python here. In the product they belong to the co-simulation coordinator module (07 §5) with configurable timings in Project Preferences (crossing warning time, minimum road red before rail route).
- pip warns that libsumo was built against Arrow 23 while the environment had pyarrow 26. The worker image must pin a pyarrow version matching the libsumo wheel.

## Reproduce

```bash
python -m venv .venv && . .venv/bin/activate
pip install eclipse-sumo libsumo maturin
(cd crates/mobsim-py && maturin develop --release)
python worker/spikes/s1_cosim.py --steps 7200 --json s1.json
```

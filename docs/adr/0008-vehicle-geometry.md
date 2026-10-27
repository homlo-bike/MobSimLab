# ADR-0008: One-dimensional authoritative motion with derived multi-body geometry

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-SIM-04, FR-SIM-05, C-03

## Context

The brief requires geometric vehicles (sections, gangways, articulations, axles, bogies, couplers; wheel paths determine motion) and absolute collision prevention, while using SUMO for road traffic. SUMO moves vehicles as points along lanes. Full 2-D multibody dynamics for thousands of vehicles is infeasible and unnecessary for planning.

## Decision

- Motion is 1-D along a path and authoritative in SUMO (road) and the rail kernel (rail). Collision prevention is enforced there (car-following and junction logic; block/TDS exclusivity).
- A Rust `kinematics` crate derives axle, bogie, section, gangway and coupler poses every recorded frame: rail axles follow the track path at their offsets; articulated buses use a single-track kinematic (tractrix) model.
- The same crate computes swept envelopes for design-time clearance, depot manoeuvre and platform gap checks.

## Alternatives considered

| Option | Why not |
|--------|---------|
| 2-D rigid-body physics engine | Orders of magnitude slower; would replace SUMO; no planning value |
| Icons only | Fails brief; no clearance checks |

## Consequences

- "No overlap" is guaranteed by 1-D engines, and visually consistent because geometry is derived from the same positions.
- Kinematic accuracy depends on vehicle geometry data quality (ADR-0026).

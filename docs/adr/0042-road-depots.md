# ADR-0042: Road depots shared by the street lines, laid out and checked in Rust

- Status: Proposed (first version built)
- Date: 2026-11-16
- Deciders: product owner, architecture
- Related: 07-simulation §3 and §7, ADR-0008 (vehicle geometry), ADR-0029 (street line tool), FR-NET-09, FR-SIM-09

## Context

The road simulation starts every vehicle in its depot slot and parks it there at the end of the run
(07-simulation §3.2). Until now a street line had only a depot point of its own: no gates, no slots, no driving
paths inside, nothing the simulation could park a vehicle in. The product owner decided:

- A depot is **shared**: any street line may pull out of and in to a depot when its vehicles fit it.
- Road depots take **bus, BRT, trolleybus and intercity bus** only. Trams use track depots (07-simulation §4.6).
- Both **straight and angled** bays.
- The **swept-path check** and **dynamic sizing** are part of the first version.

## Decision

1. **Saved depot** (drawing kind `depots`, `contracts/depot.schema.json`): id, name, the modes it takes, outline,
   gates (entrance, exit, or both) on the outline, zones (parking, charging, maintenance, reserve, circulation)
   and the layout: drive-through lanes with their slots (centre, heading, length, width, charger) and aisles
   (centreline, width, one or two way). The layout is generated, then edited by the planner (move, copy, resize,
   chargers, remove), and saved as it is.
2. **Lanes are drive-through** (first in, first out): a vehicle enters at the back and leaves at the front, never
   reversing. Straight (90°) bays have two-way aisles; angled bays (60°, 45°) have one-way aisles. Each zone
   has its own angle, vehicles per lane (automatic: the project value `depot.vehicles_per_lane` or fewer,
   whichever holds most) and design vehicle (default: the longest of the lines using the depot).
3. **Layout engine in Rust** (`crates/depot-layout`, WebAssembly `depot-layout-wasm`, Python
   `mobsim_kernels.depot_report`). Strip packing per zone tries the zone's two longest sides in four directions
   and several phases. The aisle width is the narrowest the design vehicle's **swept path** allows (single-track
   model from the turning circle, trailers by tractrix), with `depot.swept_clearance_m`; a final pass drops any
   lane a vehicle cannot enter or leave without touching the fence or a parked vehicle.
4. **Driving network**: gate edges, aisle edges, lane edges and straight drives between them kept only where they
   lie on a shortest route. Every lane must be reachable from an entrance and reach an exit.
5. **Capacity**: one slot per vehicle of the lines using the depot, spares included (`mode.spare_share`); battery
   vehicles go to charging slots first; maintenance slots are not used for overnight parking. Shortfalls and
   vehicles with no fitting slot are issues.
6. **Dynamic sizing** (separate call, a few seconds in the browser): for each bay angle, the smallest rectangle
   that holds the fleet, and how many vehicles the drawn outline holds.
7. **Lines and gates**: a street line saves `depotId`. Its pull-out runs start at the nearest exit gate and its
   pull-in runs end at the nearest entrance gate (`StreetLine::set_depot_gates`). A depot can be chosen when it
   takes the line's mode and, once laid out, has a slot the line's vehicle fits. Lines saved with a depot point
   keep it until a shared depot is chosen.
8. **New project values**: `depot.turning_circle_m`, `depot.swept_clearance_m`, `depot.charger_power_kw`
   (assumption library, `streets-depots.yaml`). Catalogue vehicles now carry width, articulations, axle
   positions, turning circle and energy.

## Consequences

- The road simulation builds its depot request with `depotInput(depot, lines, prefs)` (web) or the saved depot
  plus `vehicles`, `fleet` and `rules` (`$defs/analysis`), and gets the driving network and a slot per vehicle
  from `analyse`.
- The check runs on the browser's main thread (about 0.3 s per change for a 150-slot depot); sizing takes a few
  seconds and shows a busy note. A worker can take both later if depots grow larger.
- Slot-level editing is per lane (resize, chargers for the whole lane); single slots are not moved on their own.

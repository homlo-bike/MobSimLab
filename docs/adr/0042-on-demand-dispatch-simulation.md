# ADR-0042: On-demand dispatch simulation: one random day, booking by booking, with cheapest insertion in the browser

- Status: Proposed; first version built (2026-11-15)
- Date: 2026-11-15
- Deciders: product owner, architecture
- Related: ADR-0036 (plugins), ADR-0037 §7 (on-demand buses on the service zone kit), ADR-0034 (journey planner), ADR-0031 (routing in the browser)

## Context

The on-demand bus plugin (ADR-0037 §7) estimates a zone with continuous-approximation formulas: the vehicles needed, the average wait and ride. Those formulas assume requests spread evenly and a fleet in steady state. They cannot say how many bookings a fleet turns away in a busy hour, how long the unlucky tenth of riders waits, how much pooling lengthens a ride, or how many vehicle-km run empty. The product owner asked (2026-11-15) for a trip-by-trip simulation now rather than later.

Operators and researchers answer these questions with agent-based dispatch simulations (MATSim's DRT module, MOIA's and others' fleet studies). Their core is the same: requests arrive over the day, a dispatcher inserts each into one vehicle's plan under service limits, and vehicles drive the plans.

## Decision

### 1. What is simulated

One service day of one zone, in `crates/mode-kits/src/dispatch.rs` (`simulate`), called from the browser through `simulate_zone` in mode-kits-wasm:

- **Bookings.** A Poisson process at the zone's requests an hour over the service hours. Pick-up and drop-off are uniform in the zone outline (rejection sampling). Each booking is for one or more riders, with the mean `drt.riders_per_request`. A seeded SplitMix64 generator gives the same day for the same input on every platform.
- **Driving.** Straight distance × the street detour factor (`drt.network_factor`) at the zone speed (`drt.speed_kmh`); every stop adds the dwell (`drt.stop_dwell_s`). Vehicles start spread over the zone and wait where they last dropped off. No street network is used: the zone kit stays independent of OpenStreetMap, and the estimate and the simulation use the same distances, so they can be compared.
- **Dispatch.** When a booking arrives, every vehicle's remaining plan is tried with the pick-up and drop-off inserted at every pair of positions (cheapest insertion, the standard heuristic of operating services). A plan is valid when, for the new rider and everyone already booked, the wait stays within `drt.max_wait_limit_s`, the ride within the direct ride × (1 + `drt.max_detour_share`) + `drt.max_detour_fixed_s`, and the load within `drt.vehicle_places`. The cost of a plan is the extra driving (which is also the delay of the riders already booked) plus the new rider's wait and ride. The cheapest valid plan wins; with none, the booking is turned away. A vehicle on its way may turn from where it is.
- **Limits** come from the plugin's values, with MOIA's service rule as the central case: 15 min longest wait (MOIA 10 min, rural services longer), rides at most 50 % plus 10 min longer than direct.

### 2. What it reports

Bookings served and turned away, the mean and 90th-percentile wait, mean ride, mean ride over the direct ride, the share of riders who shared part of their ride, riders on board per vehicle-km, vehicle-km and their empty share, riders per vehicle-hour, and per hour the bookings, served and mean wait and the vehicles carrying riders.

### 3. Where it shows

- The On-demand bus tool gets **Simulate the day** under the estimate. The run takes well under a second for a typical zone (at most 50 000 bookings a day) and is not saved; it is cleared when the zone, fleet, hours or requests change, so a shown result always belongs to the zone as drawn.
- The journey planner uses the simulated mean wait and ride for the zone when the planner ran the day, and the estimate otherwise.

### 4. Not decided here

- Rebalancing empty vehicles to where bookings are expected, prebooked trips, stop-based (virtual stop) services and walking to a stop.
- Demand that is not uniform (from population or a trip table), and routing on the street network.
- Several zones sharing a fleet, and the hand-off between a zone and a fixed line.

These can follow when a planner asks for them; each fits the same simulation loop.

## Consequences

- The planner sees the spread of waits and the turned-away share, which the formulas hide, and can size the fleet for a target such as "9 in 10 picked up within 15 min".
- Results differ a little from the estimate. The simulation pools riders and keeps hard limits; the estimate assumes steady state and an average wait growing with the busy share. A test checks that both agree on the order of magnitude of the wait.
- The cheapest insertion is greedy: it does not revise earlier assignments, so a real dispatcher with re-optimisation does somewhat better. The result is a conservative first estimate.
- All new parameters start `unverified`, like the rest of the plugin.

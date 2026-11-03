# ADR-0034: Journey time benchmark: RAPTOR over a GTFS-shaped published timetable, in Rust and WebAssembly

- Status: Proposed (product owner request 2026-11-01)
- Date: 2026-11-01
- Deciders: product owner, architecture
- Related: FR-TT-05, FR-NET-12, ADR-0009 (one routing library), ADR-0020 (day types), ADR-0029 (street lines), ADR-0031 (routing in the browser), ADR-0032 (railway operations), ADR-0035 (agent integration)

## Context

The product owner asked for a benchmark of the network the planner builds (2026-11-01): pick a point A and a point B, and the system says how long the journey takes with that network, split into walking, waiting for the vehicle, changes and travel time. The planner sets a departure time or an arrival time and sees how the journey changes through the day.

The answer depends on timetables. ADR-0032 (railway operations, in review) produces conflict-free rail timetables with service periods (peak, off-peak, no service) and Swiss-style timed connections at nodes. Street lines (ADR-0029) have a headway but no exact trips yet. There is no walking network yet (Phase 2).

## Decision

1. **One published timetable contract**, `contracts/published-timetable.schema.json`, agreed with the railway operations work. It uses **GTFS names** (`stop_id`, `parent_station`, `platform_code`, `trip_id`, `route_id`, `direction_id`, `service_id`, `block_id`, `stop_sequence`, `arrival_time`, `departure_time`, `pickup_type`, `drop_off_type`, `transfer_type`, `min_transfer_time`), so the GTFS export (FR-TT-05) and GTFS import (FR-NET-12) are copies, not translations. Times are seconds after midnight of the service day and may pass 24:00.
   - For rail, a stop is **one platform edge** (the railway editor's stable id) and `parent_station` groups the platforms and same-name station parts of one station. Each call names the platform the plan chose.
   - **Transfers**: `transfer_type` 1 (timed) marks the guaranteed node connections of the periodic timetable, with `max_wait_s` (planned hold for a late feeder, used by operations, not by planning). 3 forbids a change. `estimated` marks a time that is not yet computed from the station layout.
   - **Frequency patterns** for lines without exact trips (street lines): stop sequence with running and dwell times plus periods `{start_time, end_time, headway_secs, offset_secs, kind}`; no period means no service. The planner expands them into trips on the clock face. Rail always publishes exact trips.
2. **Routing: RAPTOR** (Delling, Pajor & Werneck, *Transportation Science* 49(3), 2015) in a new Rust crate, `crates/journey-planner`. Round *k* gives the earliest arrival at every stop with at most *k* vehicles, so one query returns the fastest journey and, for free, the Pareto set by number of changes (a slower journey with fewer changes is offered as an alternative). Trips with the same stop sequence form a route; routes whose trips overtake are split so each is FIFO. Pickup and drop-off flags are respected.
3. **Arrive-by** searches for the latest departure whose earliest arrival is not after the asked time. Earliest arrival never decreases with a later departure, so a binary search over the departure second is exact and reuses the forward search (about 15 forward queries per question).
4. **Through the day**: the same question is asked every *n* minutes (5–60) from 04:00 to 01:00; each point is a full journey with its breakdown.
5. **What a journey's time is made of** (they add up to the total):
   - *walking*: origin to first stop and last stop to destination (or all the way, if walking is fastest);
   - *waiting*: at the first stop, when leaving at the asked time (the panel also says when to leave to skip it, and the door-to-door time then);
   - *in vehicle*: including dwell at intermediate stops;
   - *change, walking* and *change, waiting* (including the minimum change time);
   - *early arrival*: arrive-by only, the slack before the asked time.
6. **Walking until the walk graph exists**: straight-line distance × `journey.walk_detour_factor` at `demand.walk_speed_kmh`; access and egress up to 1000 m (rail catchment, `mode.catchment_m`), changes up to 400 m between stops, and every pair of stops of one station plus `journey.level_change_s`. A station is the stops sharing a `parent_station`, together with stops of the **same normalised name** (case, accents and spacing ignored, as `rail-model`) within 600 m of each other: the naming rules give a bus stop beside a railway station the station's name, so street lines and trains connect there even when the platform's middle is beyond the 400 m change walk. A change at the same stop takes `journey.min_change_s`. Explicit transfers from the timetable override estimates. When the walk graph arrives, access, egress and transfer times come from it and the planner is unchanged.
7. **Where it runs**: the crate compiles natively (simulation worker, batch benchmarks, the agent tools of ADR-0035) and to WebAssembly (`crates/journey-planner-wasm`) for the web app's **Journey planner** panel, like street routing (ADR-0031). The panel picks A and B on the map (draggable markers), depart-at or arrive-by and a time, and shows the total, the split as a stacked bar, the itinerary, alternatives with fewer changes, and the through-the-day chart (stacked by part, with a table view). It routes on the street line drawn in the street line tool (its headway off-peak, half of it in the peaks, 05:00–00:30) and, until real timetables are published, on an example city that can be placed at the map centre.

## Alternatives considered

| Option | Why not |
|--------|---------|
| OpenTripPlanner, R5, MOTIS | JVM or C++ services with their own graph build from GTFS and OSM; a second routing engine against ADR-0009, and too slow to rebuild on every edit of a line |
| Connection Scan Algorithm | Equally fast for earliest arrival, but RAPTOR gives the Pareto set by changes per query and handles walking transfers more naturally |
| Time-expanded Dijkstra | Much larger graph; no advantage at this size |
| Our own timetable model instead of GTFS names | Every exporter and importer would need a mapping; the railway operations work agreed to publish in this shape |
| Profile RAPTOR (rRAPTOR) for the day chart | Fewer queries, but the chart needs each point's full breakdown and itinerary; repeated queries take well under a second in the browser on city-sized networks; can be added behind the same API |

## Consequences

- The benchmark works on street lines, the example city and rail. `rail-plan` (`journeys` module) publishes a plan in this contract's form, with each platform edge placed at the middle of the edge from the topology export; `cargo run -p rail-plan --example publish_journeys -- TOPOLOGY LINES` writes the file and the panel's **Add rail timetable (JSON)** loads it, under a `rail:` id prefix. Running `rail-plan` in the browser, with lines authored in the railway tool, is the next step.
- CI and the image build compile a second WebAssembly module (`tools/wasm/build-journey-planner.sh`).
- Three new parameters in the assumption library (`journey.walk_detour_factor`, `journey.min_change_s`, `journey.level_change_s`), educated guesses until cited.
- Not yet modelled: staying seated across `block_id` trips, delays and real-time (a separate stream from the simulation), fares, accessibility (step-free) routing, crowding. Walk legs are straight lines on the map until the walk graph exists.

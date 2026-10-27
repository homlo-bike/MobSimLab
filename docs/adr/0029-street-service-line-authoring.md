# ADR-0029: Street-based service lines are drawn as an ordered point circuit, routed on the road graph

- Status: Accepted (product owner's workflow and review, 2026-10-27)
- Date: 2026-10-27
- Related: FR-NET-11, FR-NET-11a, FR-SIM-09, ADR-0009 (unified graph), ADR-0028 (persistence), [06 §9.4](../architecture/06-gis.md#94-street-based-service-lines)

## Context

Bus, BRT, trolleybus and intercity bus lines run on the road network. The plan said "lines, routes, patterns, stop sequences" (FR-NET-11) and "deadheads from the unified graph" (07 §8) but did not say how a planner draws a street line. The product owner proposed: click points on the map in order; the tool routes point to point and from the last point back to the first, forming a loop; points can be moved (re-route) and promoted to stops; vehicles start in a depot, run a routed pull-out to the first stop before service and a pull-in from the last stop to the depot after service.

Real street lines raise issues a pure loop does not cover:

1. Most lines are **two-way between two termini**, not circular. The return often uses different streets (one-way pairs, turn bans) and always uses stops on the **other side** of the street.
2. A stop belongs to a **kerb side and travel direction**. A point on a two-way street centre line is ambiguous.
3. Lines need **terminal layover / recovery time** and somewhere to turn (turning loop, block-around, bus station). A U-turn on a public street is usually not allowed.
4. Lines have **variants**: short turns, express patterns, school trips, night diversions.
5. Vehicles are **interlined**: one vehicle block can run trips on several lines, and its first trip may start at either terminal.
6. Trolleybuses are bound to the wire (plus battery range); BRT should prefer dedicated lanes; intercity buses use motorways and off-street bus stations.

## Decision

Keep the owner's model as the core. Revised 2026-10-27 after the owner's review: no separate return helper, stops placed on the sidewalk, and no U-turns or reversing.

1. **Route circuit.** A route is an ordered list of route points that is always **closed** (last point routes back to the first). The circuit is what one vehicle drives in one full cycle. A "two-way" line is simply a circuit that passes the stops on both sides of the street: the planner places the outbound stops on one sidewalk and the return stops on the other.
2. **Point kinds.** Every point starts as a **via point** (shapes the path, no passengers). A via point can be promoted to a **stop** and demoted again. A stop can be marked an **end stop** (layover point, see 8).
3. **Paired stops are one stop for passengers.** Stops on opposite sidewalks (or any stops and stations within the configurable grouping distance, 06 §9.3) form one `StationGroup`: they inherit the name of the first one and act as one entity served by several lines and modes. GTFS export writes them as separate stop points under one parent station.
4. **Stops are placed on the sidewalk, not on the street.** The point is snapped to the nearest sidewalk or kerb line, which fixes which side of the street it is on. The stop is linked to the adjacent road edge **in the direction of travel that has that sidewalk on the door side** (the right in right-hand-traffic countries, the left in left-hand-traffic countries, set per project). A vehicle can only serve the stop when approaching in that direction, so the router must arrive at it that way. BRT median stations are platforms between the lanes, checked against the vehicle's door sides by the platform validator.
5. **Routing.** Each leg between consecutive points uses the routing library on the mode's road profile: access rules (bus/psv), one-way streets, turn restrictions, vehicle height/weight/length limits, minimum turning radius from the vehicle swept path (08), trolleybus wire plus battery range, BRT lane preference. **U-turns on the street and reversing are never allowed.** If the next stop needs the vehicle to drive back along the same street, the router goes round the block (or a longer loop of streets) until it can approach the stop from the correct direction.
6. **Turning-around advice.** When a leg needs a detour longer than a configurable threshold (Project Preferences, default 500 m or 25 % of the direct distance) to turn round, the tool shows a warning on the leg and advises moving the end stop to a place where the vehicle can turn: a bus station, turning loop, roundabout or block that can be driven round. If no legal path exists, the leg is a validation error with the reason.
7. **Editing.** Moving, inserting or deleting a point re-routes only the two adjacent legs. When the road network changes (scenario edits, new OSM import), affected legs are marked stale and re-routed on request, with a diff shown before saving. A planner can pin a leg to a manually chosen path, which must still follow road edges legally.
8. **End stops.** Each end stop has a minimum layover and recovery-time rule (Project Preferences, sourced default, see 09 §1.5) and optionally a layover stand off the running lane. The timetable engine (07 §8) uses them. A circuit with two end stops is split there into direction 0 and direction 1 for timetables and GTFS; a circuit with one end stop is a circular line.
9. **Patterns.** The full circuit is the base pattern. Variants (short turn, express, school, night diversion) are patterns that skip stops or use part of the circuit, with their own closing legs if they turn short.
10. **Depot movements.** Vehicles start in their depot. Pull-out runs from the depot gate to the **first stop of the vehicle block's first trip** (any line for interlined blocks) and pull-in from the **last stop of its last trip**; both are routed with the same rules (no U-turns) and are non-revenue trips. Mid-day returns (between peaks or for charging) are generated by the block builder when cheaper than waiting.
11. **Intercity bus** uses the same tool. Stops may snap to off-street bus stations imported from OSM (`amenity=bus_station`), and the routing profile allows motorways.

## Consequences

- The planner's workflow is exactly the proposed one: click points, the line closes itself, promote stops, move points.
- Stop side is always unambiguous because stops sit on a sidewalk, and the router enforces the approach direction.
- Long turn-round detours and impossible legs surface as warnings and validation errors instead of silently invalid paths.
- The domain model gains `RoutePoint {seq, kind: via|stop|end_stop, sidewalk_ref, edge_ref, direction, pinned_leg?}` under `svc.route`, plus end-stop and detour-threshold rules in Project Preferences.

## Alternatives considered

- **A "Create return" helper that generates the opposite direction** (first draft of this ADR): dropped after review; placing stops on both sidewalks in one circuit is simpler and gives the planner full control.
- **Draw each direction separately**: common in commercial tools, but doubles the work and drifts out of sync when the planner edits one side.

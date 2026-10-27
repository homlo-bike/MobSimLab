# ADR-0029: Street-based service lines are drawn as an ordered point circuit, routed on the road graph

- Status: Proposed (based on the product owner's workflow of 2026-10-27; awaiting confirmation of the adjustments below)
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

Keep the owner's model as the core and add the minimum needed for the issues above.

1. **Route circuit.** A route is an ordered list of route points that is always **closed** (last point routes back to the first), exactly as proposed. The circuit is what one vehicle drives in one full cycle.
2. **Point kinds.** Every point starts as a **via point** (shapes the path, no passengers). A via point can be promoted to a **stop** and demoted again. Any stop can be marked a **terminal** (layover point).
3. **Loop vs two-way is just the number of terminals.** One terminal = circular line. Two terminals = ordinary two-way line; the circuit from terminal A to terminal B is direction 0 and from B back to A is direction 1. GTFS export splits the circuit at the terminals into two directions and shapes.
4. **"Create return" helper.** For a two-way line the planner draws only the outbound points. The tool proposes the return leg by reversing the point order, routing it with one-way and turn rules, and creating the paired stop on the opposite kerb for each outbound stop (same name, grouped in one `StationGroup`, 06 §9.3). Every proposed point is editable.
5. **Snapping and kerb side.** Points snap to road-graph edges the mode may use. A stop is stored with the edge, the travel direction and the kerb side (right in right-hand-traffic countries, left in left-hand; median/left-door for BRT stations, checked against vehicle door sides by the platform validator).
6. **Routing.** Each leg between consecutive points uses the routing library on the mode's road profile: access rules (bus/psv), turn restrictions, vehicle height/weight/length limits, minimum turning radius from the vehicle swept path (08), trolleybus wire plus battery range, BRT lane preference. U-turns are off by default; if a leg can only be closed with a U-turn or no path exists, the leg is flagged as a validation error with the reason. A planner can pin a leg to a manually drawn path, which must still follow road edges (add the missing road to the network first if needed).
7. **Editing.** Moving, inserting or deleting a point re-routes only the two adjacent legs. When the road network changes (scenario edits, new OSM import), affected legs are marked stale and re-routed on request, with a diff shown before saving.
8. **Terminals.** Each terminal has a minimum layover and a recovery-time rule (Project Preferences, sourced default, see 09 §1.5) and optionally a layover stand location off the running lane. The timetable engine (07 §8) uses them.
9. **Patterns.** The full circuit is the base pattern. Variants (short turn, express, school, night diversion) are patterns that skip stops or use a sub-range of the circuit, each with its own circuit closure if it turns short.
10. **Depot movements**, as proposed, with two refinements: pull-out runs from the depot gate to the **first stop of the vehicle block's first trip** (either terminal, any line for interlined blocks) and pull-in from the **last stop of its last trip**; both are routed on the same road graph and are non-revenue (deadhead) trips. The depot is the vehicle's assigned depot; mid-day returns (for example between peaks or for charging) are generated by the block builder when cheaper than waiting.
11. **Intercity bus** uses the same tool. Stops may snap to off-street bus stations imported from OSM (`amenity=bus_station`), and the routing profile allows motorways.

## Consequences

- The planner's workflow is exactly the proposed one for the common case: click points, the line closes itself, promote stops, move points.
- Two-way lines need one extra click ("Create return") and terminals, and the result exports cleanly to GTFS (two directions, correct stop sides).
- Routing failures and U-turns surface as validation issues instead of silently invalid paths.
- The domain model gains `RoutePoint {seq, kind: via|stop|terminal, edge_ref, direction, kerb_side, pinned_leg?}` under `svc.route`, and terminal rules in Project Preferences.
- More work in Phase 3 (network design) for the return helper and stop pairing.

## Alternatives considered

- **Pure loop for every line** (proposal as written): simplest, but cannot express two-way lines with terminals and layovers, and GTFS export would produce one circular direction for most lines.
- **Draw each direction separately**: common in commercial tools, but doubles the work and drifts out of sync when the planner edits one side.

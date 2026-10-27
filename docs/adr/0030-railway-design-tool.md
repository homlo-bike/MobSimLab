# ADR-0030: Railway design is station-first, drawn to scale from engineering elements

- Status: Accepted (product owner's workflow and confirmation, 2026-10-27)
- Date: 2026-10-27
- Related: FR-NET-02..07, ADR-0009 (unified graph), ADR-0029 (street lines), [06 §9.1–9.3, §9.5](../architecture/06-gis.md#95-railway-design-tool)

## Context

The plan already had alignment elements (line, arc, clothoid), track types, design validations and a station wizard (06 §9.1–9.3), but not the order of work or how things look on the map. The product owner proposed:

1. Start with **stations**: platforms sized for the mode; the planner sets the number of side and island platforms, each platform edge with one track; move and rotate the station. Stations are street level, underground (a thick outline for the station box walls, joining the tunnels) or elevated (a faint outline for the deck edge, joining the bridges).
2. Then draw **tracks** between stations: underground, street level or elevated; drawn as double lines (rails) to scale, with overhead wire or third rail shown if electrified.
3. Connections, switches, crossings and flyovers must be realistic, with no sharp corners. Everything is drawn to scale.

This applies to tram, light rail, metro, regional, intercity and high-speed rail. They differ mostly in numbers (gauge, track spacing, radii, speeds, platform lengths and heights), which come from the mode tables in Project Preferences.

## Decision

Adopt the station-first workflow with these engineering rules.

1. **Stations first.** The station tool places a station box with N side and M island platforms. A side platform has one platform edge and one track; an island platform has two edges and serves the tracks on both sides. Platform length defaults to the longest consist planned for the station plus a margin; platform height and width come from the mode table; the planner can change all of them. The station can be moved and rotated as a whole; tracks through it stay attached.
2. **Station tracks are straight by default.** Platform tracks are straight (or, if the planner allows it, a constant large radius checked by the platform-gap rule). Each station track ends in a **connection point** with a fixed position, direction and level. Tracks from the line must meet these points tangentially, so stations dictate the alignment and not the other way round.
3. **Levels.** Station and track level is `street`, `underground` or `elevated`.
   - Underground: the station box and tunnels are outlined with thick walls. The tunnel type (twin bored, single bored, cut-and-cover) sets the outline width and cost.
   - Elevated: the station deck and viaduct edges are a faint outline.
   - A change of level needs a **ramp/portal element** whose length follows from the maximum gradient for the mode and the vertical curve radius. It is validated against the terrain profile (06 §4).
4. **Tracks are drawn as engineering alignments, never free polylines.** The planner clicks points; the tool fits straights, circular arcs and transition curves (clothoids) between them. It respects the design speed's minimum radius, cant and transition length from the mode table, so there are no sharp corners. The planner can drag tangent points and radii. Double track is one alignment with a track spacing (track-centre distance) from the mode table; single track and extra tracks are also supported.
5. **Switches and crossings come from a catalogue, not free geometry.** Turnouts (for example tram 1:5 R50, mainline 1:9 R190, 1:12 R500, high-speed 1:26.5 R2500), crossovers, scissors crossovers, diamonds and slips have real fixed lengths, angles and diverging speeds. A connection between two tracks is made by placing a catalogue element; the tool refuses geometry that no catalogue element can build. A grade-separated junction (flyover or dive-under) is a level change on one of the tracks, validated like any other ramp.
6. **To scale with level of detail.** All geometry is stored at true size in the project's metric CRS (04 §4).
   - Zoomed in: rails drawn at the real gauge (1,435 mm unless the mode or project says otherwise), platforms at true width, overhead line masts or third rail as symbols on the electrified side.
   - Zoomed out: each track becomes one line, then one line per corridor, because 1.4 m rails are invisible at city scale.
   - Electrification (OCS voltage or third rail) is a track attribute and shown by line style.
7. **Signalling is generated, then editable.** After drawing, the tool proposes block sections, signals at station starters and ahead of switches, and train detection sections, from the line speed and the mode's signalling type (line-of-sight for tram, fixed block, ETCS or CBTC). The rail kernel (07 §4) uses them. The planner can move or add signals.
8. **Tram street running.** Tram tracks at street level along a road are linked to the road edges they occupy: shared lane, reserved lane or segregated. The road graph and the SUMO export are updated, and tram stops on the street use the platform rules for street stops.
9. **Existing infrastructure.** Imported OSM railways can be adopted as existing corridors. They are snapped and converted into alignments with an "existing" flag, so new lines can branch off them using catalogue switches.
10. **Track use: running or storage.** Every track has a use: **running** (part of routes that trains are routed over) or **storage** (stabling sidings and depot tracks where vehicles are parked when not needed). Storage tracks have a usable length checked against the parked consists (07 §4.6), are reached through catalogue switches, and are where trains start and end each run (ADR-0028). A track can be both, for example a platform track used for overnight stabling.
11. **Validation runs live** while drawing (radius, cant, gradient, vertical curves, clearance, platform on curve, switch in platform or vertical curve, tunnel cover, bridge clearance; 06 §9.2). Errors are shown on the element and in the issue list.

## Consequences

- The planner works the way they think: stations where the people are, then the line between them.
- Realism is enforced by construction: only catalogue switches and fitted curves exist, so there are no sharp corners or impossible junctions.
- Mode tables (gauge, track spacing, radii by speed, gradients, platform dimensions, switch catalogue per mode) become a sourced data set in Project Preferences. Initial values come from cited guidance (for example BOStrab and VDV for trams, EN 13803 for track alignment, TSI INF for mainline and high speed) and are marked as assumptions where generic.
- More work in Phase 3: the fitting solver, the switch catalogue and LOD rendering. The kernel data model (TDS, signals) is generated from this geometry.

## Confirmed by the product owner (2026-10-27)

- Each platform **edge** serves one track; an island platform therefore serves two.
- Tracks serve either routing or storage (depot and stabling), as in point 10.
- On high-speed and intercity lines the track alignment, not the station, usually sets the geometry, because their curves have radii of several kilometres.

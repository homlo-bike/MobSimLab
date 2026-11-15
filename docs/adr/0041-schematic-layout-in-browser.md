# ADR-0041: Schematic diagrams laid out in the browser first, LOOM kept for the large-network layout

- Status: Proposed (built: Schematic tab with strip map details, symbols, water and areas)
- Date: 2026-11-10
- Deciders: product owner, architecture
- Related: ADR-0025 (schematics with LOOM), FR-SCH-01..03, 06-gis §10

## Context

ADR-0025 generates schematics with LOOM (`topo`, `loom`, `octi`) run in the tool-runner, then edits the result
in an SVG editor. The tool-runner and a LOOM build are not there yet, while the Schematic tab is needed now:
a network map of the project's lines drawn schematically, a strip map per line with its connections, mode
layers, dragging and curves, and export (FR-SCH-01..03). The networks drawn so far are small (tens of
stations), and ADR-0025 already names a simpler octilinear layout as the fallback.

## Decision

1. **Lines.** The diagram takes every service line in the project: the railway tool's service lines, the street
   line tool's lines and the plugin tools' lines (cable car, ferry). Stops of different lines are one station when
   they have the same name within 400 m, or lie within 40 m. Each line belongs to a mode layer: Bus, BRT, Tram
   (with light rail), Metro, Regional rail, Long distance, Other (plugin modes).
2. **Layout in the browser** (`apps/web/src/features/schematic/layout.ts`). Stations start at their geographic
   place and are moved in a few hundred deterministic steps until every section runs at a multiple of 45°, is
   at least 0.7 of the typical section long, stations keep apart and no station sits on a section it does not
   belong to; a weak pull keeps the map recognisable. Nearly straight sections are then made exactly straight.
   A section that still is not at 45° is drawn as straight–diagonal–straight. The layout needs no server.
3. **Drawing.** Lines that share a section run side by side in a fixed order; corners between stations are
   rounded when *Round the corners* is on. Interchanges are white rings in ink, other stops white rings in the
   line's colour. Names take one of eight places around a station, chosen so they cover no other name, station or
   line where possible.
4. **Edits are kept with the project** as the drawing kind `schematic`: stations the planner moved (metres from a
   fixed origin, so they keep their place when lines are added), name places, the layers switched off and the
   three switches (straighten, round corners, snap while dragging). The automatic layout runs around the moved
   stations. *Reset layout* forgets the moves.
5. **Strip map** per line: the stations in order on a straight band, with the other lines at each station as
   coloured labels.
6. **Export** as SVG (stand-alone, presentation attributes only), PNG (twice the screen size) and the browser's
   print dialog for print and PDF. The diagram carries the project name, a legend of the lines and a footer.
7. **Station features and statuses.** Facilities (step-free access, ramp, lift, escalator, tactile paving,
   toilets, bike parking) are recorded where stations are made: in the railway tool's station panel and on street
   line stops in Create (`features` on the station or saved point). A special status (central station, central
   bus station, airport, seaport, park and ride, hospital, university, stadium) is given in the Schematic tab,
   per diagram station, and saved with the schematic. Both are drawn as symbols (a white glyph on a disc: ink for
   statuses, blue for features) on the network map, the strip map, the legend and the exports; *Status symbols*
   and *Station feature symbols* switch them off. Clicking a station opens a pop-up next to it (Esc, a click
   outside or × closes it) with its stops, platforms, the lines that call there (each opens its strip map), its
   features, its status, its name place and a name rotation (−90° to 90°) for long names. Clicking a line opens
   its strip map.
8. **Water** for orientation: `GET /api/street-network/water?bbox=` returns sea, lakes and rivers from
   OpenStreetMap for a box of at most 1° a side (natural=water, riverbank, reservoir, river and canal centre
   lines, and the sea closed from the coastline, land on its left), simplified to about 1/1500 of the box and
   without areas under 1/20000 of it, cached like the street tiles. The browser asks for the stations' box with a
   margin and bends the water with the stations: each point moves by the stations' moves, weighted by the
   inverse square of the distance, so a river stays between the stations it runs between. Water is drawn under
   the lines and can be switched off; it is not saved with the project.
9. **Tariff zones and landmarks.** Planners draw areas on the network map by clicking corners, give them a
   name, a kind (tariff zone, dashed outline; landmark such as the old town, solid outline) and a colour, and can
   drag the corners later. Corners are saved in the diagram's own metres (like moved stations), so an area stays
   where it was drawn on the diagram.
10. **Strip map details**, drawn in the SVG so they export: vehicles in service, minutes between departures in
    the peak and off-peak, first and last departure, round trip and length; the estimated driving time between
    each pair of stops (without the stop itself: street lines from the routed legs, plugin lines from their runs,
    rail lines from the published timetable); what each section runs on (underground, street level, elevated,
    ramp; rail from the built track's levels, sampled along the line between the stations; street lines on the
    street, cable cars in the air, ferries on the water); and the ground height at each station from the terrain
    service. Rail figures need drawn track: until then they show as –. Street lines run at half their headway in
    the peak, as in the journey planner.

## Consequences

- The Schematic tab works without the tool-runner, offline and in view-only projects.
- For large networks (hundreds of stations) the in-browser layout is slower (the spacing step is quadratic) and
  less tidy than LOOM's. LOOM in the tool-runner stays the plan for that; its output would become the start
  positions, and the planner's moved stations stay as they are.
- Water costs one Overpass request per new box; it is cached on the server and skipped when switched off. A
  network wider than 1° gets the water of its central degree only.
- The water is bent, not laid out: on a strongly straightened map a lake can overlap a line. Planners can
  switch water off or move stations.

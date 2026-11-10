# ADR-0040: Schematic diagrams laid out in the browser first, LOOM kept for the large-network layout

- Status: Proposed (first version built: Schematic tab)
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

## Consequences

- The Schematic tab works without the tool-runner, offline and in view-only projects.
- For large networks (hundreds of stations) the in-browser layout is slower (the spacing step is quadratic) and
  less tidy than LOOM's. LOOM in the tool-runner stays the plan for that; its output would become the start
  positions, and the planner's moved stations stay as they are.
- Water bodies and landmark shapes (FR-SCH-02, 06-gis §10) are not drawn yet; they need OSM water from the
  street network service.

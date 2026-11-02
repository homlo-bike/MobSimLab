# ADR-0033: Railway editor: one Rust geometry crate, run in the browser as WebAssembly

- Status: Proposed (railway editor PR, 2026-11-01)
- Date: 2026-11-01
- Related: FR-NET-02..07, ADR-0030 (railway design tool), ADR-0031 (street routing in the browser), ADR-0032 (railway operations), [06 §9.5](../architecture/06-gis.md#95-railway-design-tool)

## Context

ADR-0030 fixes the railway design workflow: stations first, tracks fitted as straights, clothoids and arcs between station connection points, catalogue switches and crossings, levels with ramps sized from the gradient, everything to scale, and live checks. The product owner added one drawing rule: tracks that meet or cross on the same level are one piece of trackwork (sleepers first, rails on top), with no sharp corners.

The editor has to refit curves and re-run the checks on every drag. Railway operations (ADR-0032) will need the same geometry later (lengths, speeds, switch legs, platform edges), so the fitting must not live only in the browser.

## Decision

1. **One geometry crate.** `crates/rail-design` holds the document model (stations, tracks, switches, all with integer ids that stay the same across edits), the alignment fitter, station layout, switch placement, crossings, checks and the map view. `crates/rail-design-wasm` runs the same code in the editor, as ADR-0031 does for street routing. Operations and the simulation worker will use the crate natively, so there is one implementation of the geometry.
2. **Document in, view out.** The editor keeps the document (JSON) and sends the whole of it on every edit. The engine returns the fitted geometry as GeoJSON layers, connection points, edit handles, summaries and issues. A metro line with two stations and switches builds and draws in 10–40 ms in a release build. Undo, saving and sharing work on the document alone.
3. **Coordinates.** The document stores local metres in a transverse Mercator projection centred on the document's origin (Krüger series, fourth order, WGS84). Distances, radii and spacing are true lengths; only the view converts to longitude and latitude.
4. **Alignment fitting.** At each point the planner clicks, the fitter puts a clothoid–arc–clothoid curve, as in the mockup.
   - The radius is the largest that fits between the neighbouring points, or the planner's radius.
   - Curve speed is v = √((E + I) R / 11.8), with the applied cant clamped to the mode's maximum cant. Embedded tram track has no cant.
   - Transition length is the largest of v·E / (cant change rate), v·I / (cant deficiency change rate) and E / (maximum cant gradient), following EN 13803.
   - A radius below the minimum is an error. A radius below the recommended value is a warning.
5. **Levels and ramps.** There are five levels: underground −2, underground −1, street, elevated +1 and elevated +2. A ramp between two levels is dh / g + Rv·g long, for gradient g and vertical curve radius Rv, and sits next to the deeper or higher end. The track's zones (tunnel, ballast or paving, deck) follow from its ramps.
6. **Switches from the catalogue.** Turnouts, double junctions, crossovers and scissors crossovers are placed from the switch catalogue in the assumption library, with their real lead lengths, radii and crossing angles. They can only be placed on straight track. A turnout's diverging leg is a connection point for a new track. Crossings between tracks on the same level are diamonds. They are an error on high-speed lines and for crossing angles flatter than 1:9.
7. **One piece of trackwork per level.** The map draws one layer stack per level, lowest level first. Within a level, all beds and sleepers come before all rails, so tracks that meet or cross merge. The rails are drawn at the real gauge from zoom 17.5. Below that zoom each track is one line, and below zoom 12.5 each alignment is one corridor line.
8. **Several railway systems in one drawing.** Each station and track has its own mode, and so its own gauge, track spacing, radii, cant, switch catalogue, electrification and train length. A track without a mode takes the mode of the station or switch it starts from, otherwise the network's mode. The panel's mode is the mode for new elements. Changing it does not change what is already drawn. Systems stay separate infrastructure:
   - A track joining a station or switch of another system is a warning, or an error when the gauges differ.
   - Where two systems cross on one level, they share one diamond. Sleepers of both systems are drawn under the rails of both, because each level draws all sleepers before all rails. The crossing follows the stricter rules of the two systems. A flat crossing with a high-speed line is an error. The flattest-diamond limit applies. Different gauges are a warning, because each gauge needs its own frogs and a lower speed. Overhead lines of different supply systems crossing are a warning, because they need an insulated wire crossing with a neutral section. The clearance between two systems is the larger of their clearance marker distances.
   - Every crossing has a stable id made of the two track ids and its number along the first track (for example "x3-7-0"), and it lists both modes. A same-level crossing is a conflict that one train at a time may occupy, whichever system it belongs to. Railway operations (ADR-0032) reserves it like a switch.
9. **Level crossings with streets.** The editor passes the street tiles on screen to the engine: the same OSM tiles the street line tool routes on (ADR-0031). Only roads used by motor vehicles count; a street on a bridge, in a tunnel or on another `layer` is grade separated. Where street-level track crosses a street, the engine makes a level crossing with a stable id (`lc{track}-{OSM way}-{n}`).
   - Ballasted railway track has barriers. Tram track embedded in the street has traffic signals. An embedded tram meeting a street at an angle flatter than the minimum crossing angle runs along it and does not cross it.
   - Checks:
     - A level crossing is an error on modes that do not allow one (metro, high-speed rail), with a third rail, above the highest line speed for level crossings (160 km/h, EBO § 11(2)), and with a motorway (by definition a motorway has no level crossings, Vienna Convention 1968 Art. 1).
     - A crossing flatter than the minimum angle is a warning.
     - A trolleybus wire along the street crossing the railway's overhead line is a warning. With an AC line it cannot be crossed, so trolleybuses drop their poles and run on battery. With a DC line it needs an insulated wire crossing.
   - The view draws the street surface over the sleepers, under the rails, with stop lines and barriers.
   - The topology lists each level crossing for operations and simulation: the rail zone, the stop line distance, the warning time and the approach distance.
10. **New design values in the assumption library.** These were added with sources: the maximum gradient per mode, the vertical curve radius, cant change rates and the maximum cant gradient, the platform edge offset, the track beyond the platform, and the overhead line span. `tools/assumptions/check.py --render` exports the values the engine needs to `crates/rail-design/data/defaults.json`, and `--check-rendered` keeps the export in step. Level crossings use `level_crossing.permitted`, `.max_line_speed_kmh`, `.min_angle_deg` and `.warning_time_s`, `street.lane_width_m`, `street.lanes` and `crossing.clearance_m`.

## Consequences

- The editor needs no server. Railway designs live in the open editor until the network design module stores them, as street lines do (ADR-0031).
- CI and the image build compile a second WebAssembly module (`tools/wasm/build-rail-design.sh`). The web tests load it from disk.
- Railway operations (ADR-0032) reads the design as a track topology from the same crate (`topology` module, `contracts/rail-topology.schema.json`). It contains sections with stable ids split at switch points, the allowed movements through each node, switches with their conflict sections, platform edges, crossings with chainages and fouling points, and depot groups. CI checks every mode's example against the schema.
- Street line routing (ADR-0029) does not yet read the level crossings. It should add the expected waiting time at crossings to running times and depot runs, and plan the battery stretch where a trolleybus loses its wire. The simulation will close the street before a train (07 §5). Pedestrian and cycle crossings are not checked yet.
- Signals and train detection sections (ADR-0030 point 7) are generated in a later step from the same geometry.
- Tunnel cover, bridge clearance and terrain checks wait for the DEM (06 §4). Until then levels are nominal heights from the assumption library.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Fit curves in TypeScript in the editor | Operations and the simulation need the same geometry. Two implementations would drift apart. |
| Fit on the server for every edit | There would be a delay on every drag, and the network design API does not exist yet. |
| Store geometry in WGS84 | Radii, spacing and lengths would need conversion on every check. Local metres keep them exact. |
| Separate map layers per element type | Tracks crossing on one level would draw one track's sleepers over the other's rails. They would not merge into one piece of trackwork. |

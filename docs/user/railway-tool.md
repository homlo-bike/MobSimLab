# Railway tool

Design tram, light rail, metro, commuter, regional, intercity and high-speed railways: stations, tracks, switches and crossings, all to scale. The layout follows the railways tab of the line and track drawing mockup. The design is in [ADR-0030](../adr/0030-railway-design-tool.md) and [ADR-0033](../adr/0033-railway-editor-implementation.md).

## Start

1. Click **Railway** in the top bar. The tool palette appears on the map and the railway panel on the right.
2. Pick the **mode**. Gauge, track spacing, radii, gradients, speeds, platforms and electrification come from the mode. The panel lists the main values; the full set and their sources are in the [assumption library](../../assumptions/DEFAULTS.md).
3. **Example** draws a sample line for the mode at the centre of the map: two stations, a double track with two curves, a crossover, a turnout to a stabling siding and a crossing line. **Clear** removes everything.

The drawing stays while you switch tools or close the railway tool. It is not saved yet.

## Tools

| Tool | Key | What it does |
|------|-----|--------------|
| Select and move | V | Click a station, track, switch or signal to inspect it. Drag a selected station to move it, or its round handle to rotate it. Drag a selected switch or signal along its track. |
| Station | S | Click the map to place a station with the level and platforms set in the panel. |
| Track | T | Draw a track (see below). |
| Turnout | B | Click a straight part of a track to place a turnout, then draw the branch from it. On double track it places a double junction. |
| Crossover | X | Click a straight part of a double track to place a crossover (or a scissors crossover). |
| Signal | G | Click a track, station track or switch leg to place a signal. **F** turns the selected signal round. |
| Pan | H | Move the map without editing. |

**Delete** removes the selected element or point. **Escape** clears the selection or cancels the track being drawn.

## Several railway systems

One drawing can hold several railway systems, for example a tram line crossing a regional railway.

- The mode at the top of the panel is the mode for **new** stations and tracks. Changing it does not change what is already drawn.
- Select a station or track to see or change its **railway system**. Each system keeps its own gauge, track spacing, radii, switches, electrification and train length.
- A track drawn from a station or switch takes that system automatically.
- Joining a track to a station or switch of another system gives a warning. If the gauges differ, it is an error.
- Where two systems cross on the same level, they share one diamond crossing. The sleepers of both are under the rails of both. Only one train at a time may be on the crossing, from either line.
- A flat crossing with a high-speed line is an error. Different gauges, and overhead lines of different supply systems, give a warning, because they need special trackwork and an insulated wire crossing.

The commuter and regional rail examples show a tram line crossing the railway on one diamond.

## Stations

- A new station takes the name of a stop or station within 150 m of its platforms (they are one station), or else a name from the map around it that no other stop or station uses. Renaming a station renames the ones next to it. See [stop and station names](street-line-tool.md#stop-and-station-names).
- A station has side platforms (at most two) and island platforms. Each platform edge serves one track, so an island serves two tracks.
- Platform length comes from the mode. Change it, the name, the level and the platforms in the panel.
- The level is street, underground (−1, −2) or elevated (+1, +2). Underground stations show thick box walls; elevated stations show the deck edge.
- Each end of a station has connection points: one per station track and one for each pair of tracks. Tracks start and end there and leave the station in a straight line.

## Draw tracks

1. Choose **Track** (T) and set single or double track, level, electrification and use (running or storage) in the panel.
2. Click a connection point (shown while drawing) or the map to start.
3. Click to add points. The tool fits a curve at each point: transition curves and an arc with the largest radius that fits, so there are no sharp corners.
4. Finish on a connection point, double-click, or press **Enter**. **+** and **−** move the next points up or down one level; **Backspace** removes the last point.

After drawing, select the track to change it:

- Drag a point to move it. Click a point to set its radius or level, or to remove it.
- Drag the square handles to make the straight out of a station or switch longer or shorter.
- Drag a free end onto a connection point to connect it.
- The panel lists each curve with its radius, transition length, cant and speed, the ramps between levels, and the time from end to end.

Where a track changes level, the tool adds a ramp next to the deeper or higher end. Its length follows from the mode's maximum gradient and vertical curve radius. A track that changes level shows its tunnel, deck and ramp zones.

Double track spreads smoothly to the station's track spacing where it meets a station.

## Switches and crossings

- Switches come from the catalogue for the mode (for example tram 1:5 R50, mainline 1:9 R190, 1:12 R500, high-speed 1:26.5 R2500). Change the element, the side, the direction or the mirror image in the panel.
- Switches go on straight track only, away from ramps and curves.
- Tracks that cross on the same level share one piece of trackwork with a diamond crossing. On high-speed lines, or at angles flatter than 1:9, this is an error: put one track on another level instead.

## On the map

- Zoomed in (from zoom 17.5), every rail is drawn at the real gauge on its sleepers. Overhead line masts and wire, or the third rail, show on electrified tracks. The third rail has gaps at switches and crossings.
- Further out, each track is one line, and below zoom 12.5 each alignment is one line.
- Tracks on the same level merge into one piece of trackwork. Lower levels are drawn under higher ones and paler.

## Level crossings with streets

When the map is zoomed in to zoom 13 or closer, the tool loads the streets on screen. These are the same OpenStreetMap streets the street line tool uses. Wherever street-level track crosses a street used by road vehicles, it makes a **level crossing**. The panel lists them under **Level crossings**; click one to go to it.

- Railway track gets barriers, and tram track embedded in the street gets traffic signals. When zoomed in, the street surface covers the sleepers, the rails stay on top, and the stop lines and barriers are drawn on the street.
- Buses, trolleybuses, depot runs and cars wait at the stop lines. They never stop on the track.
- A street on a bridge or in a tunnel, or a track below or above street level, is not a level crossing. A tram running along a street is not crossing it.
- Warnings for crossings outside the usual rules: a metro or high-speed line crossing a street, a third rail, a line speed above 160 km/h, or a motorway. They can be built, but only with special safety measures, which the warning names: full barriers, obstacle detection, train protection that stops trains while the crossing is not clear, or a gap in the third rail. The panel marks these crossings. Usually a bridge or underpass is the better answer.
- Other warnings:
  - The street crosses at an angle flatter than 45°.
  - A trolleybus wire crosses the railway's overhead line. A tram line needs an insulated wire crossing. On a 15 or 25 kV main line, trolleybuses cross on battery.

Where streets did not load (for example, while signed out), the panel says so and those crossings are not checked.

## Trams in the street

Tram and light rail track at street level is embedded in the street (unless you set the track bed to ballast). Where it runs along a street loaded from OpenStreetMap, the panel lists it under **Street running**:

- **Own lane**: the street is wide enough for the tram's lane and a road lane each way beside it. When zoomed in, solid lines mark the tram lane.
- **In traffic**: it is not, so cars and buses drive on the track and the tram runs with them. Dashed lines mark where the tram runs. On a main road this is a warning, because the tram is held up and runs late. Give it its own lane, or use traffic signals that let the tram go first.
- **Pedestrian zone**: the tram runs at walking pace.

On the street the tram keeps to the street's speed limit (from OpenStreetMap, otherwise 50 km/h). Running times, signals and the track topology use the lower speed. Tram stops on the street get a note on how passengers board: from the pavement, or from an island platform in the middle of the street that needs a pedestrian crossing. Where the tram crosses another street at a junction, that is a level crossing with traffic signals (see above).

## Existing railways

Existing railways are off by default. To use them, open **Account and settings → App settings** and turn on **Show existing railways from OpenStreetMap**. The setting is saved to your account. The editor then loads the railways already built around your design from OpenStreetMap and draws them in purple under it: solid where in use, dashed where under construction, faint where disused, preserved, in a tunnel or on a bridge.

- **Join an existing line**: start or end a track on an existing railway. Clicks within a few pixels of it snap onto it. The end then joins the line instead of being an open track end, and the panel lists it under **Existing railways**. A purple dot marks the join.
- **Checks at a join**: a different gauge is an error, since trains cannot run from one to the other. A different railway system (for example a tram track joining a main line) or a different power supply (overhead line or conductor rail, and the voltage) is a warning: through running needs vehicles built for both. Where the new track meets the line at a sharp angle, rather than running alongside it, there is a warning too. The panel says whether the track continues the existing line at its end or needs a new turnout in it.
- **Crossing an existing line** on the same level is a warning: it needs a diamond crossing in someone else's track and a shared interlocking. Take the new track over or under it. A tram crossing a tram line is fine: the panel just notes the diamond.
- **Drawing on top of an existing line** is a warning: join the existing track instead.

Existing railways cannot be edited, and their stations and signals are not loaded. Where they did not load (for example, while signed out), the panel says so.

## Signals

Railway operations needs signals. Until you make a signal plan, it gets signals generated from the design. **Generate signals** in the panel puts that plan on the map, so you can change it:

- In front of every switch, and at the point on each leg where a train is clear of the other track, there is a main signal. Same-level crossings get one on each side. On storage track these are shunting signals.
- At the ends of platform tracks that lead on, there are starter signals.
- On plain line, block signals in both directions split the line into blocks no longer than a train needs to stop from line speed, plus the sighting distance and the overlap. Metro (CBTC) and high-speed lines (ETCS Level 2) are signalled in the cab, so these are block markers (blue) instead of signals with lights.
- Trams drive on sight. They get signals only at switches and crossings with other railways.

Each signal is drawn on the right of the track, with an arm pointing the way it governs: red for main and block signals, white for shunting, yellow for distant signals. Click a signal to change its kind or name, turn it round, or delete it. Drag it along the track to move it. Signals you place with the Signal tool are added to the plan. **Generate again** replaces the plan, and **Remove plan** goes back to generated signals. If you delete or redraw a track, its signals get a warning.

## Track topology for operations

**Download track topology (JSON)** in the panel saves the drawing as a graph for timetables and train control. It contains track sections, the movements allowed at every switch and join, platform edges, switches, crossings, level crossings with streets, street running, joins to existing railways, signals and depot groups. The format is described in [contracts](../../contracts/README.md). If the design has errors, the file says so (`valid: false`), and the button shows it.

## Checks

The panel lists errors and warnings as you draw. Click one to go to it. Among them:

- radius below the mode's minimum (error) or the recommended value (warning)
- switches that do not fit, overlap, or sit on a curve, ramp or spread zone
- diamond crossings, and crossings between tracks on different levels without a ramp
- tracks closer than the clearance marker distance
- a track running through a station on the same level
- platforms shorter than the train plus 5 m (set the train length under **Trains**)
- a double-track terminus with no crossover
- storage tracks shorter than one train
- open track ends and lost connections

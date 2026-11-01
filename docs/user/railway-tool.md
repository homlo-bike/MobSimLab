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
| Select and move | V | Click a station, track or switch to inspect it. Drag a selected station to move it, or its round handle to rotate it. Drag a selected switch along its track. |
| Station | S | Click the map to place a station with the level and platforms set in the panel. |
| Track | T | Draw a track (see below). |
| Turnout | B | Click a straight part of a track to place a turnout, then draw the branch from it. On double track it places a double junction. |
| Crossover | X | Click a straight part of a double track to place a crossover (or a scissors crossover). |
| Pan | H | Move the map without editing. |

**Delete** removes the selected element or point. **Escape** clears the selection or cancels the track being drawn.

## Stations

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

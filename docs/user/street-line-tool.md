# Street line tool

Draw bus, BRT, trolleybus and intercity bus lines on the street network. The layout follows the line and track drawing mockup. The design is in [ADR-0029](../adr/0029-street-service-line-authoring.md) and [ADR-0031](../adr/0031-street-routing-in-browser.md).

## Start

1. Click **Street line** in the top bar. The tool palette appears on the map and the line panel on the right.
2. Zoom in to street level (zoom 13 or closer). The streets for the area on screen load by themselves, and more load as you move the map. There are no files to load. You need to be signed in. Street data © OpenStreetMap contributors, ODbL.
3. Give the line a **name** and pick the **mode**: Bus, BRT, Trolleybus or Intercity bus. The line takes the mode's colour, and the route is recalculated with that vehicle's rules.

## Tools

| Tool | Key | What it does |
|------|-----|--------------|
| Select and move | V | Click a point to select it; drag it to move it. Click the empty map to clear the selection. |
| Add point | P | Click a street to add the next point. Click on the line to insert a point between two others. |
| Pan | H | Move the map without editing. |
| Preview run | | A vehicle drives the circuit, stopping at every stop. Escape stops it. |

**Delete** removes the selected point. **Escape** clears the selection.

## Draw the line

- Points are routed in order, and the last point is always routed back to the first. The line is a closed circuit: what one vehicle drives in one full cycle. Arrows on the line show the direction of travel.
- New points are **via** points (small circles): they shape the path and carry no passengers. Select a point, in the list or on the map, to make it a **Stop** or an **End stop**, rename it, or delete it. Stops show as numbered squares with their name. A stop takes the street name until you rename it.
- Each stop shows its bus bay to scale on the sidewalk where it is served.
- **Optimise** chooses the travel direction at every via point for the shortest whole circuit. **Clear line** removes all points.

## The panel

- **Stat tiles:** circuit length; stops and end stops; cycle time (running time + dwell at every stop + layover at every end stop); vehicles needed for the headway. Headway, dwell and layover are under *Rules*.
- **Route points:** the circuit in order with the length of each leg. The arrow back to point 1 is the closing leg.
- **Checks:** problems first, then advice. Click a check to select the point it is about.

## Rules the router follows

- Buses never make a U-turn on the street or reverse. They may turn round only at mapped turning circles, turning loops and mini roundabouts. Otherwise the route goes round the block.
- A stop sits on the sidewalk you click next to. In right-hand traffic it is served by vehicles that have it on their right (left in left-hand traffic). A two-way line puts its outbound stops on one sidewalk and its return stops on the other. Stops within the station distance form one station.
- One-way streets (with bus contra-flow lanes), turn bans, `maxheight`/`maxweight`/`maxlength`, barriers and access tags (`bus`, `psv`, `motor_vehicle`, `access`) are respected. City buses do not use motorways; intercity buses may. Guided busways are for BRT only, and BRT prefers bus lanes. Trolleybuses need overhead wire, or a battery range for the stretches without it.
- **Show roads this vehicle may use** draws them in grey. Bus lanes are teal, and overhead wire is green.

## Problems

- **Orange leg:** turning round costs more than the detour limit (500 m by default) or 25 % of the direct distance, whichever is larger. Consider putting the end stop where the vehicle can turn: a bus station, turning loop, roundabout or a block it can drive round.
- **Red dashed leg:** no legal path. A one-way street, turn ban, vehicle limit, or a dead end without a turning circle blocks it.
- **Red point:** no usable road nearby, or a stop on the wrong side of a one-way street.

## Directions and depot

- Two **end stops** split the circuit into direction 0 and direction 1 (used for timetables and GTFS). One end stop, or none, makes a circular line.
- Under **Depot runs**, choose **Place depot gate on the map** and click the depot gate. The tool routes a pull-out from the depot to each terminal and a pull-in from each terminal back, with the same rules. Pick which pull-out and pull-in to show; the grey dashed lines are the runs without passengers. The block builder (Phase 7) picks the ones each vehicle needs.

## Saving

Lines are not stored in the project yet. This arrives with the network design module.

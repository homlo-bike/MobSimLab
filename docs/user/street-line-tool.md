# Street line tool

Draw bus, BRT, trolleybus and intercity bus lines on the street network. The layout follows the line and track drawing mockup. The design is in [ADR-0029](../adr/0029-street-service-line-authoring.md) and [ADR-0031](../adr/0031-street-routing-in-browser.md).

## Start

1. Click **Street line** in the top bar. The tool palette appears on the map and the line panel on the right.
2. Zoom in to street level (zoom 13 or closer). The streets for the area on screen load by themselves, and more load as you move the map. There are no files to load. You need to be signed in. Street data © OpenStreetMap contributors, ODbL.
3. Give the line a **name** and pick the **mode**: Bus, BRT, Trolleybus or Intercity bus. The line takes the mode's colour, and the route is recalculated with that vehicle's rules.

## Saving

The line is saved with the project a moment after each change; there is no Save button. Beside the project name the top bar says **Saving…**, then **Saved**. If the connection drops it says **Not saved yet · trying again** and keeps trying; the browser warns you before you close the page with changes not yet saved. Owners and Editors save; Commenters and Viewers see the project as it was saved.

When you open the tool again, the map moves to the line and its points are routed again from the streets as they are now. The Simulator's journey planner rides the saved line even before you open the tool.

If someone else saved the same drawing while you were changing it, a banner names them and asks which one the project should keep: **Keep mine** saves yours over theirs, **Use theirs** drops your changes and opens theirs. Nothing is saved until you choose. The same goes for the [railway tool](railway-tool.md) and [street setups](gis-streets.md).

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

## Stop and station names

- A new stop (a point you make a stop or end stop) or a new station that is within **150 m** of an existing stop or station takes its name: they are one stop or station for passengers. The street line tool uses the station distance under *Rules* (150 m by default); railway stations are measured to the platform, not the centre. This works across the tools, so a bus stop beside a railway station takes the station's name.
- With nothing that close, the name comes from the map around it (within 500 m): a station or stop already on the map, a landmark, the district, a facility, a street corner ("A / B"), a main street, a street, then a local place name. The note at the bottom of the map says what the name came from.
- Names are unique otherwise. If the best name is already used farther away, the next suggestion is used, or the name gets its district or street, "Market (Old Town)", or a number, "Market 2".
- Renaming a stop or station renames the ones next to it too. A name already used farther away gets a number, and the note says so.
- The 150 m default is the station grouping distance of [06-gis §9.3](../architecture/06-gis.md#93-stations-and-stops).

## Problems

- **Orange leg:** turning round costs more than the detour limit (500 m by default) or 25 % of the direct distance, whichever is larger. Consider putting the end stop where the vehicle can turn: a bus station, turning loop, roundabout or a block it can drive round.
- **Red dashed leg:** no legal path. A one-way street, turn ban, vehicle limit, or a dead end without a turning circle blocks it.
- **Red point:** no usable road nearby, or a stop on the wrong side of a one-way street.

## Level crossings

Where the line crosses a railway on the level, buses wait while the barriers or tram signals close the street. The expected wait is added to the running time of every leg that crosses, so the cycle time, the vehicles needed and the journey planner include it. The panel's **Level crossings** section lists each crossing with its wait per pass, closures an hour and how long the street is closed.

- **Where the crossings come from:** the railway drawn in the railway tool (the last design you built in this session), or a track topology file (**Load track topology**, from the railway tool's **Download track topology**).
- **When trains pass:** without a timetable, the service assumed for the railway: the longest peak headway of its mode in both directions (`timetable.policy_headway_peak_min`, so 8 regional or 24 tram passages an hour), each closing the street for the warning time, the train over the crossing at line speed (the mode's platform length as train length) and the barriers rising (`level_crossing.reopen_s`, 10 s; 5 s for tram signals). With **Load rail timetable closures**, the closures of the planned trains are used instead: `cargo run --release -p rail-plan --example level_crossing_closures -- rail-topology.json lines.json > closures.json`. Trains that stop near the crossing or run slower than line speed close it for longer, and trains meeting there close it once.
- **The wait:** a bus that arrives at a random moment waits Σ c² / (2 T) on average, for closures c in a period T: the chance of meeting a closure times half its length, the same uniform delay as at a traffic signal (HCM). Running times use the busiest hour of the timetable (or the assumed peak); the off-peak value is shown too.
- Crossings of one street within each other's stop lines (two railways side by side) are one place to wait.
- Railway lines own their level crossings and are not delayed by road traffic. Trams drawn in the railway tool cross other railways at diamonds, which the rail timetable handles as conflicts.

## Directions and depot

- Two **end stops** split the circuit into direction 0 and direction 1 (used for timetables and GTFS). One end stop, or none, makes a circular line.
- Under **Depot runs**, choose **Place depot gate on the map** and click the depot gate. The tool routes a pull-out from the depot to each terminal and a pull-in from each terminal back, with the same rules. Pick which pull-out and pull-in to show; the grey dashed lines are the runs without passengers. The block builder (Phase 7) picks the ones each vehicle needs.

## Saving

Lines are not stored in the project yet. This arrives with the network design module.

## Traffic and bus lanes

On main roads, buses in the general traffic take longer at peak than in a bus lane, and the running time includes that delay. The **Reliability** line under the totals shows how much of the circuit runs in main-road traffic and in bus lanes. To give a street a bus lane, or to separate one, set it up in the GIS tab ([Streets in the GIS tab](gis-streets.md)); the line is re-routed at once.


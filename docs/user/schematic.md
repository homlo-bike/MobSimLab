# Schematic

The **Schematic** tab draws the project's lines as a transport map: sections run straight or at 45°, lines that share a section run side by side, and every station that two lines share is an interchange. It also shows each line on its own as a strip map. The design is in [ADR-0041](../adr/0041-schematic-layout-in-browser.md).

## What it draws

Every service line in the project:

- **Rail service lines** from the railway tool (see [Railway tool](railway-tool.md)).
- **Street lines** from the street line tool (see [Street line tool](street-line-tool.md)).
- **Cable car and ferry lines** drawn in Create during this visit.

Stops of different lines are one station when they have the same name within 400 m of each other, or lie within 40 m. Name a bus stop like the railway station next to it and the map shows them as one interchange.

When the project has no lines yet, the tab says so and offers **Go to Create**.

## Network map

- **Layers**: switch modes on and off (Bus, BRT, Tram and light rail, Metro, Regional rail, Long distance, Other modes). A station with no line left on shows no more.
- **Straighten lines to 45° steps**: on, the map is laid out schematically; off, stations stay near their real places.
- **Round the corners**: rounded bends between stations.
- **Snap to 45° while dragging**: a dragged station lines up with its neighbours.
- **Drag a station** to move it. It stays where you put it, also when lines are added; the others are laid out around it. **Reset layout** puts every station back.
- **Click a station** to open its pop-up: how many stops and platforms it has, the lines that call there (click one to open its strip map), the features recorded in Create, and its **Special status** (central station, central bus station, airport, seaport, park and ride, hospital, university, stadium, closed, under construction). There you also choose where its name goes (**Name position**) and turn a long name (**Name rotation**, −90° to 90°). **Let the layout place it** forgets a move. Esc, a click outside or × closes the pop-up.
- **Click a line** to open its strip map.
- **Status symbols** and **Station feature symbols** show or hide the symbols next to station names.
- **Sea, lakes and rivers**: water from OpenStreetMap around the network, bent along with the stations so it stays where it belongs between them.
- **Tariff zones and landmarks**: **Draw an area**, click the map at each corner, then **Finish**. Pick the area in the list to change its name, kind (tariff zone or landmark), colour, or remove it; drag its white corners on the map to change its shape. Tariff zones set the zones of a trip when the [fare revenue table](fare-revenue.md) uses zonal fares.
- Use **−** and **+** to zoom; the zoom level shows beside them. **Fit** fits the whole drawing to the page again.

Moves, name places and rotations, statuses, areas, layers and switches are saved with the project. People who can only view the project see the map and can export it, but cannot change it.

## Station features

Station features (step-free access, ramp, lift, escalator, tactile paving, toilets, bike parking) are recorded where the station is made: in the railway tool's station panel, and on a selected stop in the street line tool, under **Features**. The Schematic tab reads them; it does not change them.

## Strip map

Choose **Strip map** and a line (or click a line on the network map): its stations in order on a straight band, with the lines you can change to at each station as coloured labels underneath, and the station symbols. Above the band, between each pair of stops, is the estimated driving time without the stop itself. Where the line has no time yet (a rail line before its track is drawn), a rough time marked ~ comes from the distance and the mode's usual top speed and acceleration. The lines to change to are grouped by mode, each group on its own row with a small mode sign (long distance, regional rail, metro, tram, BRT, bus, then other modes), so a busy station with many lines stays compact; a station with more than five lines to change to spreads the stations further apart. After each group is the shortest estimated walk to that mode: the distance between the two stops or platforms times 1.3 at 4.5 km/h, at least a minute, plus a minute per level up or down, as in the journey planner.

Below the band:

- **Service**: vehicles in service, headway in the peak and off-peak, first and last departure, round trip, length, average speed (distance over driving time, on sections whose time is known) and how many stations are step-free. Street lines run at half their headway in the peak, as in the journey planner.
- **Runs at**: which parts are underground, at street level, elevated or on a ramp (cable cars in the air, ferries on the water).
- **Step-free stations**: the stations where every stop or platform has step-free access, a lift or a ramp recorded in Create.
- **Ground along the line**: the ground height every 50 m along the street route or the built track (a straight line between stations until there is one), drawn as a side view of the ground as if sliced along the line: length and height to the same scale, as long as the line drawn above it, with the stations marked on the ground. Under it, the **gradient** of each section: the average in running direction and the steepest 50 m.

For rail lines the vehicles, round trip, driving times and levels come from the railway tool's built track and timetable; until track is drawn they show as –.

## Export

- **SVG**: the map as a vector file, for print shops and drawing programs.
- **PNG**: an image at twice the screen size, for slides and messages. A very large network is drawn smaller, at most about 40 megapixels and 8,192 pixels a side, so that image viewers can open it.
- **Print or PDF**: opens the print dialog with only the map; choose *Save as PDF* there for a PDF.

Each export carries the project name, a legend of the lines, water, areas and symbols, and the date. It exports what is on screen: the network map with the layers that are on, or the strip map of the chosen line.

## Not yet

- The LOOM layout for large networks (ADR-0025).

## After a change to the railway

The schematic is laid out from the railway as it was when it was last laid out, and it is saved with the project and in its `.mslab` file. After you change the railway, the tab keeps showing the last one, with a notice that it is **out of date** and a **Recalculate** button; nothing is worked out again until you press it. The same notice shows in the Tables tab, and Recalculate there works them all out again. Project preferences → **Saved project files** shows it next to the worked-out results too.

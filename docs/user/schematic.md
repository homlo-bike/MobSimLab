# Schematic

The **Schematic** tab draws the project's lines as a transport map: sections run straight or at 45°, lines that share a section run side by side, and every station that two lines share is an interchange. It also shows each line on its own as a strip map. The design is in [ADR-0040](../adr/0040-schematic-layout-in-browser.md).

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
- **Click a station** to see the lines there and choose where its name goes (**Name position**: automatic or one of eight places). **Let the layout place it** forgets a move.
- Use **−**, **+** and **Fit** to zoom.

Moves, name places, layers and switches are saved with the project. People who can only view the project see the map and can export it, but cannot change it.

## Strip map

Choose **Strip map** and a line: its stations in order on a straight band, with the lines you can change to at each station as coloured labels underneath.

## Export

- **SVG**: the map as a vector file, for print shops and drawing programs.
- **PNG**: an image at twice the screen size, for slides and messages.
- **Print or PDF**: opens the print dialog with only the map; choose *Save as PDF* there for a PDF.

Each export carries the project name, a legend of the lines and the date. It exports what is on screen: the network map with the layers that are on, or the strip map of the chosen line.

## Not yet

- Rivers, lakes and landmarks on the map.
- The LOOM layout for large networks (ADR-0025).

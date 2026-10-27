# Street line tool

Draw bus, BRT, trolleybus and intercity bus lines on the street network. The design is in [ADR-0029](../adr/0029-street-service-line-authoring.md) and [ADR-0031](../adr/0031-street-routing-in-browser.md).

## Start

1. Click **Street line** in the top bar.
2. Load a road network as OSM XML. Until the project OSM import is ready (Phase 2), get one with
   `python tools/osm/overpass_fetch.py --bbox S,W,N,E --out area.osm` or with **Export** on openstreetmap.org.
   Road data © OpenStreetMap contributors, ODbL.
3. Pick the **mode** and the **traffic** side. The grey lines show the roads this vehicle may use (for a trolleybus, green lines have overhead wire).

## Draw the line

- **Click the map** to add points in order. Each point is routed from the one before, and the last point is always routed back to the first, so the line is a closed circuit: what one vehicle drives in one full cycle.
- **Click on the line** to insert a point into that leg. **Drag** a point to move it; only its two legs are re-routed. Select a point and press **Delete**, or use ×, to remove it.
- New points are **via** points (shape the path, no passengers) unless you choose **Stop** under *New points*.
- In the point list, switch a point between **Via**, **Stop** and **End** (end stop). Stops can be renamed; otherwise they take the street name, or "Street A / Street B" near a junction.
- **Optimise** chooses the travel direction at every via point for the shortest whole circuit.

## Rules the router follows

- Buses never make a U-turn on the street or reverse. They may turn round only at mapped turning circles, turning loops and mini roundabouts. Otherwise the route goes round the block.
- A stop sits on the sidewalk you click next to. In right-hand traffic it is served by vehicles that have it on their right (left in left-hand traffic), so a two-way line puts its outbound stops on one sidewalk and its return stops on the other. Stops on opposite sidewalks form one station group.
- One-way streets (with bus contra-flow lanes), turn bans, `maxheight`/`maxweight`/`maxlength`, barriers and access tags (`bus`, `psv`, `motor_vehicle`, `access`) are respected. City buses do not use motorways; intercity buses may. Guided busways are for BRT only, and BRT prefers bus lanes. Trolleybuses need overhead wire, or a battery range for the stretches without it.

## Problems

- **Orange leg:** turning round costs more than 500 m or 25 % of the direct distance (whichever is larger). Consider putting the end stop where the vehicle can turn: a bus station, turning loop, roundabout or a block it can drive round.
- **Red dashed leg:** no legal path. A one-way street, turn ban, vehicle limit, or a dead end without a turning circle blocks it.
- **Red point:** no usable road within 150 m, or a stop on the wrong side of a one-way street.

## Directions and depot

- Two **end stops** split the circuit into direction 0 and direction 1 (used for timetables and GTFS). One end stop, or none, makes a circular line.
- **Place depot** and click the depot gate. The tool routes a pull-out from the depot to each terminal and a pull-in from each terminal back, with the same rules. The block builder (Phase 7) picks the ones each vehicle needs.

## Saving

Lines are not stored in the project yet (this arrives with the network design module). Use **Export** to download the line as GeoJSON.

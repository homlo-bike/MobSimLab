# Network tables

The **Tables** tab opens with three tables about what the project builds and runs. The cost tables follow below them ([Cost tables](cost-tables.md)). Like the cost tables, they read what is drawn in the project: the railway design and its service lines from the railway tool, and the street lines.

## Summary

Tiles for the whole project: the number of lines and modes, route length (railway and street lines), stations and stops, the fleet with spares and the vehicles in service at the peak, vehicle-km a year, peak capacity (places an hour in one direction, all lines), and the route length in tunnel and on bridges and viaducts. Below them, **Per mode** gives each mode's lines, route length, stations or stops, fleet and vehicle-km a year.

## Infrastructure quantities

- **Railway**, one column per mode and a total: route length and track length (route × tracks), double and single track, route length by construction type (the same types as the cost tables: street level, elevated guideway, viaduct, bridge, ramp, cut and cover tunnel, bored tunnel), stations by level, platform edges, switches and crossings, level crossings with streets and with footpaths or cycle paths, track in streets (own lane, in road traffic, pedestrian zone), lineside signals, and the steepest gradient with its track and the mode's limit. Rows that are zero for every mode are left out. The gradients come from the terrain heights (Copernicus GLO-30), which the tab loads under the track; if they do not load, the table says so.
- **Street lines**, one row per line: route length (one direction), stops, and the round trip's kilometres on main roads in bus lanes or busways and in road traffic, and level crossings.

## Service and fleet

One row per line, rail service lines first: length, stops, average stop spacing, trip time end to end with the stops, average speed (length over trip time), how often it runs (peak, and off peak for rail lines), service hours with the first and last departure, trips a day in both directions, fleet with spares and the vehicles at the peak, places per vehicle or train, and capacity an hour in one direction at the peak headway. Click a column heading to sort.

- Rail line lengths are straight between the stations the line calls at, as in the cost tables. Trip times, trips and trains come from publishing the lines' timetables on a weekday.
- Fleet and vehicle-km are the same numbers the cost tables use. Rail fleets count units: 4 trains of 2 coupled units are a fleet of 8.
- Street lines have no first and last departure and no catalogue vehicle yet, so their service hours (`cost.service_hours_per_day`) and places per vehicle (`mode.vehicle_capacity`) come from the assumption library and are marked "assumed".

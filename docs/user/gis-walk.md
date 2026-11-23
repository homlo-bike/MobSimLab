# Walk coverage and stop spacing in the GIS tab

The GIS tab measures how well the project's stops serve the people round them: how much of the area is within a short walk of a stop or station, where the largest gaps are, and whether the stops along each line are too close together or too far apart. It uses the project's saved [street lines](street-line-tool.md) and the stations and service lines of the [railway tool](railway-tool.md).

## Walk to a stop

1. Open the project's **GIS** tab. **Walk to a stop** is under the street setup.
2. **Walk limit, minutes** starts at the project's walk rule: 15 minutes unless the project changed `analysis.walk_rule_minutes`. Any value from 1 to 30 minutes works. Tick **Step-free** to leave out steps.
3. Tap **Calculate walk coverage**. The footpaths round the stops load from OpenStreetMap (the first time can take a moment), then where people live (WorldPop, as for the noise map).

The result says what share of the residents round the lines live within the walk limit of a stop or station, along streets and footpaths, with a wait at each signalised crossing (`walk.crossing_delay_s`, 20 s) at the project's walking speed (`demand.walk_speed_kmh`, 4.5 km/h). Next to it is the share in a straight line, for comparison: real walks are longer. The table splits everyone by the walk to the nearest stop in 5-minute bands.

**Largest gaps** lists the ten places, in blocks of about 200 m, with the most people beyond the walk limit, with the walk to the nearest stop. Tap one to go to it on the map, where it is a numbered red circle.

On the map, a soft shaded area shows the minutes on foot to the nearest stop: green within 5, yellow within 10, orange within 15. Where there is no shading, the walk is longer than the limit. **Show on the map** turns the layer off and on.

The area measured is the box round all the stops plus the distance walked in the limit. Only the streets within that walking distance of a stop are loaded, at most 256 map tiles (about 25 km × 25 km), so a city-wide network fits. Where the population of the country is still downloading to the server, or there is none, the walkable street length stands in for people, and the panel says so.

Walks are timed on the slope of each street, in the direction people walk to the stop, with Tobler's hiking function: a walk up a 10 % slope takes about 1.4 times as long as on the flat, and a gentle walk down is a little quicker. The ground heights come from the project's imported elevation, else Copernicus GLO-30, in 30 m squares. The steepness term is the journey planner's (Project preferences → All parameters → Walking on slopes); 0 times every walk as flat. Where the heights do not load, walks are timed as flat and the panel says so.

## Stop spacing

Under the walk coverage, each line has a card with the median, shortest and longest distance between consecutive stops along the line, against the usual range for its mode (`mode.stop_spacing_m`, for example 250–600 m for a bus and 300–800 m for a tram). Pairs of stops closer than the range are marked **too close**, pairs further apart **too far apart**, and both are drawn on the map. Tap a pair to go to it.

Street lines are measured along their route, each direction on its own. Rail service lines are measured in a straight line between stations for now. After the walk coverage is calculated, each marked pair also shows the distance on foot between the two stops.

Cable car and ferry lines from the plugin tools are not saved with the project yet, so they are not counted.

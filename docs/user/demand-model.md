# Demand model

The **Tables** tab's **Demand model** section forecasts trips on a weekday with a four-step model: trip generation, distribution, mode choice (public transport, car, walking and cycling) and assignment to the streets and the published lines. It runs on the server with [AequilibraE](https://www.aequilibrae.com) for the morning peak, midday, evening peak and evening. The design is in [ADR-0019](../adr/0019-demand-model-aequilibrae.md) and [09 §2](../architecture/09-planning-models.md).

Every value the model uses (trip rates, period shares, gravity parameters, mode choice coefficients, value of time, road capacities and speeds, convergence limits) is in **Project preferences → Demand model**, with the library's range and sources. Change any of them for the project, or set it back.

## Zones

The model area is everything within `demand.area_buffer_m` (2 km by default) of the published lines.

- **Automatic hexagons** cover the model area. Their size is the smallest of the H3 sizes (about 0.1, 0.7, 5 or 36 km²) that keeps the count within `demand.zone_max_count` (600 by default).
- **Upload zones (GeoJSON)** replaces them with your own: a FeatureCollection of Polygons or MultiPolygons in WGS 84. Properties named like a zone value fill it: `population` (or `pop`), `workers`, `children`, `retail_jobs`, `other_jobs` (or `jobs`), `schools`, `universities`, `hospitals`, `clinics`, `tourism`, `pupils` (or `students`), `visits`, `parking_cost` and `cbd`. The `id` and `name` properties name the zone.
- **Make these zones my own** turns the hexagons into zones you can change.
- In the **GIS** tab, **Demand zones** shows the zones on the map. You can draw a new zone, redraw a zone's outline, rename it or delete it.
- **Download zones** saves the zones with your values as GeoJSON.

**Estimate zone values** loads what the model needs to know about each zone. People come from WorldPop. Workers and children come from the World Bank's employment and age shares. Retail and other jobs come from the floor area of OpenStreetMap buildings, as in the benefit tables. Schools, universities, hospitals and clinics come from OpenStreetMap places. Grey numbers in the zone table are these estimates. Type a number to use your own, and clear it to go back to the estimate. Tick **Centre** for the central business district; otherwise the job density decides.

## Running

**Run the demand model** sends the zones, the published lines (their stopping patterns, running times and headways in each period) and the country's GDP per person and price level to the server. The server adds the OpenStreetMap streets around the zones. A run of a few hundred zones takes about a minute.

## Cycling, walking and getting to the stops

The model counts what makes walking, cycling and reaching a stop easier or harder. Every value below is in **Project preferences → Demand model → Catchment**.

- **Cycle lanes and tracks.** A metre on a separate track counts as less than a metre on a plain street (`demand.cycle.factor.track`), a painted lane a little less (`demand.cycle.factor.lane`), and a main road without either counts as more (`demand.cycle.factor.busy_road`). Lanes and tracks come from OpenStreetMap (`cycleway=*`) and from the bike lanes you set up in the GIS tab's street setup, where **separated** makes a track.
- **Street setup.** The traffic lanes and bus lanes you set in the GIS tab change road capacity. A bus lane is not a car lane.
- **Pedestrian streets.** Walking along a pedestrian or living street counts as shorter (`demand.walk.pedestrian_factor`). A car trip into a zone takes longer by `demand.pedestrian_zone.car_min` times the share of the zone's streets that are pedestrian.
- **Bike and ride.** People with a bicycle may ride up to `demand.bike_ride.max_m` to a stop with a bike parking within `demand.bike_ride.parking_max_m`, and park (`demand.bike_ride.parking_min`). Bike parkings come from OpenStreetMap.
- **Shared bikes.** Where a shared-bike station is within `demand.shared_bike.station_max_m` of both ends, people without a bicycle can cycle too, and everyone can ride a shared bike to or from a stop. Each ride takes unlocking time and a fare. Stations come from OpenStreetMap and, if you enter it, from your scheme's **GBFS feed** in the Run card (its `gbfs.json` or `station_information.json`, an https address).
- **Step-free stops.** Boarding at a stop recorded in Create without step-free access, a lift or a ramp costs more for the share of riders who cannot use steps (`demand.step_free.share`, `demand.step_free.penalty_min`). Stops with no recorded features are not penalised.

The results show what the model area has of each and what it did: trips on a shared bike, riders who cycle to a stop and park, and shared-bike rides to and from stops.

## Results

- Trips by mode and period, and by purpose.
- For each line: boardings, the peak load an hour and the busiest stretch.
- The busiest stops, and the strongest public transport desire lines between zones.
- How many street links come near their capacity.
- **Download trip tables (OMX)**: the origin–destination matrices per mode and period, and for the weekday, in the open OMX format.

## Using the results as the project's ridership

Under a finished run, **Use this run for ridership** makes its boardings the project's ridership instead of the Tables tab's formula estimate:

- the benefit tables' **Riders a weekday** and **Boardings a year**, per line, per mode and in total (the model's number is the medium value; low and high keep the formula's spread);
- the service table's **Riders a day** column;
- the fare revenue table, which spreads each line's trips over its stations with the model's boardings;
- the system test's passenger loads, by stop.

Boardings you typed for a stop in the system test still come first. **Go back to the formula estimate** undoes the choice.

## Calibrating to observed data

The **Observed data** card above **Run** takes what you know about travel in the area:

- the share of trips by car, public transport, walking and cycling, in % (give all four; they are scaled to 100 %);
- the mean length of a car trip, in km;
- weekday boardings of lines and stops, typed in the table or uploaded as CSV with the columns `kind` (`line` or `stop`), `id` (the line's or stop's id or name) and `value`. An uploaded file is added to the counts already there.

With observed data, a run calibrates itself. It repeats the model, moving the mode constants (relative to car) towards the observed shares and scaling the deterrence of every purpose towards the observed car trip length, until they are within the tolerance or the round limit. Without shares, counts move the public transport constant. The results then show the observed and modelled shares and trip length, the counts with the largest GEH (computed on the weekday count spread over the hours in Project preferences), the %RMSE of the counts, the share of counts with a GEH under 5, and counts that name no line or stop of the network.

**Save fitted values to Project preferences** keeps the constants and deterrence the run ended with, so later runs start from them. The rounds, damping, tolerance and GEH hours are in Project preferences → Demand model → Calibration.

Without observed shares or counts, results are marked **Uncalibrated**: the numbers come from library values only.

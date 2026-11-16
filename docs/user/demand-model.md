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

## Results

- Trips by mode and period, and by purpose.
- For each line: boardings, the peak load an hour and the busiest stretch.
- The busiest stops, and the strongest public transport desire lines between zones.
- How many street links come near their capacity.
- **Download trip tables (OMX)**: the origin–destination matrices per mode and period, and for the weekday, in the open OMX format.

Results are marked **Uncalibrated** because no observed counts have been used yet. Calibration comes in a later step.

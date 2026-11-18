# 06 — GIS architecture

## 1. Responsibilities

- Import and keep reference geodata (OSM, population, elevation, external transit data) per project area.
- Provide the **unified transport graph** used by every router and simulator.
- Serve all map content as layers with consistent controls.
- Carry attribution and licences for every dataset into the UI and exports.

## 2. OpenStreetMap import

Read-only. The OSM editing API is never called (ADR-0010).

### 2.1 Two import paths

| Path | When | How |
|------|------|-----|
| Overpass | Area ≤ configurable threshold (default 400 km²) or incremental refresh of a few classes | Overpass QL per feature class, `[out:json][timeout:N][maxsize:M]`, bbox/polygon filter, split into tiles if a query times out |
| PBF extract | Larger areas, or offline installs | User uploads a `.osm.pbf` or picks a Geofabrik region (downloaded via gateway); `osmium extract` to the project polygon; `osm2pgsql --output=flex` with our Lua style into `geo` staging tables |

Both paths end in the same normalised tables, so the rest of the system does not care which was used. Each import records the OSM data timestamp (`osm_base`/replication timestamp) as a `Source` with ODbL licence.

### 2.2 Feature classes and tags (initial mapping)

| Class | Main OSM tags | Table |
|-------|---------------|-------|
| Roads | `highway=*` (excluding `proposed`, `construction` unless enabled) | `geo.osm_way_road` |
| Railways | `railway=rail|light_rail|subway|tram|narrow_gauge|monorail|funicular` with `usage`, `service`, `gauge`, `electrified`, `voltage`, `maxspeed` | `geo.osm_way_rail` |
| Buildings | `building=*`, `building:levels`, `height` | `geo.osm_building` |
| Waterways / water | `waterway=*`, `natural=water`, `water=*` | `geo.osm_water` |
| Parking | `amenity=parking`, `parking=*`, `capacity` | `geo.osm_poi` (class=parking) |
| Schools, universities, hospitals | `amenity=school|university|college|hospital|clinic` | `geo.osm_poi` |
| Shops | `shop=*` | `geo.osm_poi` |
| Employment areas | `landuse=commercial|industrial|retail`, `office=*` | `geo.osm_landuse`, `geo.osm_poi` |
| Land use | `landuse=*`, `leisure=park` | `geo.osm_landuse` |
| Stops / stations | `public_transport=*`, `highway=bus_stop`, `railway=station|halt|tram_stop|platform` | `geo.osm_pt` |
| Bridges / tunnels | `bridge=*`, `tunnel=*`, `layer` | attributes on ways + `geo.osm_structure` |
| Barriers | `barrier=*` | `geo.osm_barrier` |
| Cycleways | `highway=cycleway`, `cycleway*=*`, `bicycle=designated` | `geo.osm_way_road` flags |
| Pedestrian | `highway=footway|pedestrian|steps|path`, `sidewalk=*`, `footway=crossing` | `geo.osm_way_road` flags |

Tag mappings are data (a YAML file under source control), not code, so they can be reviewed and extended.

- Built so far (ADR-0046): both paths, per project area (the box around everything drawn plus the project's
  buffer). The GIS tab's **Map data** view starts an import, shows its progress and the current one, and offers
  Refresh. Overpass areas go up to `MOBSIMLAB_OSM_OVERPASS_MAX_KM2` (400 km²) in tiles that split on timeouts;
  larger ones use a Geofabrik region holding the whole area or an uploaded `.osm.pbf`, cut with `osmium extract`.
  `osm2pgsql` loads the flex style `tools/osm/mobsimlab-flex.lua` with the data-file mapping
  `tools/osm/tag_mapping.lua` (Lua, as osm2pgsql has no YAML parser) into the tables above, keyed by project and
  import (`db/migrations/0017_osm_dem_import.sql`, runs in `geo.import`). Street, walk and rail tiles, buildings,
  schools and hospitals and water read the import where it covers them and Overpass otherwise. Code:
  `apps/api/src/geodata`, `apps/web/src/features/geodata`.

### 2.3 Overpass client requirements (from brief)

| Requirement | Design |
|-------------|--------|
| Configurable endpoint | Provider record; several endpoints with priority and fail-over |
| Throttling | Token bucket per endpoint (default 1 concurrent, 1 req / 5 s); honours `/api/status` slot information |
| Retry with backoff | Exponential with jitter (2, 4, 8, 16, 32 s), max 5, only on 429/502/503/504/timeouts |
| Geographic limits | Max area per query; automatic quadtree split; project-level max area |
| Timeout handling | Query `timeout` < HTTP timeout; on timeout, split and retry smaller tiles |
| Caching | Response cache keyed by normalised query hash, TTL configurable (default 7 days), stored on the data volume |
| Provider health | Periodic `/api/status` probe; status green/amber/red shown in the Providers admin page and import dialog |

## 3. Population, land use and demand drivers

| Source | Use | Resolution | Licence |
|--------|-----|-----------|---------|
| WorldPop (constrained, per year) | Primary population | 100 m | CC BY 4.0 |
| GHSL GHS-POP | Primary population (alternative / cross-check) | 100 m, 1 km | CC BY 4.0 (JRC) |
| GeoTIFF upload | User raster (census grid) | any | user declares |
| GeoJSON upload | Zone polygons with attributes | — | user declares |
| CSV upload | Points (lat/lon) or join to zone ID | — | user declares |
| OSM POIs + land use | Jobs, retail, schools, hospitals proxies | — | ODbL |
| CAMARA Population Density API | Optional adapter, operator-dependent | — | contract |

Every population layer stores `source`, `confidence` (user-set or derived from source docs), `timestamp` (reference year), `resolution`, `coverage` (polygon). When two sources overlap the user chooses which is primary; the other can be shown as a difference layer.

Rasters are clipped to the project area buffered by 2 km, reprojected to the working CRS, and stored as tiled `raster`. Zone aggregation uses area-weighted `ST_SummaryStats`.

- Built so far: the API reads WorldPop's constrained 100 m grid (release R2025A, the current year or the nearest one it has) for the noise map's population exposure (ADR-0038). WorldPop's file server does not answer byte ranges, so each country's GeoTIFF is downloaded once into `MOBSIMLAB_DATA_DIR/worldpop` (the `/data` volume; at most `MOBSIMLAB_WORLDPOP_MAX_FILE_MB`, default 2,000, per file and `MOBSIMLAB_WORLDPOP_CACHE_MB`, default 6,000, in all, least recently used first out) and read tile by tile (`apps/api/src/gateway/worldpop.client.ts`, catalogue `MOBSIMLAB_WORLDPOP_API`). The countries of an area come from OpenStreetMap through Overpass. `POST /api/population/grid` answers the people per cell over a box, or `loading` while a country is still downloading.
- Built so far, per project (`apps/api/src/population`, migration `0014_population.sql`, tables `geo.population_layer` and `geo.population_feature`):
  - **Project area**: the box around everything drawn in the project (street lines, depots, regions, cargo-bike areas and the railway), widened by a buffer the planner sets (`project.project.area_buffer_km`, default 2 km, 0 to 50). A planner can instead pick one or more OpenStreetMap regions (boundaries and named places, admin levels 4 to 11) in the new-project dialog or Preferences, Area (`project.project.area_regions`, at most 10, outlines thinned to 1,500 points); the area is their union, and imports cover the regions' box joined with the buffered drawing. Saving the regions queues the OpenStreetMap (Overpass up to its limit, else the smallest Geofabrik region), elevation and WorldPop imports once, skipping those that already cover the area (`PUT /api/projects/:id/area`, #140). An import covers at most `MOBSIMLAB_POPULATION_MAX_AREA_KM2` (default 10,000 km²).
  - **Imports**: WorldPop (as above, any year from 2015 to 2030) and GHSL GHS-POP R2023A (`apps/api/src/gateway/ghsl.client.ts`; default 3 arc seconds, about 100 m, or 30 arc seconds; the epoch nearest the year asked, 1975 to 2030 in steps of 5). GHSL comes in 10° tiles zipped on the JRC server; each tile is downloaded once into `MOBSIMLAB_DATA_DIR/ghsl` (`MOBSIMLAB_GHSL_URL`, `_PATH`, `_MAX_FILE_MB` 1,000, `_MAX_TIF_MB` 2,000, `_CACHE_MB` 6,000, `_TILE_DEG`, `_ORIGIN_LON`, `_ORIGIN_LAT`). A tile the server does not have is sea. The cells of the project area are stored as polygons with their people; the import runs in the background and the layer shows its progress.
  - **Uploads** (`POST /api/projects/:id/population/uploads`, at most `MOBSIMLAB_POPULATION_UPLOAD_MB`, default 200, and `MOBSIMLAB_POPULATION_MAX_FEATURES`, default 2,000,000, features): a GeoTIFF grid (people per cell or per km², any common compression and data type, optionally clipped to the project area), GeoJSON zones or points with a people field, a CSV of points, or a CSV of values per zone id joined to zones uploaded before. Coordinate systems are read from the file (GeoTIFF keys, the legacy GeoJSON `crs` member) or given as EPSG code, PROJ string or `.prj` WKT, and converted with proj4js (`apps/api/src/population/crs.ts`). Each layer records its licence, source address, citation, confidence and reference year.
  - **Primary layer**: one ready layer per project can be chosen; the noise map, the walk analysis and the benefit tables then read it (`POST /api/projects/:id/population/grid` and `/catchments`) instead of WorldPop live. People of zones and points are spread over a lattice of cells whose centres lie inside them.
  - **Map and difference**: `POST /api/projects/:id/population/lattice` puts a layer, or one layer minus another, on a lattice of a chosen cell size (default 500 m) for the GIS tab's Population view.
  - Raster tables (`postgis_raster`) would need a superuser to install, so grids are stored as cell polygons. Changes are written to the audit log.

**Jobs:** there is no global open jobs grid. Jobs are estimated from land use and POIs with sourced job-density assumptions (per m² of commercial/industrial floor area, per school/hospital), clearly marked as assumptions, and replaceable by uploaded employment data.

**Regions (ADR-0040).** The benefit tables read population per station catchment from the same WorldPop grid (`POST /api/benefits/population` sums its cells) and jobs from OpenStreetMap building floor area. Planners can draw regions or import OpenStreetMap areas (`GET /api/benefits/osm-areas`) and give them land use, land value, tax revenue, population density, jobs, GDP per person and employment; these take priority over the sourced values (drawing kind `regions`).

## 4. Elevation

- Copernicus GLO-30 DEM tiles (downloaded via gateway, licence recorded) imported per project area; user GeoTIFF overrides (e.g. LiDAR DTM).
- Alignment profiles sampled every 50 m (configurable) with bilinear interpolation, plus at every vertex and structure boundary.
- DEM accuracy stored as metadata and shown next to every gradient result (C-09).
- Open-Elevation and Elevation-API.eu adapters as fallbacks for areas without imported DEM, with batching (up to provider limit per request) and caching.
- Built so far: the API reads GLO-30 straight from the public COG bucket with range requests (`apps/api/src/gateway/copernicus-dem.client.ts`, endpoint `MOBSIMLAB_COPERNICUS_URL`) and serves `POST /api/terrain/points` and `POST /api/terrain/profile` (several lines per request, optional OpenStreetMap buildings each line passes over). The web helper `apps/web/src/terrain/terrain.ts` is the one shared source for the railway and cable car tools. The GLO-30 cells of a project area are imported into `geo.dem_tile` (float32 tiles, ADR-0046) from the same
  **Map data** view and read first, with the live bucket for points outside them. Where neither answers, heights
  come from Open-Elevation (`apps/api/src/gateway/open-elevation.client.ts`, `MOBSIMLAB_OPEN_ELEVATION_URL`, off
  with `MOBSIMLAB_ELEVATION_FALLBACK=off`); answers name every source used. A planner's own GeoTIFF
  (any coordinate system, resampled to WGS 84 at about its own resolution, `apps/api/src/geodata/dem-upload.ts`)
  is stored with a higher priority and wins where it has heights. The Elevation-API.eu adapter comes later.

## 5. External data providers

All providers implement one interface:

```text
ProviderAdapter
  id, displayName, kind (rest | tiles | file | ogc)
  configSchema           JSON Schema for admin config
  credentialSchema       which secrets it needs (stored encrypted)
  healthCheck()          -> green | amber | red + message
  fetch(request)         -> data via gateway, cached
  sourceRecord()         -> Source entry (name, URL, licence, retrieved at)
```

| Provider | Purpose | Notes |
|----------|---------|-------|
| WorldPop | Population rasters | REST catalogue + file download |
| GHSL | Population rasters | File download from JRC |
| Open-Elevation, Elevation-API.eu | Elevation fallback | Rate-limited |
| Mobility Database | Find GTFS/GBFS feeds for an area | Catalog API, needs refresh token |
| GTFS | Import existing schedules | Upload or URL |
| MobilityData GTFS Validator | Validate imports and exports | Local JRE tool, no network |
| GBFS | Bike/scooter stations for catchment | Auto-discovery `gbfs.json` |
| Transit Costs Project | Benchmark construction costs per km | Link, not bundled, until licence confirmed |
| World Bank | GDP deflators, PPP, value of time inputs | CC BY 4.0 API |
| OC4IDS | Import/export infrastructure project cost data | JSON schema mapping |
| Nager.Date | Public holidays per country/year | Cached per year |
| Weather API | Weather scenarios (rain affects demand and dwell) | Pluggable, user endpoint |
| OpenRouteService | Optional comparison isochrones only | Not used by simulation |
| CAMARA | Population density from operators | Adapter only |

## 6. Unified transport graph (ADR-0009)

### 6.1 Structure

```text
net.node   id, kind, geom, z, level, attrs
           kind ∈ intersection | stop | station | platform | switch | depot_gate
                  | track_end | signal_point | portal | access_point
net.edge   id, from_node, to_node, kind, geom, length_m, attrs, allowed_modes bitset
           kind ∈ road_lane_group | rail_track | walk | cycle | transfer | depot_internal
```

- **Road edges** are built from OSM and user edits, with lanes, speed, turn restrictions, bus lanes, trolleybus wires (`attrs.overhead_wire`).
- **Rail edges** are the design-level track segments (from OSM rail or user alignments), split at every switch, signal, platform end and track type change. Direction and bidirectional operation are attributes.
- **Walk and cycle edges** come from OSM footways/cycleways and road edges with sidewalks/cycle lanes; transfer edges link platforms within a station and stops within a station group.
- **Switch nodes** carry allowed through-movements (which incoming edge can connect to which outgoing edge) so rail routing never makes impossible moves.

### 6.2 One routing library, many views

- The graph is stored in PostGIS (source of truth).
- At job start, the worker builds an in-memory, **mode-specific view** (CSR adjacency arrays) in Rust from the same tables. Algorithms: Dijkstra, A* (Euclidean heuristic in working CRS), Yen's K-shortest paths, time-dependent Dijkstra for transit, all from `pathfinding`/`petgraph`.
- **SUMO network is generated from the unified graph** (our exporter writes SUMO `.nod.xml`/`.edg.xml`/`.con.xml`/`.tll.xml`, then `netconvert`), and SUMO is given **explicit routes** for transit vehicles. SUMO's own rerouting is only enabled for background traffic. This avoids two engines deciding transit paths differently.
- The demand model's network (AequilibraE) is also exported from the unified graph.
- External routing services (OpenRouteService) are never used inside the model.

## 7. Layers

Everything visible is a `Layer`:

```text
Layer  id, projectId|null, kind (basemap | vector | raster | sim | schematic | analysis)
       source (tileUrl | api | file), style (MapLibre style JSON fragment)
       visible, opacity, minZoom, maxZoom, order, legend, attribution[], sourceIds[]
```

Built-in layers: roads, buildings, vehicles, stops, stations, railways, bridges, tunnels, water, population, elevation (hillshade + contours), land use, congestion (from runs), service lines, signals, depots, schematics, validation issues, catchments, demand desire lines.

- User layer settings are stored per user per project; project defaults set by project owners.
- Vector layers are MVT from PostGIS. Simulation layers are deck.gl layers fed by the WebSocket frame stream.
- The attribution control aggregates attributions of all visible layers; OSM/ODbL is always present when any OSM-derived layer is visible. Exports (PNG, PDF, SVG) render the same attribution block.

## 8. Basemaps

| Basemap | Source | Default |
|---------|--------|---------|
| OpenFreeMap Liberty / Bright / Positron | `tiles.openfreemap.org` styles | Positron default |
| Sentinel-2 Cloudless 2016 | EOX WMTS | Available (CC BY 4.0) |
| NASA GIBS: HLS Sentinel-2, HLS Landsat 8 and 9 (about 30 m), VIIRS NOAA-20 (about 250 m) | `gibs.earthdata.nasa.gov` WMTS, bundled plugin `org.mobsimlab.nasa-gibs`, a day picked in the layer control | Available (NASA data, no key) |
| Sentinel-2 Cloudless 2018+ | EOX WMTS | Disabled; admin must acknowledge non-commercial licence |
| Esri World Imagery | Esri ArcGIS Location Platform (`ibasemaps-api.arcgis.com`), bundled plugin `org.mobsimlab.esri-imagery`, tiles through `/api/basemaps/esri/tiles/{z}/{y}/{x}` | Off until an Admin saves an ArcGIS API key and accepts Esri's terms (*Administration → Plugins*); the key stays on the server and tiles are not stored |
| Offline styles | PMTiles/MBTiles on the data volume, served by the API | For air-gapped installs |
| External WMTS / WMS / XYZ | Admin or project config | Optional username/password, proxied (C-18) |

Protected layers are always proxied by the `gateway` tile proxy which injects credentials server-side, enforces allowlists, caches tiles (respecting provider terms; Esri tiles are not cached), and rate-limits.

### 8.1 Street photos

Street-level photos help planners check a street before drawing on it: lanes, kerbs, tram track, stops. They come from plugins with a `streetPhotos` contribution (bundled only, because the API implements each source):

| Source | Plugin | Key | How |
|--------|--------|-----|-----|
| Panoramax, the federated open street photo commons (photos mostly CC BY-SA 4.0 or Etalab 2.0, which allow mapping from them) | `org.mobsimlab.panoramax` | None | Coverage as vector tiles from `api.panoramax.xyz` (in `MAP_ORIGINS`); photos near a point from the meta-catalog's STAC search, through `/api/street-photos/panoramax/near`; pictures through `/api/street-photos/panoramax/photos/<collection>_<picture>/<thumb or sd>` |

The map's **Street photos** button opens a panel that draws the source's coverage (sequence lines, and from zoom 15 one dot per photo). While it is open, a click on the map goes to the panel, not to the open tool, and lists the photos within 30 m, nearest first, with date, author, distance, licence and a link to the source's own viewer. Closing the panel gives the tool its clicks back.

The API reads picture addresses from the catalogue and fetches them with the outbound gateway's rules (ADR-0017): https on public hosts only, checked after every name lookup and after each of at most three redirects, images only, a size limit. So the browser never contacts the federation's picture hosts. Nothing is stored: photos are not cached by the API, not saved with a project and not in `.mslab` exports. The static viewer has no API, so it offers no street photos.

## 9. Network design tools

### 9.1 Railway alignment

- Segment types: **line**, **circular arc**, **transition curve** (clothoid by default; Bloss as option). Alignment stored as a sequence of typed elements (station/chainage, length, radius start/end, cant) in the working CRS, plus the computed polyline for display.
- Track types: surface, elevated, underground, bridge, existing corridor (snaps to OSM rail), ramp (between levels), depot track. Track type sets defaults for structure costs, clearance rules, and elevation behaviour (underground and elevated alignments carry a design vertical profile independent of terrain).
- Vertical profile: grades and vertical curves; terrain sampled every 50 m from DEM to compute cover depth (underground), clearance (elevated, bridges), and cut/fill (surface).

### 9.2 Validations

| Check | Warning | Error |
|-------|---------|-------|
| Horizontal radius | < recommended (mode table and vehicles) | < minimum |
| Transition length | < recommended for speed and cant | missing between straight and arc above speed threshold |
| Cant / cant deficiency | > recommended | > maximum |
| Gradient | > recommended | > maximum for mode or any assigned vehicle |
| Vertical curve radius | < recommended | < minimum |
| Clearance (structures, other tracks, buildings) | envelope within margin | envelope intersects |
| Tunnel | cover < recommended for method (cut-and-cover vs bored) | negative cover; intersects other tunnels |
| Bridge | span/clearance over road/water < recommended | < minimum navigational or road clearance |
| Platform on curve | radius < recommended for platform gap | gap exceeds standard |

All thresholds are editable tables per project, initial values sourced (e.g. national rail design guidance, VDV/BOStrab for trams) and marked as assumptions where generic. Issues appear as a validation layer and a list; each issue links to the offending element and to the rule's source.

### 9.3 Stations and stops

- **Automatic naming** (FR-NET-05), first match wins within configurable radii: (1) existing OSM/GTFS station, (2) existing stop, (3) OSM landmark (`tourism`, `amenity=townhall`, `historic`, notable `building` with `name`), (4) nearest named street (two streets → "A / B" at intersections), (5) district (`place=suburb|quarter|neighbourhood` or admin level). The chosen rule and source are stored; the user can override, and overrides are never replaced automatically.
- **Grouping:** stations/stops within a configurable walking distance (network distance, default 150 m) form a `StationGroup`. Interchange stations behave as one for passenger routing (transfer edges with walking time) and naming.
- **Station creation wizard:** choose 1–2 side platforms and N island platforms; the wizard generates tracks through the station, platform edges, platform lengths from the longest planned consist, and default access objects (stairs, lifts, ramps, escalators) with accessibility metadata (step-free route, lift dimensions, tactile paving).
- **Platform validator** per section 5 of [08-vehicles.md](08-vehicles.md#5-vehiclesinfrastructure-compatibility-checks).

### 9.4 Street-based service lines

Bus, BRT, trolleybus and intercity bus lines are drawn with the route-point tool (ADR-0029, FR-NET-11a):

1. The planner clicks points on the map in order. Each leg is routed on the mode's road profile (access, one-ways, turn bans, vehicle dimensions and turning radius, trolleybus wire and battery range, BRT lane preference), and the last point is routed back to the first, so the route is always a closed circuit. A two-way line is a circuit that passes stops on both sidewalks.
2. Points start as via points and can be promoted to stops (and demoted). Stops are placed on the sidewalk; the sidewalk fixes the street side, and the stop can only be served by traffic that has it on the door side, so the router approaches it in that direction.
3. U-turns and reversing are never allowed. If a vehicle must go back along the same street, the router goes round the block. Long turn-round detours raise a warning advising the planner to put the end stop where vehicles can turn (bus station, turning loop, roundabout).
4. Stops within the grouping distance (including the pair on opposite sidewalks) form one station group with the first stop's name.
5. End stops carry layover and recovery rules and split the circuit into directions for timetables and GTFS.
6. Moving, inserting or deleting a point re-routes only the two adjacent legs; network edits mark affected legs stale.
7. Vehicles start in their depot. The block builder adds routed pull-out and pull-in trips between the depot gate and the first and last stops of each block (07 §7–8).

Implementation: `crates/street-routing` (router and route-point model), run in the editor as WebAssembly (ADR-0031). How to use it: [street line tool](../user/street-line-tool.md).

### 9.5 Railway design tool

Station-first workflow for tram, light rail, metro, regional, intercity and high-speed rail (ADR-0030):

1. Place stations: side and island platforms (one track per platform edge), sized from the mode table and the longest planned consist; move and rotate; level street, underground (thick station-box and tunnel walls) or elevated (faint deck and viaduct edges).
2. Draw tracks between station connection points: the tool fits straights, arcs and clothoids that meet the mode's minimum radius, cant and transition rules, so there are no sharp corners. Double track uses the mode's track spacing.
3. Connect tracks only with catalogue switches and crossings (turnouts, crossovers, diamonds, slips) with real geometry and diverging speeds. Level changes use ramp/portal elements sized from the maximum gradient.
4. Everything is stored at true size; the map shows rails at real gauge with OCS or third-rail symbols when zoomed in, and simplifies to single lines when zoomed out.
5. Each track is for running (routing), storage (depot and stabling, with usable length checked against parked trains) or both.
6. Signals and train detection sections are generated from line speed and signalling type, then editable; tram street running links tracks to road lanes.
7. Validations from §9.2 run live while drawing.

Implementation: `crates/rail-design` (document model, alignment fitting, stations, switches, crossings, checks and map view), run in the editor as WebAssembly (ADR-0033). Stations and tracks each have a mode, so several railway systems share one drawing; where they cross on one level they share a diamond that is a single conflict for operations. Operations reads the design as a track topology (`contracts/rail-topology.schema.json`). Street-level track crossing an OSM street (the street line tool's tiles) becomes a level crossing with checks: warnings that name the special safety measures needed for a level crossing on a metro or high-speed line, above 160 km/h line speed, with a third rail or with a motorway; a warning for skewed crossings and for trolleybus wires crossing the railway's overhead line. Level crossings are part of the topology. Signals, train detection, tram street running, existing OSM corridors and terrain checks are still to come. How to use it: [railway tool](../user/railway-tool.md).

## 10. Schematic diagrams (ADR-0025)

- **Generation:** the network's lines per mode layer (Bus, BRT, Tram, Metro, Regional Rail, Long Distance) are exported as a line graph (GeoJSON) to LOOM (`topo` → `loom` line ordering → `octi` octilinear layout), run by the tool-runner. Water bodies from OSM are simplified (Douglas–Peucker + area threshold) and transformed with the same displacement field to keep rivers recognisable.
- **Storage:** the result becomes an editable `Diagram` (nodes = stations with diagram coordinates and label placement; edges = line bundles with ordered lines and control points). It keeps links to network objects, so renames and new stations propagate; a "re-layout" preserves user-pinned nodes.
- **Editing (SVG in the browser):** drag stations (with snapping to octilinear angles, optional), curve edges (cubic Béziers with corner radius), simplify lines, toggle layers, edit labels, add water/landmark shapes.
- **Export:** SVG and PDF with attribution block; PNG for quick sharing.

Built so far (ADR-0041): the Schematic tab lays the diagram out in the browser (octilinear relaxation) instead of LOOM, with mode layers, dragging, rounded corners, name places, a strip map per line and SVG, PNG and print or PDF export, water from OpenStreetMap, tariff zones and landmarks, station symbols and strip map details. LOOM is still to come. How to use it: [Schematic](../user/schematic.md).

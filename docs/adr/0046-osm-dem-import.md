# ADR-0046: OpenStreetMap and GLO-30 elevation imported into PostGIS per project area

- Status: Proposed (first version built: GIS tab, Map data view)
- Date: 2026-11-16
- Deciders: product owner, architecture
- Related: 06-gis §2 and §4, ADR-0010 (OSM read only), spike S3 (`docs/spikes/s3-osm-import.md`), the population
  import (project area and buffer)

## Context

Until now every tool asked Overpass and the Copernicus GLO-30 bucket for each map tile and terrain profile it
needed. That is slow for large areas, depends on public servers staying up, and gives no fixed data date for a
plan. 06-gis §2 and §4 describe imports per project area instead. The product owner asked (2026-11-16) for the
OpenStreetMap and elevation import into PostGIS, the area being the box around everything drawn plus a buffer
(2 km by default, set per project), with the planner's own elevation GeoTIFF overriding GLO-30, with the large-area path (Geofabrik or an uploaded `.osm.pbf`), an
"Import map data" button with Refresh, the existing tools reading the imported tables with the live services as
a fallback, an Open-Elevation fallback, and every limit adjustable.

## Decision

1. **Area.** The project area is the polygons the planner draws in the area window (New project, Select area;
   Preferences, Edit area), each with a detail setting (Full, or Main roads and railways only). Since 2026-11-19
   there is no buffer and no area from the drawing. Every import follows the polygons, not the box round them:
   Overpass asks only for the tiles that meet a polygon, every OpenStreetMap path ends in `osmium extract -p` with
   the polygons as a GeoJSON MultiPolygon, elevation reads and keeps only the tiles that meet a polygon, and the
   population import keeps only cells whose centre lies in one. Area limits count the polygons' own km². An import
   records the polygons it covered (`options.area`), so the Map data view asks for a refresh only when a polygon
   is new or larger. Nothing outside the polygons imports by itself: a GIS region reaching outside asks before
   downloading, and editing the area asks before downloading new parts. Drawings reaching outside the polygons
   (street lines, the railway, depots, the cargo bike route, ferry and cable car lines) show a warning under the
   notifications button, since there is no map data there.
   **Main roads and railways only** (2026-11-23): such a polygon is cut out on its own and filtered with
   `osmium tags-filter` to motorway, trunk and primary roads and their links, turn restrictions, railways and the
   coastline before it is merged with the Full polygons. Population cells outside Full polygons are summed into
   30″ cells (population/coarsen.ts). Map tiles (zoom 14) that touch only main polygons are light: the street
   tile asks for main roads only (cache key `roadmain/x/y`, import filter `roadMain`), walk, building and place
   tiles are empty, and `GET /api/street-network/main-tiles` lists them so the street line editor loads the
   corridor's tiles in batches even zoomed out, and the router uses main roads there. It also lists the Full
   polygons' tiles, which the editor loads with `?light=1` (main roads only), so a route runs through the towns
   between the corridors before the map shows them. A tile touching a Full
   polygon has full detail. The .mslab map data follows the same rule.
2. **Two OpenStreetMap paths, one result.** Areas up to `MOBSIMLAB_OSM_OVERPASS_MAX_KM2` (400 km²) come from the
   Overpass API in tiles (`MOBSIMLAB_OSM_OVERPASS_TILE_KM`, split into quarters on a timeout or size error down to
   `..._MIN_TILE_KM`, one request every `..._INTERVAL_S`, cached for `MOBSIMLAB_OSM_CACHE_DAYS`). Larger areas, up
   to `MOBSIMLAB_OSM_MAX_AREA_KM2`, come from Geofabrik: for each polygon the smallest region that holds it, so
   polygons in two countries download both countries (each downloaded once and kept
   `MOBSIMLAB_GEOFABRIK_CACHE_DAYS`), each cut to the polygons and merged with osmium; the data timestamp is the
   oldest of them. Product owner's choice, 2026-11-19. Or the data comes from an uploaded `.osm.pbf` (up to `MOBSIMLAB_OSM_PBF_MAX_MB`). Every path
   ends in `osmium extract -s smart` to the area and `osm2pgsql --output=flex` with `tools/osm/mobsimlab-flex.lua`
   into a staging schema, copied into the `geo.osm_*` tables with the project and import id. The tag mapping is
   the data file `tools/osm/tag_mapping.lua` (06-gis §2.2), now with planned roads (optional per import),
   kindergartens, doctors, coastline and bridge and tunnel structures.
3. **Elevation.** The GLO-30 cells of the area are read from the public bucket and stored as 256 px float32
   tiles (deflated, with a one-pixel overlap so bilinear sampling stays in one tile) in `geo.dem_tile`. Raster
   types are not used: `postgis_raster` needs a superuser to install. Area limit `MOBSIMLAB_DEM_MAX_AREA_KM2`.
4. **Runs.** An import is a row in `geo.import` (queued, running, done, failed, cancelled) run in the API process
   one at a time, with progress and Cancel. A new import replaces the earlier one of its kind only when it
   finishes, so a failed or cancelled run leaves the current data in place. Runs left unfinished by a restart are
   marked failed. Each import records its source (OpenStreetMap, ODbL 1.0, with the data timestamp and path, or
   Copernicus GLO-30 with its licence and accuracy) and is written to the project's audit log.
5. **Readers.** Street, walk and rail tiles, buildings, schools and hospitals, water and terrain heights take the
   project (`?project=` on tiles, `projectId` in terrain bodies, read access checked) and answer from the import
   where it covers the request; otherwise they use the live services as before. Tiles are cut from the project's
   extract file with osmium, so their XML is the same as Overpass's. Terrain answers name every source used.
6. **Fallback heights.** Where neither the import nor the live GLO-30 bucket answers, heights come from an
   Open-Elevation server (`MOBSIMLAB_OPEN_ELEVATION_URL`, batched, cached), shown as source `open_elevation` with
   its lower accuracy. `MOBSIMLAB_ELEVATION_FALLBACK=off` never sends points there.
7. **The planner's own grid.** An uploaded GeoTIFF of heights in metres (such as a LiDAR terrain model), in
   any coordinate system the population import's reader and proj4 converter know (or one the planner gives as
   EPSG code, PROJ or WKT), is resampled bilinearly to a longitude and latitude grid over the project area at
   about its own resolution (coarser if it would pass `MOBSIMLAB_DEM_UPLOAD_MAX_CELLS`, 25 million) and stored
   like the GLO-30 tiles with a higher priority, so it wins where it has heights. The planner names its source,
   licence and vertical accuracy, which go into its Source record; Remove brings GLO-30 back.
8. **Tools in the image.** `osmium-tool` and `osm2pgsql` run as separate programs (GPL), never linked.
9. **One store for the instance** (2026-11-23, `db/migrations/0028_shared_data.sql`). Map data fetched live is
   held once for the instance in `geo.shared_data`, keyed by kind, key and data date (when it was fetched):
   OpenStreetMap tiles (`osm`, such as `road/x/y`), terrain heights (`height`, a rounded point) and the byte ranges
   read from the GLO-30 cell files (`glo30`, `cell/offset/length`; an empty body means the cell does not exist).
   A project points at the copies its tools used (`project.data_use`, project, kind and key to one copy), so its
   data keeps its date until it is fetched again. A second project in the same area takes the newest copy already
   held instead of downloading it: OpenStreetMap copies while they are younger than `MOBSIMLAB_OSM_CACHE_DAYS`,
   heights and GLO-30 ranges always, since they do not change. An older OpenStreetMap copy is fetched again and
   held as a new copy with its own date; the projects pointing at the old one keep it. Copies no project points at
   are removed once they are older than `MOBSIMLAB_OSM_CACHE_DAYS` (checked at most hourly); deleting a project
   removes only its pointers. The elevation import reads its GLO-30 ranges through the same store, so a second
   project's import downloads nothing. The Overpass tile files and Geofabrik extracts on the data volume were
   already held once for the instance. Each project's imported tables (`geo.osm_*`, `geo.dem_tile`) stay its own
   cut of the area, made from the shared downloads. The migration moves the tiles and heights the projects kept in
   `project.data_cache` (0022) into the store, holding equal copies once.

## Consequences

- A project's map data has a fixed date until the planner refreshes it, and works when the public servers are down.
- The data volume holds the Geofabrik downloads and each project's extract; the database holds the tables and the
  shared store of fetched map data, which grows with the area all projects cover rather than with their number.
- The project area is shared with the population import (`projects/project-area.ts`); it is changed only in the
  area window, and the Map data view then asks for a refresh.

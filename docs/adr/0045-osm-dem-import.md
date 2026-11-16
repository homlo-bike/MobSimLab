# ADR-0045: OpenStreetMap and GLO-30 elevation imported into PostGIS per project area

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
(2 km by default, set per project), with the large-area path (Geofabrik or an uploaded `.osm.pbf`), an
"Import map data" button with Refresh, the existing tools reading the imported tables with the live services as
a fallback, an Open-Elevation fallback, and every limit adjustable.

## Decision

1. **Area.** The project area is the box around every coordinate in the project's drawings, grown by the
   project's buffer. An import records the box it covered. When the drawing reaches outside it, the panel says so
   and the planner refreshes; nothing imports by itself.
2. **Two OpenStreetMap paths, one result.** Areas up to `MOBSIMLAB_OSM_OVERPASS_MAX_KM2` (400 km²) come from the
   Overpass API in tiles (`MOBSIMLAB_OSM_OVERPASS_TILE_KM`, split into quarters on a timeout or size error down to
   `..._MIN_TILE_KM`, one request every `..._INTERVAL_S`, cached for `MOBSIMLAB_OSM_CACHE_DAYS`). Larger areas, up
   to `MOBSIMLAB_OSM_MAX_AREA_KM2`, come from a Geofabrik region that holds the whole box (downloaded once and
   kept `MOBSIMLAB_GEOFABRIK_CACHE_DAYS`) or an uploaded `.osm.pbf` (up to `MOBSIMLAB_OSM_PBF_MAX_MB`). Every path
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
7. **Tools in the image.** `osmium-tool` and `osm2pgsql` run as separate programs (GPL), never linked.

## Consequences

- A project's map data has a fixed date until the planner refreshes it, and works when the public servers are down.
- The data volume holds the Geofabrik downloads and each project's extract; the database holds the tables.
- A planner's own elevation GeoTIFF (priority over GLO-30) uses the population import's GeoTIFF reader and comes
  in the next step.

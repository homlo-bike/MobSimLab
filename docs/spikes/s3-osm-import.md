# Spike S3: OSM import (PBF and Overpass paths)

- Date: 2026-10-27
- Status: **Pipeline done, regional benchmark pending.** Both paths import into the same tables with tag mapping v0. The 1-million-inhabitant timing must run on GitHub Actions, because this development environment cannot reach Geofabrik or Overpass (HTTP 403 from the network proxy).
- Code: [`tools/osm`](../../tools/osm), workflow [`osm-benchmark.yml`](../../.github/workflows/osm-benchmark.yml)
- Related: [06 §2](../architecture/06-gis.md#2-openstreetmap-import), ADR-0009

## What was built

- `mobsimlab-flex.lua`: osm2pgsql flex style writing to `geo.osm_way_road`, `osm_way_rail`, `osm_building`, `osm_landuse`, `osm_water`, `osm_pt`, `osm_poi`, `osm_barrier`, `osm_place`. Geometry in EPSG:4326, all tags kept as `jsonb`, main attributes as columns. The target schema is set by `MOBSIMLAB_OSM_SCHEMA`, so both paths can be compared side by side.
- `tag_mapping_v0.lua`: the tag mapping as a pure data file (classes and tags from 06 §2.2). It is Lua rather than YAML because osm2pgsql's Lua runtime has no YAML parser. The data-not-code rule still holds.
- `overpass_fetch.py`: small-area client, standard library only. It has a configurable HTTPS endpoint and an identifying User-Agent. It throttles to one request per 5 s and retries on 429/502/503/504 and timeouts, with backoff (2–32 s) and jitter. It refuses areas over 400 km² and caches responses by query hash. It makes read-only queries only and never touches the OSM editing API.
- `s3_benchmark.sh`: runs both paths and prints times, row counts and table sizes.

## Local results (fixture)

Fixture: Liechtenstein extract of 2013-08-03 from the osm2pgsql test data (0.6 MB PBF, about 38,000 inhabitants). PostGIS 17-3.5 in Docker, osm2pgsql 1.11.0.

| Table | Rows | Size |
|-------|------|------|
| osm_building | 3,723 | 1.1 MB |
| osm_way_road | 2,749 | 1.1 MB |
| osm_pt | 319 | 152 kB |
| osm_poi | 269 | 104 kB |
| osm_landuse | 149 | 184 kB |
| osm_water | 96 | 112 kB |
| osm_barrier | 57 | 56 kB |
| osm_way_rail | 34 | 56 kB |
| osm_place | 18 | 56 kB |
| **Total** | | **2.9 MB** |

PBF import took 0.27 s. The Overpass path was tested with the same importer on OSM XML: a 3.4 km² box around Vaduz, cut with `osmium extract`, imported into `geo_overpass` (255 roads, 72 buildings). The HTTP fetch itself could not be run here.

A naive linear extrapolation (about 2.9 MB per 38,000 inhabitants) suggests 0.1–0.3 GB of tables for a 1-million region. That figure is not a measurement: the benchmark run below replaces it.

## Pending: regional benchmark

After this PR is merged, run **Actions → OSM import benchmark (Spike S3) → Run workflow**. The defaults are region `europe/germany/bremen` (about 570,000 inhabitants; pick a larger extract such as `europe/germany/nordrhein-westfalen/koeln-regbez` for more than 1 million) and a small bbox for the Overpass path. The report is uploaded as an artifact and will be copied into this document.

## Findings

- One flex style serves both paths because osm2pgsql reads PBF and OSM XML alike, so the rest of the system does not need to know where data came from.
- The OSM data timestamp is available from the PBF header (`osmosis_replication_timestamp`) for the Source record. For Overpass, it is the `osm_base` attribute of the response.
- Phase 2 work: tiling and quadtree split for Overpass timeouts, the provider status probe, polygon (not just bbox) extracts with `osmium extract -p`, incremental refresh, and moving the import into the sandboxed tool-runner.

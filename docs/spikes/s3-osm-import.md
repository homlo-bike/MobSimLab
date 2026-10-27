# Spike S3: OSM import (PBF and Overpass paths)

- Date: 2026-10-27
- Status: **Done.** Both paths import into the same tables with tag mapping v0. The regional benchmark ran on GitHub Actions ([run 40515611225](https://github.com/homlo-bike/MobSimLab/actions/runs/40515611225)) for Regierungsbezirk Köln, about 4.4 million inhabitants. It found one bug in the Overpass query, fixed below.
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

## Regional results (Regierungsbezirk Köln)

Run on a GitHub-hosted ubuntu-24.04 runner, PostGIS 17-3.5 service container with default settings, osm2pgsql from Ubuntu 24.04.

### PBF path

Geofabrik extract `europe/germany/nordrhein-westfalen/koeln-regbez`: 215 MB, data as of 2026-10-25T21:21Z. Download took 15.3 s and the flex import 62.6 s.

| Table | Rows | Size |
|-------|------|------|
| osm_building | 2,271,216 | 799 MB |
| osm_way_road | 636,254 | 212 MB |
| osm_landuse | 195,391 | 106 MB |
| osm_poi | 137,003 | 52 MB |
| osm_pt | 44,039 | 17 MB |
| osm_barrier | 163,262 | 34 MB |
| osm_water | 66,449 | 25 MB |
| osm_way_rail | 12,505 | 6.9 MB |
| osm_place | 4,275 | 1.2 MB |
| **Total** | | **1,254 MB** |

Per million inhabitants this is about **285 MB of tables and 14 s of import**. Buildings are 64 % of the storage. The earlier extrapolation from the fixture (0.1–0.3 GB per million) was at the top of its range.

### Overpass path

Box `50.932,6.945,50.948,6.970` (3.1 km², Köln city centre). The first request got HTTP 502 and the retry succeeded. The fetch took 107 s in total and returned 161 MB of XML. The import took 2.3 s and wrote 40 MB of tables.

| Table | Rows | Size |
|-------|------|------|
| osm_way_rail | 29,171 | 21 MB |
| osm_way_road | 25,021 | 12 MB |
| osm_pt | 6,160 | 2.7 MB |
| osm_building | 4,620 | 2.2 MB |
| osm_poi | 2,810 | 1.3 MB |
| osm_barrier | 1,934 | 440 kB |
| osm_water | 988 | 776 kB |
| osm_landuse | 174 | 120 kB |
| osm_place | 11 | 24 kB |
| **Total** | | **40 MB** |

**Bug found.** The box returned more rail ways (29,171) than the whole Regierungsbezirk (12,505). The query took every relation touching the box, including train, tram and bus route relations, and then recursed into all their members. That pulled in whole lines far outside the box. The flex style only reads multipolygon relations, so the query now asks only for nodes, ways and multipolygon relations in the box (`overpass_fetch.py`, `build_query`). The Overpass timings above are therefore pessimistic and should be measured again with the fixed query.

### Default import limits

- **PBF is the default** for anything larger than a district. A region of several million people imports in about a minute and needs about 0.3 GB of tables per million inhabitants, plus indexes and the PBF itself. Setup should warn when the free disk is below three times the expected size.
- **Overpass is for small areas only.** The 400 km² hard limit stays. The suggested default is 25 km², pending the re-measurement with the fixed query.
- Public Overpass servers fail transiently (one 502 in this run), so retries with backoff are required, as implemented.

## Findings

- One flex style serves both paths because osm2pgsql reads PBF and OSM XML alike, so the rest of the system does not need to know where data came from.
- The OSM data timestamp is available from the PBF header (`osmosis_replication_timestamp`) for the Source record. For Overpass, it is the `osm_base` attribute of the response.
- PostgreSQL warned that checkpoints were too frequent during the PBF import. The production container should raise `max_wal_size` for imports.
- Phase 2 work: tiling and quadtree split for Overpass timeouts, the provider status probe, polygon (not just bbox) extracts with `osmium extract -p`, incremental refresh, and moving the import into the sandboxed tool-runner.

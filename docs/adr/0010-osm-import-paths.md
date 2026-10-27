# ADR-0010: OSM import via Overpass for small areas and PBF extracts for large areas

- Status: Proposed
- Date: 2026-10-27
- Related: FR-GIS-01..03, C-08

## Context

The brief names Overpass and forbids bulk queries against the OSM editing API. Public Overpass instances have fair-use limits and time out on large areas.

## Decision

- Overpass client with all required behaviours (configurable endpoints, throttling, retry/backoff, area limits, timeouts, caching, health) for areas up to a configurable threshold and incremental refreshes.
- PBF path (`osmium` + `osm2pgsql` flex) for larger areas, from uploads or Geofabrik downloads.
- Both write the same normalised tables; tag mapping is a reviewed YAML file.
- OSM editing API is never called.

## Consequences

- `osmium-tool` (GPL-3.0) and `osm2pgsql` (GPL-2.0-or-later) ship in the image as separate programs.
- Offline installs supported via PBF upload.

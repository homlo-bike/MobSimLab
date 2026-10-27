# ADR-0024: MapLibre GL for the map, deck.gl for moving vehicles and heavy overlays

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: NFR-PERF-01, FR-GIS-06

## Context

The map shows static vector layers and thousands of animated, multi-section vehicles.

## Decision

MapLibre GL JS for basemaps and vector layers (MVT from PostGIS). deck.gl in interleaved mode for vehicles (instanced polygons per section), trajectories, flows and heatmaps. Layer configuration model is shared so both appear as "layers" to the user.

## Consequences

Two rendering libraries to learn; both MIT/BSD; well-proven combination.

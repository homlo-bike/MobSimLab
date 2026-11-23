# ADR-0021: Versioned `.mslab` ZIP project format with JSON Schemas

- Status: Accepted (architecture PR approved by product owner, 2026-10-27)
- Date: 2026-10-27
- Related: FR-PLAT-04, C-17

## Context

Projects must be saved, exported, imported and carry custom vehicles. Code may break compatibility before 1.0, user data must not.

## Decision

ZIP with `manifest.json`, NDJSON per entity, GeoJSON geometry, custom vehicles, assumptions, sources, generated `ATTRIBUTION.md`, optional run results and attachments. Semantic format version with forward migrations; published JSON Schemas. Import in sandboxed tool-runner with zip-bomb limits.

## Alternatives considered

| Option | Why not |
|--------|---------|
| GeoPackage (SQLite) | Good for geometry; less friendly for diffs and partial reads of non-spatial data; can be added as an optional export |
| pg_dump subset | Tied to DB internals |

## Consequences

Migration code for every format change; tests with fixture files of each version.

## Implementation (2026-11-16)

- Format 1.0.0 is built in `apps/api/src/mslab` with the layout of [10 §2.2](../architecture/10-collaboration-storage.md#22-project-file-format-mslab-adr-0021). Agreed with the product owner: each saved drawing is one JSON file `data/<kind>.json` in the shape the editor saves it, instead of NDJSON per entity, because the tools save whole documents; nothing is lost and the round trip is exact.
- Opening a file always creates a new project owned by the person who opens it. Run ids are always new; the project id is new too, so ids never conflict.
- Run results are optional (**Include saved simulation runs**); only finished runs are saved, with the replay of road runs.
- Custom vehicles, attachments, signatures and the "full export" with reference data are not in format 1.0.0, because projects cannot hold them yet; they are additions for a later minor version.
- JSON Schemas are in `contracts/mslab`, generated from `format.mts` and the editors' drawing outlines and checked by `apps/api/test/mslab-schemas.test.ts`.
- The import runs in the sandboxed tool-runner (`apps/api/src/tool-runner`), the first part of the tool-runner of ADR-0003.

## Format 1.3.0 (2026-11-19)

- `project.json` gains `areaPolygons`: the polygons of the project area drawn in the area window, each `{id, name, detail, ring}` with `detail` `full` or `main` (main roads and railways only). Opening the file gives the new project the same area; its map data is downloaded again.
- A file whose project has no area polygons is still saved as 1.2.0 (with saved runs) or 1.1.0 (map data only), so older readers open it.

## Format 1.4.0 (2026-11-23)

Large-area projects, step 5 (the plan called it 1.3; 1.3 went to the area polygons).

- The map data's tiles are one PMTiles version 3 archive per kind, `map/<kind>.pmtiles` (streets, walk, rail,
  buildings, places, bike-amenities), instead of one file per tile. Each tile is the street network API's answer
  (OSM XML or JSON), gzipped, with tile type "unknown"; empty tiles are left out and read as empty; identical
  tiles are kept once. The root directory fits in the first 16 KiB, with leaf directories for large areas.
  `map/area.json` says `layout: "archive"`. Writer: `apps/api/src/mslab/pmtiles.ts`, tested with a reader
  written from the spec; its archives were also read back with the reference reader (the `pmtiles` package).
- Why: the intercity project's area takes 1,033 zoom-14 tiles; one file per tile and kind is over 5,000 files,
  the ZIP limit, and a static host would have to serve them one by one. The limit of 400 tiles is now 20,000,
  bounded by the time saving takes; the 300 MB map data limit and the 70 MB per file limit stay.
- The static viewer (`apps/web/src/static/pmtiles.ts`) reads the header and root directory once, then each tile
  by an HTTP range request, keeping the last 512 tiles read. A host that ignores ranges and sends the whole file
  still works: the file is kept and the tiles cut from it. `tools/add-projects.mjs` reads 1.0 to 1.4.
- Only a file with map data is saved as 1.4.0, so MobSimLab 1.3 readers still open the rest. A MobSimLab that
  opens a 1.4.0 file leaves the map data out, as for 1.1.

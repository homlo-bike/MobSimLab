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

## Format 1.5.0 (2026-11-25)

Project file as a complete capsule, stage 2.

- `collab/comments.json`: the comments on the project's objects and their replies. People may not exist on the
  instance that opens the file, so the names of who wrote and resolved each comment are kept as text. Opening the
  file gives the comments new ids, keeps each reply with its thread, and marks them as from the file
  (`collab.comment.from_file`, `file_author`, `file_resolved_by`; db/migrations/0029). Comments on objects this
  MobSimLab does not have are left out and listed.
- `history/values.json`: the history of changed values, newest first: the project's own changes, then the history
  it was opened with. Opening the file keeps it read-only in `project.file_value_history`, shown after the new
  project's own changes and marked as from the file (`GET /api/projects/:id/value-history/file`).
- `runs/<id>/files/<name>`: the files a run saved next to its result (a demand run's OD matrices, `od.omx`),
  listed in `run.json` under `files` with their media types. A file over the 70 MB per-file limit stays out, and
  the run's result then lists only the files the .mslab holds.
- Project preferences → Saved project files switches decide whether a file holds them (`comments=false`,
  `history=false` on the export). Only a file holding one of them is saved as 1.5.0, so older readers still open
  the rest. `tools/static-site/add-projects.mjs` reads 1.0 to 1.5.

## Format 1.6.0 (2026-11-25)

Project file as a complete capsule, stage 3: the data the project fetched or imported, in `fetched/`, so an opened
project works without downloading it again.

- `fetched/facts.json`: the location facts the project looked up and kept (`project.data_cache`): country, public
  holidays, climate, the economy figures of the cost and benefit tables, and other answers, each with its key and
  the date it was fetched. Opening the file keeps them for the new project.
- `fetched/live-osm-<n>.json`, `fetched/live-height-<n>.json`: the street, rail, walk, building and place tiles and
  the heights the tools fetched live (`project.data_use` → `geo.shared_data`), with their data dates. Opening the
  file stores them under a key that carries the new project (`file/<project>/<key>`), so only that project reads
  them: a file cannot change what other projects on the instance are handed.
- `fetched/elevation.json` and `fetched/elevation-<n>.bin`: the tiles of the finished elevation imports
  (`geo.dem_tile`), packed into chunks of at most 48 MB, with each tile's position in its chunk. GLO-30 tiles that
  do not touch a full-detail polygon of the project area are saved with every third sample (about 90 m instead of
  30 m); a tile whose size does not allow that keeps all samples. The planner's own elevation files are saved as
  they are. Opening the file adds a finished import (`options.fromFile`) holding the tiles.
- `fetched/population.json` and `fetched/population-<layer>-<n>.ndjson`: the ready population layers with their
  source, licence and options, and their features as lines of `[n, zoneId | null, people, WKB hex]`. Opening the
  file stores the layers as ready and counts their totals from the stored features.
- The sandboxed reader checks every index against its schema, that every tile lies in its chunk and inflates to
  width × height float32 values, and every feature line; the API checks the indexes and lines once more.
- Project preferences → Saved project files switches decide which kinds a file holds (`facts`, `economy`,
  `otherFetched`, `liveTiles`, `elevation`, `population`, `uploads` `=false` on the export). A kind that would
  take the file beyond the 512 MB a file may unpack to is left out and named in `ATTRIBUTION.md`. Only a file
  holding fetched data is saved as 1.6.0. `tools/static-site/add-projects.mjs` reads 1.0 to 1.6.
- `fetched/osm.json` and `fetched/osm-<n>.osm.pbf` (added 2026-11-25, the day 1.6.0 was introduced): the
  OpenStreetMap extract the project's current import cut to the project area, in parts of at most 48 MB, with its
  size and SHA-256, the import's method, whether planned roads were kept, and its Source record. Opening the file
  queues an import of the extract into the new project, as for an uploaded extract; the run keeps the method and
  Source of the saved import and is marked `options.fromFile`. The project opens at once and the map data is ready
  when the job has run. `osm=false` on the export leaves the extract out. It is added last, so the other kinds
  stay when it no longer fits.
- Opening a file downloads nothing by itself. The import answers with `queued`, the kinds a job is still bringing
  in from the file (`osm`). The projects home then reads what the new project holds and lists the downloadable
  kinds it lacks (map extract, elevation, population, location facts, economy figures) in a dialog. Each has a
  Download button that opens the project where that download is started: the GIS tab or Project preferences.
- Shared-bike stations and water depths (decided 2026-11-25): the stations a GBFS feed lists are kept with the
  project each time a demand run reads the feed (`gbfs/<hash of the feed's address>`), and used with a note when
  the feed cannot be read. The GEBCO depths the ferry checks ask for are kept per point (`depth/<lon>,<lat>`,
  four decimals) and read from the project before the depth service. Both are location facts of the group
  `otherFetched`, with the OpenStreetMap areas the benefit catchments look up, so `fetched/facts.json` carries
  them without a change to the format.

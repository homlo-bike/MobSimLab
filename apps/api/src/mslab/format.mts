/**
 * The `.mslab` project file (ADR-0021, 10 §2.2): a ZIP with a manifest, the project's details, one JSON file per
 * saved drawing (railway, street lines, depots, preferences, scenarios …), the plugins switched on, a generated
 * ATTRIBUTION.md and, when the person chooses, the saved simulation runs.
 *
 *   manifest.json              format version, app version, project id and name, date, SHA-256 of every file
 *   project.json               name, description, area, modes
 *   plugins.json               plugins switched on or off for the project
 *   data/<kind>.json           one saved drawing: its kind, schema version and document
 *   runs/<id>/run.json         a finished simulation run: settings, progress and result
 *   runs/<id>/network.txt      the network it ran on, as saved with the run
 *   runs/<id>/lines.txt        the lines it ran, as saved with the run
 *   runs/<id>/replay.json.gz   a road run's replay (gzipped JSON), when it has one
 *   runs/<id>/files/<name>     (1.5) a file the run saved next to its result: a demand run's OD matrices (od.omx)
 *   collab/comments.json       (1.5) the comments on the project's objects and their replies, names kept as text
 *   history/values.json        (1.5) the history of changed values: who, when, from what to what, and why
 *   map/area.json              (1.1, optional) the project area and the tiles the map data covers
 *   map/<kind>/<x>-<y>.<ext>   (1.1, optional) one zoom-14 OpenStreetMap tile as the street network API serves it
 *   map/water.json             (1.1, optional) sea, lakes and rivers of the area
 *   map/population.json        (1.1, optional) people per cell over the area
 *   map/reference.json         (1.1, optional) country figures for the cost and benefit tables, by API path
 *   map/<kind>.pmtiles         (1.4, optional) every zoom-14 tile of one kind in one PMTiles archive, which the
 *                              static viewer reads by byte range; replaces map/<kind>/<x>-<y>.<ext> in 1.4 files
 *   results/<kind>.json        (1.2) a result the project's tools worked out (noise map, walk coverage…), with the
 *                              fingerprint of what it was worked out from
 *   ATTRIBUTION.md             generated: what the file holds and the sources it refers to
 *
 * The map data (`map/`) is there only when the person ticks "Include map data", for the static viewer
 * (`pnpm build:static`). A MobSimLab that opens the file ignores it and loads its own.
 *
 * Members, the view-only link and the rest of the audit history stay with the instance and are not in the file.
 * The JSON Schemas below are published in `contracts/mslab/` (written by test/mslab-schemas.test.ts).
 *
 * Plain ESM with erasable types only: the sandboxed reader (read.mts) loads it in the tool host.
 */

/** Current format version (semantic): a new minor version only adds, a new major version needs a migration. */
export const FORMAT_VERSION = "1.5.0";

/** The version a file with map data and without comments, history or run files is saved as (MobSimLab 1.4 reads it). */
export const FORMAT_VERSION_MAP = "1.4.0";

/** The version a file with project area polygons and no map data is saved as, so that MobSimLab 1.3 readers open it. */
export const FORMAT_VERSION_POLYGONS = "1.3.0";

/** The version a file with saved results and no project area is saved as, so that MobSimLab 1.2 readers open it. */
export const FORMAT_VERSION_RESULTS = "1.2.0";

/** The version a file without map data is saved as, so that MobSimLab 1.0 readers still open it. */
export const FORMAT_VERSION_WITHOUT_MAP = "1.0.0";

/** Value of `manifest.format`. */
export const FORMAT_NAME = "mslab";

/** Media type of a `.mslab` file. */
export const MSLAB_MEDIA_TYPE = "application/vnd.mobsimlab.project+zip";

/** Largest `.mslab` file accepted for import. */
export const MAX_MSLAB_BYTES = 200 * 1024 * 1024;

/** ZIP limits for import (05 §3.3): entries, sizes and compression ratio. */
export const MSLAB_ZIP_LIMITS = {
  zipBytes: MAX_MSLAB_BYTES,
  entries: 5000,
  // A road run's network is up to 64 MB of text (db/migrations/0009_road_runs.sql).
  fileBytes: 70 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  maxRatio: 500,
} as const;

/**
 * Run kinds and finished statuses a file may hold (db/migrations/0009_road_runs.sql, 0012_demand_runs.sql,
 * 0015_calendar_runs.sql). From format 1.5 a demand run's files (its OD matrices, `simulation.run_file`) are carried;
 * a run's result lists only the files the file holds.
 */
export const RUN_KINDS = ["capacity", "sweep", "road", "demand", "calendar"] as const;
export const FINISHED_RUN_STATUSES = ["done", "failed", "cancelled"] as const;

/** Modes a project can plan for (apps/api/src/projects/projects.controller.ts PROJECT_MODES). */
export const MODES = [
  "bus",
  "brt",
  "trolleybus",
  "intercity_bus",
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "intercity_rail",
  "high_speed_rail",
] as const;

/** File names inside the ZIP. */
export const FILES = {
  manifest: "manifest.json",
  project: "project.json",
  plugins: "plugins.json",
  attribution: "ATTRIBUTION.md",
  drawing: (kind: string) => `data/${kind}.json`,
  run: (id: string) => `runs/${id}/run.json`,
  runNetwork: (id: string) => `runs/${id}/network.txt`,
  runLines: (id: string) => `runs/${id}/lines.txt`,
  runReplay: (id: string) => `runs/${id}/replay.json.gz`,
  runFile: (id: string, name: string) => `runs/${id}/files/${name}`,
  result: (kind: string) => `results/${kind}.json`,
  comments: "collab/comments.json",
  history: "history/values.json",
} as const;

/** Kinds of map tile a file may carry (format 1.1), as the street network API serves them. */
export const MAP_TILE_KINDS = ["streets", "walk", "rail", "buildings", "places", "bike-amenities"] as const;
export type MapTileKind = (typeof MAP_TILE_KINDS)[number];

/** Map data file names (format 1.1). */
export const MAP_FILES = {
  area: "map/area.json",
  water: "map/water.json",
  population: "map/population.json",
  reference: "map/reference.json",
  tile: (kind: MapTileKind, x: number, y: number) =>
    `map/${kind}/${x}-${y}.${kind === "streets" || kind === "walk" || kind === "rail" ? "xml" : "json"}`,
  /** Format 1.4: all tiles of one kind in one PMTiles archive (apps/api/src/mslab/pmtiles.ts). */
  archive: (kind: MapTileKind) => `map/${kind}.pmtiles`,
} as const;

/** `map/area.json`: the project area (degrees) and the zoom-14 tiles of each kind in the file. */
export interface MapAreaFile {
  bbox: [number, number, number, number];
  zoom: number;
  kinds: MapTileKind[];
  tiles: [number, number][];
  /**
   * Format 1.4: "archive" when the tiles are in `map/<kind>.pmtiles`; absent when they are one file per tile.
   * A tile the archive does not hold is empty (nothing mapped there, or outside the area).
   */
  layout?: "archive";
}

/** Patterns of every file a version 1 file may hold besides the manifest. */
export const FILE_PATTERNS = {
  drawing: /^data\/([a-z][a-z0-9-]{1,39})\.json$/,
  run: /^runs\/([0-9a-f-]{36})\/run\.json$/,
  runNetwork: /^runs\/([0-9a-f-]{36})\/network\.txt$/,
  runLines: /^runs\/([0-9a-f-]{36})\/lines\.txt$/,
  runReplay: /^runs\/([0-9a-f-]{36})\/replay\.json\.gz$/,
  runFile: /^runs\/([0-9a-f-]{36})\/files\/([a-z0-9][a-z0-9._-]{0,63})$/,
  result: /^results\/([a-z][a-z0-9-]{1,39})\.json$/,
  map: /^map\/(?:(?:area|water|population|reference)\.json|(?:streets|walk|rail)\/\d{1,5}-\d{1,5}\.xml|(?:buildings|places|bike-amenities)\/\d{1,5}-\d{1,5}\.json|(?:streets|walk|rail|buildings|places|bike-amenities)\.pmtiles)$/,
} as const;

/** `manifest.json`. */
export interface Manifest {
  format: "mslab";
  formatVersion: string;
  app: { name: string; version: string };
  createdAt: string;
  project: { id: string; name: string };
  /** `map` (format 1.1): the file carries map data for the static viewer. */
  includes: { runs: boolean; map?: boolean };
  /** Every other file in the ZIP with its SHA-256 (hex) and size in bytes. */
  files: Record<string, { sha256: string; bytes: number }>;
}

/** `project.json`. */
export interface ProjectFile {
  id: string;
  name: string;
  description: string;
  areaName: string | null;
  modes: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * Format 1.3: the polygons of the project area (apps/api/src/projects/area-polygons.ts), each
   * `{id, name, detail: "full" | "main", ring: [[lon, lat], ...]}`. Opening the file gives the new project the same
   * area; its map data is downloaded again.
   */
  areaPolygons?: { id: string; name: string; detail: "full" | "main"; ring: [number, number][] }[];
}

/** `plugins.json`. */
export interface PluginsFile {
  plugins: { id: string; enabled: boolean; version: string | null }[];
}

/** `data/<kind>.json`. */
export interface DrawingFile {
  kind: string;
  schemaVersion: number;
  updatedAt: string;
  doc: unknown;
}

/** `results/<kind>.json` (format 1.2). */
export interface ResultFile {
  kind: string;
  /** Fingerprint of what the result was worked out from. */
  inputs: string;
  computedAt: string;
  /** The result as the web app saved it (JSON). */
  doc: unknown;
}

/** `collab/comments.json` (format 1.5). */
export interface CommentsFile {
  comments: {
    /** The comment's id in the saved project; a reply's `parentId` names its thread's first comment. */
    id: string;
    objectType: string;
    objectId: string;
    parentId: string | null;
    body: string;
    /** The author's name as the saved project showed it; null when unknown. */
    author: string | null;
    createdAt: string;
    editedAt: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
  }[];
}

/** `history/values.json` (format 1.5): the history of changed values, newest first. */
export interface HistoryFile {
  entries: {
    /** Assumption id, for example `street.mixed_traffic_delay_share`. */
    id: string;
    kind: "changed" | "reason";
    before: { value: number | null; reason: string | null };
    after: { value: number | null; reason: string | null };
    reason: string | null;
    at: string;
    /** The name of who changed it, as the saved project showed it; null when unknown. */
    by: string | null;
  }[];
}

/** `runs/<id>/run.json`. */
export interface RunFile {
  id: string;
  kind: (typeof RUN_KINDS)[number];
  status: (typeof FINISHED_RUN_STATUSES)[number];
  input: unknown;
  progress: unknown;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Format 1.5: the files in `runs/<id>/files/` with their media types. */
  files?: { name: string; mediaType: string }[];
}

const ID = "https://github.com/homlo-bike/MobSimLab/blob/main/contracts/mslab/";
const isoDate = { type: "string", format: "date-time", maxLength: 40 } as const;
const uuid = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } as const;

/** JSON Schema of `manifest.json`. */
export const MANIFEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}manifest.schema.json`,
  title: "MobSimLab project file manifest (manifest.json)",
  type: "object",
  required: ["format", "formatVersion", "app", "createdAt", "project", "includes", "files"],
  additionalProperties: false,
  properties: {
    format: { const: FORMAT_NAME },
    formatVersion: {
      description:
        "Semantic version of the file format. A reader accepts its own major version up to its own minor version.",
      type: "string",
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
    },
    app: {
      type: "object",
      required: ["name", "version"],
      additionalProperties: false,
      properties: { name: { type: "string", maxLength: 100 }, version: { type: "string", maxLength: 40 } },
    },
    createdAt: isoDate,
    project: {
      type: "object",
      required: ["id", "name"],
      additionalProperties: false,
      properties: { id: uuid, name: { type: "string", maxLength: 200 } },
    },
    includes: {
      type: "object",
      required: ["runs"],
      additionalProperties: false,
      properties: {
        runs: { type: "boolean" },
        map: {
          description: "Format 1.1: the file carries map data (map/) for the static viewer.",
          type: "boolean",
        },
      },
    },
    files: {
      description: "Every other file in the ZIP, with its SHA-256 (lower-case hex) and size in bytes.",
      type: "object",
      maxProperties: MSLAB_ZIP_LIMITS.entries,
      propertyNames: { maxLength: 200 },
      additionalProperties: {
        type: "object",
        required: ["sha256", "bytes"],
        additionalProperties: false,
        properties: {
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          bytes: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

/** JSON Schema of `project.json`. */
export const PROJECT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}project.schema.json`,
  title: "MobSimLab project details (project.json)",
  type: "object",
  required: ["id", "name", "description", "areaName", "modes", "createdAt", "updatedAt"],
  additionalProperties: false,
  properties: {
    id: uuid,
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    areaName: { type: ["string", "null"], maxLength: 200 },
    modes: { type: "array", maxItems: 20, items: { enum: [...MODES] } },
    createdAt: isoDate,
    updatedAt: isoDate,
    areaPolygons: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        required: ["id", "name", "detail", "ring"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^a[A-Za-z0-9_-]{1,40}$" },
          name: { type: "string", minLength: 1, maxLength: 200 },
          detail: { enum: ["full", "main"] },
          ring: {
            type: "array",
            minItems: 4,
            maxItems: 2001,
            items: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              prefixItems: [
                { type: "number", minimum: -180, maximum: 180 },
                { type: "number", minimum: -85, maximum: 85 },
              ],
            },
          },
        },
      },
    },
  },
} as const;

/** JSON Schema of `plugins.json`. */
export const PLUGINS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}plugins.schema.json`,
  title: "Plugins switched on or off for the project (plugins.json)",
  type: "object",
  required: ["plugins"],
  additionalProperties: false,
  properties: {
    plugins: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        required: ["id", "enabled", "version"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 200 },
          enabled: { type: "boolean" },
          version: {
            description:
              "The pinned version of an installed plugin; null for a plugin bundled with MobSimLab.",
            type: ["string", "null"],
            maxLength: 64,
          },
        },
      },
    },
  },
} as const;

/** JSON Schema of `data/<kind>.json`; `doc` is checked against `drawings/<kind>.schema.json`. */
export const DRAWING_FILE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}drawing.schema.json`,
  title: "One saved drawing of the project (data/<kind>.json)",
  type: "object",
  required: ["kind", "schemaVersion", "updatedAt", "doc"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", pattern: "^[a-z][a-z0-9-]{1,39}$" },
    schemaVersion: { type: "integer", minimum: 1 },
    updatedAt: isoDate,
    doc: { description: "The document, in the shape of drawings/<kind>.schema.json." },
  },
} as const;

/** JSON Schema of `runs/<id>/run.json`. */
export const RUN_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}run.schema.json`,
  title: "One finished simulation run (runs/<id>/run.json)",
  type: "object",
  required: [
    "id",
    "kind",
    "status",
    "input",
    "progress",
    "result",
    "error",
    "createdAt",
    "startedAt",
    "finishedAt",
  ],
  additionalProperties: false,
  properties: {
    id: uuid,
    kind: { enum: [...RUN_KINDS] },
    status: { enum: [...FINISHED_RUN_STATUSES] },
    input: { type: "object", description: "Settings of the run and the names of its input files." },
    progress: { description: "What the worker found while it ran, or null." },
    result: { description: "The run's result, or null." },
    error: { type: ["string", "null"], maxLength: 2000 },
    createdAt: isoDate,
    startedAt: { anyOf: [isoDate, { type: "null" }] },
    finishedAt: { anyOf: [isoDate, { type: "null" }] },
    files: {
      description: "Format 1.5: the files the run saved next to its result, in runs/<id>/files/.",
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["name", "mediaType"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" },
          mediaType: { type: "string", minLength: 1, maxLength: 100 },
        },
      },
    },
  },
} as const;

const nameOrNull = { type: ["string", "null"], maxLength: 200 } as const;
const dateOrNull = { anyOf: [isoDate, { type: "null" }] } as const;
const valueState = {
  type: "object",
  required: ["value", "reason"],
  additionalProperties: false,
  properties: { value: { type: ["number", "null"] }, reason: { type: ["string", "null"], maxLength: 500 } },
} as const;

/** JSON Schema of `collab/comments.json` (format 1.5). */
export const COMMENTS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}comments.schema.json`,
  title: "Comments on the project's objects (collab/comments.json)",
  type: "object",
  required: ["comments"],
  additionalProperties: false,
  properties: {
    comments: {
      type: "array",
      maxItems: 20000,
      items: {
        type: "object",
        required: [
          "id",
          "objectType",
          "objectId",
          "parentId",
          "body",
          "author",
          "createdAt",
          "editedAt",
          "resolvedAt",
          "resolvedBy",
        ],
        additionalProperties: false,
        properties: {
          id: uuid,
          objectType: { type: "string", pattern: "^[a-z][a-z-]{1,39}$" },
          objectId: { type: "string", minLength: 1, maxLength: 100 },
          parentId: { anyOf: [uuid, { type: "null" }] },
          body: { type: "string", minLength: 1, maxLength: 4000 },
          author: nameOrNull,
          createdAt: isoDate,
          editedAt: dateOrNull,
          resolvedAt: dateOrNull,
          resolvedBy: nameOrNull,
        },
      },
    },
  },
} as const;

/** JSON Schema of `history/values.json` (format 1.5). */
export const HISTORY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}history.schema.json`,
  title: "History of the project's changed values, newest first (history/values.json)",
  type: "object",
  required: ["entries"],
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      maxItems: 20000,
      items: {
        type: "object",
        required: ["id", "kind", "before", "after", "reason", "at", "by"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$", maxLength: 120 },
          kind: { enum: ["changed", "reason"] },
          before: valueState,
          after: valueState,
          reason: { type: ["string", "null"], maxLength: 500 },
          at: isoDate,
          by: nameOrNull,
        },
      },
    },
  },
} as const;

/** JSON Schema of `results/<kind>.json` (format 1.2). */
export const RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}result.schema.json`,
  title: "A result the project's tools worked out (results/<kind>.json)",
  type: "object",
  required: ["kind", "inputs", "computedAt", "doc"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", pattern: "^[a-z][a-z0-9-]{1,39}$" },
    inputs: {
      description:
        "Fingerprint of what the result was worked out from; another fingerprint means out of date.",
      type: "string",
      pattern: "^[A-Za-z0-9._:-]{0,200}$",
    },
    computedAt: isoDate,
    doc: { description: "The result as the web app saved it." },
  },
} as const;

/** The hand-written schemas, by file name in `contracts/mslab/`. */
export const FILE_SCHEMAS = {
  "manifest.schema.json": MANIFEST_SCHEMA,
  "project.schema.json": PROJECT_SCHEMA,
  "plugins.schema.json": PLUGINS_SCHEMA,
  "drawing.schema.json": DRAWING_FILE_SCHEMA,
  "run.schema.json": RUN_SCHEMA,
  "result.schema.json": RESULT_SCHEMA,
  "comments.schema.json": COMMENTS_SCHEMA,
  "history.schema.json": HISTORY_SCHEMA,
} as const;

/** Purpose: [major, minor, patch] of a semantic version string. */
export function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`"${v.slice(0, 20)}" is not a format version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

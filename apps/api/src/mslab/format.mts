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
 *   ATTRIBUTION.md             generated: what the file holds and the sources it refers to
 *
 * Members, the view-only link and the audit history stay with the instance and are not in the file.
 * The JSON Schemas below are published in `contracts/mslab/` (written by test/mslab-schemas.test.ts).
 *
 * Plain ESM with erasable types only: the sandboxed reader (read.mts) loads it in the tool host.
 */

/** Current format version (semantic): a new minor version only adds, a new major version needs a migration. */
export const FORMAT_VERSION = "1.0.0";

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

/** Run kinds and finished statuses a file may hold (db/migrations/0009_road_runs.sql). */
export const RUN_KINDS = ["capacity", "sweep", "road"] as const;
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
} as const;

/** Patterns of every file a version 1 file may hold besides the manifest. */
export const FILE_PATTERNS = {
  drawing: /^data\/([a-z][a-z0-9-]{1,39})\.json$/,
  run: /^runs\/([0-9a-f-]{36})\/run\.json$/,
  runNetwork: /^runs\/([0-9a-f-]{36})\/network\.txt$/,
  runLines: /^runs\/([0-9a-f-]{36})\/lines\.txt$/,
  runReplay: /^runs\/([0-9a-f-]{36})\/replay\.json\.gz$/,
} as const;

/** `manifest.json`. */
export interface Manifest {
  format: "mslab";
  formatVersion: string;
  app: { name: string; version: string };
  createdAt: string;
  project: { id: string; name: string };
  includes: { runs: boolean };
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
      properties: { runs: { type: "boolean" } },
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
  },
} as const;

/** The hand-written schemas, by file name in `contracts/mslab/`. */
export const FILE_SCHEMAS = {
  "manifest.schema.json": MANIFEST_SCHEMA,
  "project.schema.json": PROJECT_SCHEMA,
  "plugins.schema.json": PLUGINS_SCHEMA,
  "drawing.schema.json": DRAWING_FILE_SCHEMA,
  "run.schema.json": RUN_SCHEMA,
} as const;

/** Purpose: [major, minor, patch] of a semantic version string. */
export function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`"${v.slice(0, 20)}" is not a format version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

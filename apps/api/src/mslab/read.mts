import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import AjvModule from "ajv/dist/2020.js";
import { ToolError } from "../tool-runner/errors.mts";
import type { ToolContext } from "../tool-runner/tools.mts";
import { readZip } from "../tool-runner/zip.mts";
import DRAWING_SCHEMAS from "./drawing-schemas.generated.json" with { type: "json" };
import {
  DRAWING_FILE_SCHEMA,
  type DrawingFile,
  FILE_PATTERNS,
  FILES,
  FORMAT_VERSION,
  type Manifest,
  MANIFEST_SCHEMA,
  MSLAB_ZIP_LIMITS,
  parseVersion,
  PLUGINS_SCHEMA,
  type PluginsFile,
  PROJECT_SCHEMA,
  type ProjectFile,
  RESULT_SCHEMA,
  type ResultFile,
  RUN_SCHEMA,
  type RunFile,
  COMMENTS_SCHEMA,
  HISTORY_SCHEMA,
  FETCHED_ELEVATION_SCHEMA,
  FETCHED_FACTS_SCHEMA,
  FETCHED_FILES,
  FETCHED_LIVE_SCHEMA,
  FETCHED_POPULATION_SCHEMA,
  type FetchedElevationFile,
  type FetchedLiveFile,
  type FetchedPopulationFile,
} from "./format.mts";
import { migrate } from "./migrations.mts";

/**
 * The `.mslab` reader, run in the sandboxed tool host (tool-runner/host.mts), never in the API process. It
 * unpacks the upload within the ZIP limits, checks the manifest, the format version, every file's checksum and
 * every file against its JSON Schema, applies the format migrations, and writes the checked files to its
 * scratch folder under names it chooses. The API then reads only those files and checks the drawings once more
 * against its own outlines before it creates the project.
 */

/** A drawing the API should save, and the scratch file holding its `data/<kind>.json`. */
export interface ReadDrawing {
  kind: string;
  file: string;
}

/** A run the API should save, and the scratch files holding it. */
export interface ReadRun {
  file: string;
  network: string;
  lines: string;
  replay: string | null;
  /** Format 1.5: the files the run saved next to its result, by name. */
  files?: { name: string; mediaType: string; file: string }[];
}

/** A saved result (format 1.2) the API should keep, and the scratch file holding its `results/<kind>.json`. */
export interface ReadResult {
  kind: string;
  file: string;
}

/** Format 1.6: the scratch files holding the data the saved project fetched or imported. */
export interface ReadFetched {
  /** `fetched/facts.json`. */
  facts: string | null;
  /** The `fetched/live-<kind>-<n>.json` files. */
  live: string[];
  /** `fetched/elevation.json` and its chunks by number. */
  elevation: { index: string; chunks: { n: number; file: string }[] } | null;
  /** `fetched/population.json` and the feature files of each layer (layers and files counted from 1). */
  population: { index: string; files: { layer: number; n: number; file: string }[] } | null;
}

/** What the reader found: the project, what to save, and what it left out (with the reason). */
export interface MslabReadResult {
  formatVersion: string;
  migratedFrom: string | null;
  appVersion: string;
  project: ProjectFile;
  plugins: PluginsFile["plugins"];
  drawings: ReadDrawing[];
  runs: ReadRun[];
  /** Saved results (format 1.2); absent from older readers' answers. */
  results?: ReadResult[];
  /** Format 1.5: the scratch file holding `collab/comments.json`, when the file has comments. */
  comments?: string | null;
  /** Format 1.5: the scratch file holding `history/values.json`, when the file has a history of changed values. */
  history?: string | null;
  /** Format 1.6: fetched and imported data; absent when the file has none. */
  fetched?: ReadFetched | null;
  skipped: string[];
}

/** A file that is not a valid `.mslab`; the message is shown to the person who uploaded it. */
export class MslabError extends ToolError {}

type DrawingSchemas = Record<string, { schemaVersion: number; schema: object }>;

// ajv is CommonJS: its default export arrives as the module object under ESM.
const Ajv2020 = AjvModule.default;
const ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: false });
const check = {
  manifest: ajv.compile(MANIFEST_SCHEMA),
  project: ajv.compile(PROJECT_SCHEMA),
  plugins: ajv.compile(PLUGINS_SCHEMA),
  drawing: ajv.compile(DRAWING_FILE_SCHEMA),
  run: ajv.compile(RUN_SCHEMA),
  result: ajv.compile(RESULT_SCHEMA),
  comments: ajv.compile(COMMENTS_SCHEMA),
  history: ajv.compile(HISTORY_SCHEMA),
  fetchedFacts: ajv.compile(FETCHED_FACTS_SCHEMA),
  fetchedLive: ajv.compile(FETCHED_LIVE_SCHEMA),
  fetchedElevation: ajv.compile(FETCHED_ELEVATION_SCHEMA),
  fetchedPopulation: ajv.compile(FETCHED_POPULATION_SCHEMA),
};
const docChecks = new Map<string, ReturnType<typeof ajv.compile>>();

/** Purpose: the validator of a drawing kind's document, compiled on first use. */
function docCheck(kind: string): ReturnType<typeof ajv.compile> {
  let v = docChecks.get(kind);
  if (!v) {
    v = ajv.compile((DRAWING_SCHEMAS as DrawingSchemas)[kind]!.schema);
    docChecks.set(kind, v);
  }
  return v;
}

/** Purpose: the first error of a validator, as a short sentence. */
function firstError(v: ReturnType<typeof ajv.compile>): string {
  const e = v.errors?.[0];
  if (!e) return "it does not have the expected shape";
  return `${e.instancePath || "the file"} ${e.message ?? "is not valid"}`.slice(0, 200);
}

/** Purpose: parse a file as JSON and check it against a schema; MslabError naming the file otherwise. */
function json<T>(files: Map<string, Buffer>, name: string, v: ReturnType<typeof ajv.compile>): T {
  const bytes = files.get(name);
  if (!bytes) throw new MslabError(`${name} is missing`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new MslabError(`${name} is not valid JSON`);
  }
  if (!v(value)) throw new MslabError(`${name}: ${firstError(v)}`);
  return value as T;
}

const HEX = /^(?:[0-9a-f]{2}){5,}$/;

/**
 * Purpose: check the fetched and imported data of a file (format 1.6) and write it to the scratch folder.
 * Elevation tiles must lie inside their chunk and inflate to width × height float32 values; every population
 * feature line must be `[n, zoneId | null, people, WKB hex]`. Output: the scratch names, or null without such data.
 */
function readFetched(files: Map<string, Buffer>, ctx: ToolContext): ReadFetched | null {
  const out: ReadFetched = { facts: null, live: [], elevation: null, population: null };
  if (files.has(FETCHED_FILES.facts)) {
    json(files, FETCHED_FILES.facts, check.fetchedFacts);
    out.facts = "fetched-facts.json";
    ctx.write(out.facts, files.get(FETCHED_FILES.facts)!);
  }
  const chunks = new Map<number, Buffer>();
  const features = new Map<string, Buffer>();
  for (const name of [...files.keys()].sort()) {
    const live = FILE_PATTERNS.fetchedLive.exec(name);
    if (live) {
      const f = json<FetchedLiveFile>(files, name, check.fetchedLive);
      if (f.kind !== live[1]) throw new MslabError(`${name} holds data of kind "${f.kind}"`);
      const file = `fetched-live-${out.live.length + 1}.json`;
      ctx.write(file, files.get(name)!);
      out.live.push(file);
      continue;
    }
    const chunk = FILE_PATTERNS.fetchedElevationChunk.exec(name);
    if (chunk) chunks.set(Number(chunk[1]), files.get(name)!);
    const feat = FILE_PATTERNS.fetchedPopulationFeatures.exec(name);
    if (feat) features.set(`${Number(feat[1])}-${Number(feat[2])}`, files.get(name)!);
  }

  if (files.has(FETCHED_FILES.elevation)) {
    const index = json<FetchedElevationFile>(files, FETCHED_FILES.elevation, check.fetchedElevation);
    const used = new Set<number>();
    for (const imp of index.imports)
      for (const t of imp.tiles) {
        const body = chunks.get(t.chunk);
        if (!body || t.offset + t.bytes > body.length)
          throw new MslabError(`${FETCHED_FILES.elevation} names an elevation tile the file does not hold`);
        const want = t.width * t.height * 4;
        let got = -1;
        try {
          got = inflateSync(body.subarray(t.offset, t.offset + t.bytes), { maxOutputLength: want }).length;
        } catch {
          // Not deflated, or larger than its width and height say.
        }
        if (got !== want)
          throw new MslabError(`an elevation tile in ${FETCHED_FILES.elevationChunk(t.chunk)} is not valid`);
        used.add(t.chunk);
      }
    for (const n of chunks.keys())
      if (!used.has(n))
        throw new MslabError(`${FETCHED_FILES.elevationChunk(n)} is not used by ${FETCHED_FILES.elevation}`);
    out.elevation = { index: "fetched-elevation.json", chunks: [] };
    ctx.write(out.elevation.index, files.get(FETCHED_FILES.elevation)!);
    for (const n of [...used].sort((a, b) => a - b)) {
      const file = `fetched-elevation-${n}.bin`;
      ctx.write(file, chunks.get(n)!);
      out.elevation.chunks.push({ n, file });
    }
  } else if (chunks.size) throw new MslabError(`${FETCHED_FILES.elevation} is missing`);

  if (files.has(FETCHED_FILES.population)) {
    const index = json<FetchedPopulationFile>(files, FETCHED_FILES.population, check.fetchedPopulation);
    out.population = { index: "fetched-population.json", files: [] };
    ctx.write(out.population.index, files.get(FETCHED_FILES.population)!);
    const named = new Set<string>();
    for (const [k, layer] of index.layers.entries())
      for (let n = 1; n <= layer.files; n++) {
        const name = FETCHED_FILES.populationFeatures(k + 1, n);
        const body = features.get(`${k + 1}-${n}`);
        if (!body) throw new MslabError(`${name} is missing`);
        named.add(`${k + 1}-${n}`);
        for (const line of body.toString("utf8").split("\n")) {
          if (!line) continue;
          let row: unknown;
          try {
            row = JSON.parse(line);
          } catch {
            row = null;
          }
          const ok =
            Array.isArray(row) &&
            row.length === 4 &&
            Number.isInteger(row[0]) &&
            row[0] >= 0 &&
            row[0] < 2 ** 31 &&
            (row[1] === null || (typeof row[1] === "string" && row[1].length <= 200)) &&
            typeof row[2] === "number" &&
            Number.isFinite(row[2]) &&
            row[2] >= 0 &&
            typeof row[3] === "string" &&
            row[3].length <= 4_000_000 &&
            HEX.test(row[3]);
          if (!ok) throw new MslabError(`${name} has a line that is not a population feature`);
        }
        const file = `fetched-population-${k + 1}-${n}.ndjson`;
        ctx.write(file, body);
        out.population.files.push({ layer: k + 1, n, file });
      }
    for (const k of features.keys())
      if (!named.has(k))
        throw new MslabError(`a population feature file is not used by ${FETCHED_FILES.population}`);
  } else if (features.size) throw new MslabError(`${FETCHED_FILES.population} is missing`);

  return out.facts || out.live.length || out.elevation || out.population ? out : null;
}

/**
 * Purpose: read and check a `.mslab` file.
 * Inputs: the uploaded bytes and the tool context (scratch folder). Output: what to create, see MslabReadResult.
 * Throws a ToolError (MslabError or ZipError) with a plain message when the file cannot be opened.
 */
export function readMslab(input: Buffer, ctx: ToolContext): MslabReadResult {
  let files: Map<string, Buffer>;
  files = readZip(input, MSLAB_ZIP_LIMITS);
  if (!files.has(FILES.manifest))
    throw new MslabError("this is not a MobSimLab project file (no manifest.json)");

  // The manifest's own shape may change between major versions, so check the version before the schema.
  let raw: unknown;
  try {
    raw = JSON.parse(files.get(FILES.manifest)!.toString("utf8"));
  } catch {
    throw new MslabError("manifest.json is not valid JSON");
  }
  const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
  if ((raw as { format?: unknown } | null)?.format !== "mslab" || typeof version !== "string")
    throw new MslabError("this is not a MobSimLab project file");
  let fileVersion: [number, number, number];
  try {
    fileVersion = parseVersion(version);
  } catch {
    throw new MslabError(`format version "${version.slice(0, 20)}" is not valid`);
  }
  const current = parseVersion(FORMAT_VERSION);
  if (fileVersion[0] > current[0] || (fileVersion[0] === current[0] && fileVersion[1] > current[1]))
    throw new MslabError(
      `the file was saved in format ${version} by a newer MobSimLab; this one reads up to ${FORMAT_VERSION}`,
    );

  // Checksums are of the files as saved, before any migration.
  const manifest0 = raw as Manifest;
  if (!check.manifest(raw) && fileVersion[0] === current[0])
    throw new MslabError(`manifest.json: ${firstError(check.manifest)}`);
  const listed = manifest0.files ?? {};
  for (const [name, bytes] of files) {
    if (name === FILES.manifest) continue;
    const entry = Object.hasOwn(listed, name) ? listed[name] : undefined;
    if (!entry) throw new MslabError(`${name} is in the file but not in its manifest`);
    if (entry.bytes !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw new MslabError(`${name} does not match its checksum; the file was changed or damaged`);
  }
  for (const name of Object.keys(listed))
    if (!files.has(name)) throw new MslabError(`${name} is listed in the manifest but missing`);

  const migrated = migrate(files, version);
  if (migrated.version !== FORMAT_VERSION && parseVersion(migrated.version)[0] !== current[0])
    throw new MslabError(`format ${version} cannot be upgraded to ${FORMAT_VERSION}`);
  files = migrated.files;
  const manifest = json<Manifest>(files, FILES.manifest, check.manifest);

  const project = json<ProjectFile>(files, FILES.project, check.project);
  const plugins = files.has(FILES.plugins)
    ? json<PluginsFile>(files, FILES.plugins, check.plugins).plugins
    : [];

  const skipped: string[] = [];
  const drawings: ReadDrawing[] = [];
  const runIds = new Set<string>();
  const results: ReadResult[] = [];
  let comments: string | null = null;
  let history: string | null = null;
  let hasMap = false;
  for (const name of [...files.keys()].sort()) {
    if (
      name === FILES.manifest ||
      name === FILES.project ||
      name === FILES.plugins ||
      name === FILES.attribution
    )
      continue;
    const d = FILE_PATTERNS.drawing.exec(name);
    if (d) {
      const kind = d[1]!;
      const drawing = json<DrawingFile>(files, name, check.drawing);
      if (drawing.kind !== kind) throw new MslabError(`${name} holds a drawing of kind "${drawing.kind}"`);
      const known = (DRAWING_SCHEMAS as DrawingSchemas)[kind];
      if (!known) {
        skipped.push(`${kind}: this MobSimLab does not have this tool`);
        continue;
      }
      if (drawing.schemaVersion !== known.schemaVersion) {
        skipped.push(
          `${kind}: saved as version ${drawing.schemaVersion}, this MobSimLab reads ${known.schemaVersion}`,
        );
        continue;
      }
      const v = docCheck(kind);
      if (!v(drawing.doc)) throw new MslabError(`${name}: doc${firstError(v).replace(/^the file/, "")}`);
      const file = `drawing-${kind}.json`;
      ctx.write(file, files.get(name)!);
      drawings.push({ kind, file });
      continue;
    }
    const r =
      FILE_PATTERNS.run.exec(name) ??
      FILE_PATTERNS.runNetwork.exec(name) ??
      FILE_PATTERNS.runLines.exec(name) ??
      FILE_PATTERNS.runReplay.exec(name);
    if (r) {
      runIds.add(r[1]!);
      continue;
    }
    const rf = FILE_PATTERNS.runFile.exec(name);
    if (rf) {
      // Checked with its run below: the run must list it.
      runIds.add(rf[1]!);
      continue;
    }
    if (name === FILES.comments) {
      json(files, name, check.comments);
      comments = "comments.json";
      ctx.write(comments, files.get(name)!);
      continue;
    }
    if (name === FILES.history) {
      json(files, name, check.history);
      history = "history.json";
      ctx.write(history, files.get(name)!);
      continue;
    }
    const k = FILE_PATTERNS.result.exec(name);
    if (k) {
      const kind = k[1]!;
      const result = json<ResultFile>(files, name, check.result);
      if (result.kind !== kind) throw new MslabError(`${name} holds a result of kind "${result.kind}"`);
      const file = `result-${kind}.json`;
      ctx.write(file, files.get(name)!);
      results.push({ kind, file });
      continue;
    }
    // Fetched and imported data (format 1.6): checked together below.
    if (
      name === FETCHED_FILES.facts ||
      name === FETCHED_FILES.elevation ||
      name === FETCHED_FILES.population ||
      FILE_PATTERNS.fetchedLive.test(name) ||
      FILE_PATTERNS.fetchedElevationChunk.test(name) ||
      FILE_PATTERNS.fetchedPopulationFeatures.test(name)
    )
      continue;
    // Map data (format 1.1) is for the static viewer; this MobSimLab loads its own.
    if (FILE_PATTERNS.map.test(name)) {
      hasMap = true;
      continue;
    }
    throw new MslabError(`${name} is not a file a MobSimLab project file can hold`);
  }

  const fetched = readFetched(files, ctx);
  if (hasMap && !manifest.includes.map)
    throw new MslabError("the file holds map data but its manifest says it does not");
  if (runIds.size > 0 && !manifest.includes.runs)
    throw new MslabError("the file holds simulation runs but its manifest says it does not");
  const runs: ReadRun[] = [];
  let n = 0;
  for (const id of [...runIds].sort()) {
    const run = json<RunFile>(files, FILES.run(id), check.run);
    if (run.id !== id) throw new MslabError(`${FILES.run(id)} holds run ${run.id}`);
    const network = files.get(FILES.runNetwork(id));
    const lines = files.get(FILES.runLines(id));
    if (!network || !lines) throw new MslabError(`run ${id} is missing its network or lines`);
    const replay = files.get(FILES.runReplay(id)) ?? null;
    if (replay && (replay[0] !== 0x1f || replay[1] !== 0x8b))
      throw new MslabError(`${FILES.runReplay(id)} is not gzipped`);
    n++;
    const base = `run-${n}`;
    ctx.write(`${base}.json`, files.get(FILES.run(id))!);
    ctx.write(`${base}-network.txt`, network);
    ctx.write(`${base}-lines.txt`, lines);
    if (replay) ctx.write(`${base}-replay.gz`, replay);
    const named = new Set((run.files ?? []).map((f) => f.name));
    for (const name of files.keys()) {
      const m = FILE_PATTERNS.runFile.exec(name);
      if (m && m[1] === id && !named.has(m[2]!))
        throw new MslabError(`${name} is not listed in ${FILES.run(id)}`);
    }
    const saved: { name: string; mediaType: string; file: string }[] = [];
    for (const [k, f] of (run.files ?? []).entries()) {
      const bytes = files.get(FILES.runFile(id, f.name));
      if (!bytes) throw new MslabError(`${FILES.runFile(id, f.name)} is missing`);
      const file = `${base}-file-${k + 1}.bin`;
      ctx.write(file, bytes);
      saved.push({ name: f.name, mediaType: f.mediaType, file });
    }
    runs.push({
      file: `${base}.json`,
      network: `${base}-network.txt`,
      lines: `${base}-lines.txt`,
      replay: replay ? `${base}-replay.gz` : null,
      files: saved,
    });
  }

  return {
    // A file of an older minor version is read as it is (minor versions only add); only a migration step
    // changes its version.
    formatVersion: migrated.version,
    migratedFrom: migrated.version === version ? null : version,
    appVersion: manifest.app.version,
    project,
    plugins,
    drawings,
    runs,
    results,
    comments,
    history,
    fetched,
    skipped,
  };
}

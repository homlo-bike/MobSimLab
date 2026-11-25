import { createHash } from "node:crypto";
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
    // Map data (format 1.1) is for the static viewer; this MobSimLab loads its own.
    if (FILE_PATTERNS.map.test(name)) {
      hasMap = true;
      continue;
    }
    throw new MslabError(`${name} is not a file a MobSimLab project file can hold`);
  }

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
    skipped,
  };
}

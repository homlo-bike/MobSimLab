import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { z } from "zod";
import { DATABASE, type Database } from "../db/database";
import { GeodataService } from "../geodata/geodata.service";
import { BUNDLED } from "../plugins/validate";
import { PROJECT_MODES } from "../projects/projects.controller";
import { DRAWING_KINDS, isDrawingKind, MAX_DRAWING_BYTES } from "../projects/drawings";
import { INPUTS_PATTERN, isResultKind, MAX_RESULT_BYTES } from "../projects/results";
import {
  MAX_FILE_HISTORY,
  type ProjectActor,
  ProjectsService,
  type ProjectSummary,
  valueState,
} from "../projects/projects.service";
import { projectChain } from "../audit/audit.service";
import { COMMENT_OBJECT_TYPES, MAX_COMMENTS_PER_PROJECT } from "../comments/comments.service";
import { VALUE_CHANGED, VALUE_OBJECT, VALUE_REASON } from "../projects/value-history";
import { ToolFailedError, ToolInputError, ToolRunner } from "../tool-runner/runner";
import { writeZip } from "../tool-runner/zip.mts";
import {
  FILES,
  FINISHED_RUN_STATUSES,
  FORMAT_NAME,
  FORMAT_VERSION,
  FORMAT_VERSION_COMMENTS,
  FORMAT_VERSION_MAP,
  FORMAT_VERSION_POLYGONS,
  FORMAT_VERSION_RESULTS,
  FORMAT_VERSION_WITHOUT_MAP,
  type Manifest,
  MAX_MSLAB_BYTES,
  MSLAB_ZIP_LIMITS,
  type PluginsFile,
  type ProjectFile,
  RUN_KINDS,
  type ResultFile,
  type RunFile,
  type CommentsFile,
  type HistoryFile,
} from "./format.mts";
import type { MslabReadResult } from "./read.mts";
import { storedPolygons } from "../projects/area-polygons";
import { areaRoundDrawing } from "../projects/project-area";
import { type MapDataSummary, MslabMapService } from "./map-data";
import {
  ALL_FETCHED,
  type FetchedChoice,
  type FetchedCounts,
  type FetchedSummary,
  MslabFetchedService,
  parseFetched,
} from "./fetched";

/** The API's version, written into each file's manifest. */
const APP_VERSION = (() => {
  try {
    return (
      JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }
    ).version;
  } catch {
    return "0.0.0";
  }
})();

/** Room left in a file for its manifest and attribution when fetched data fills it. */
const FETCHED_MARGIN_BYTES = 8 * 1024 * 1024;

/** Limits of the sandboxed reader: a file of up to 200 MB that unpacks to up to 512 MB. */
const READ_LIMITS = {
  inputBytes: MAX_MSLAB_BYTES,
  memoryMb: 2048,
  cpuSeconds: 120,
  wallMs: 180_000,
  outputBytes: 1024 * 1024,
  fileBytes: MSLAB_ZIP_LIMITS.fileBytes,
};

/** What the reader returns, checked again here: the API trusts nothing that comes out of the sandbox. */
const scratchName = z.string().regex(/^[A-Za-z0-9_-]{1,80}(\.[A-Za-z0-9]{1,10}){0,2}$/);
const readResult = z.object({
  formatVersion: z.string().max(20),
  migratedFrom: z.string().max(20).nullable(),
  appVersion: z.string().max(40),
  project: z.object({
    id: z.string().max(36),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    areaName: z.string().max(200).nullable(),
    modes: z.array(z.string().max(40)).max(20),
    areaPolygons: z
      .array(
        z.object({
          id: z.string().max(41),
          name: z.string().max(200),
          detail: z.enum(["full", "main"]),
          ring: z.array(z.tuple([z.number(), z.number()])).max(2001),
        }),
      )
      .max(50)
      .optional(),
  }),
  plugins: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        enabled: z.boolean(),
        version: z.string().max(64).nullable(),
      }),
    )
    .max(500),
  drawings: z.array(z.object({ kind: z.string().max(40), file: scratchName })).max(200),
  runs: z
    .array(
      z.object({
        file: scratchName,
        network: scratchName,
        lines: scratchName,
        replay: scratchName.nullable(),
        files: z
          .array(
            z.object({
              name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
              mediaType: z.string().min(1).max(100),
              file: scratchName,
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .max(2000),
  results: z
    .array(z.object({ kind: z.string().max(40), file: scratchName }))
    .max(100)
    .optional(),
  comments: scratchName.nullable().optional(),
  history: scratchName.nullable().optional(),
  fetched: z
    .object({
      facts: scratchName.nullable(),
      live: z.array(scratchName).max(2000),
      elevation: z
        .object({
          index: scratchName,
          chunks: z.array(z.object({ n: z.number().int().min(1).max(9999), file: scratchName })).max(2000),
        })
        .nullable(),
      population: z
        .object({
          index: scratchName,
          files: z
            .array(
              z.object({
                layer: z.number().int().min(1).max(50),
                n: z.number().int().min(1).max(9999),
                file: scratchName,
              }),
            )
            .max(2000),
        })
        .nullable(),
      osm: z
        .object({ index: scratchName, chunks: z.array(scratchName).min(1).max(999) })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  skipped: z.array(z.string().max(300)).max(500),
}) satisfies z.ZodType<
  Omit<MslabReadResult, "project"> & { project: Omit<ProjectFile, "createdAt" | "updatedAt"> }
>;

const isoDate = z.iso.datetime({ offset: true });
const runFile = z.object({
  id: z.uuid(),
  kind: z.enum(RUN_KINDS),
  status: z.enum(FINISHED_RUN_STATUSES),
  input: z.record(z.string(), z.unknown()),
  progress: z.unknown(),
  result: z.unknown(),
  error: z.string().max(2000).nullable(),
  createdAt: isoDate,
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});

const nameOrNull = z.string().max(200).nullable();
const commentsFile = z.object({
  comments: z
    .array(
      z.object({
        id: z.uuid(),
        objectType: z.string().regex(/^[a-z][a-z-]{1,39}$/),
        objectId: z.string().min(1).max(100),
        parentId: z.uuid().nullable(),
        body: z.string().max(4000),
        author: nameOrNull,
        createdAt: isoDate,
        editedAt: isoDate.nullable(),
        resolvedAt: isoDate.nullable(),
        resolvedBy: nameOrNull,
      }),
    )
    .max(MAX_COMMENTS_PER_PROJECT),
});
const stateInFile = z.object({
  value: z.number().finite().nullable(),
  reason: z.string().max(500).nullable(),
});
const historyFile = z.object({
  entries: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/)
          .max(120),
        kind: z.enum(["changed", "reason"]),
        before: stateInFile,
        after: stateInFile,
        reason: z.string().max(500).nullable(),
        at: isoDate,
        by: nameOrNull,
      }),
    )
    .max(MAX_FILE_HISTORY),
});

/** Size limits of a run's columns (db/migrations/0007, 0009). */
const RUN_LIMITS = {
  input: 65536,
  network: 67108864,
  lines: 8388608,
  json: 8388608,
  replay: 67108864,
  file: 268435456,
};

/** Purpose: SHA-256 of bytes, lower-case hex. */
function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Purpose: a project name not in `taken`: the name itself, else the name with the first free number from 2,
 * "Name (2)", "Name (3)"…, cut to the 200 characters a name may have.
 */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim()));
  if (!used.has(name.trim())) return name;
  for (let k = 2; ; k++) {
    const suffix = ` (${k})`;
    const n = `${name.slice(0, 200 - suffix.length)}${suffix}`;
    if (!used.has(n)) return n;
  }
}

/** Purpose: a file name for a project: its name with only safe characters. */
export function mslabFileName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "project"}.mslab`;
}

/** What an import created and what it left out. */
export interface ImportOutcome {
  project: ProjectSummary;
  /** What the file holds that this MobSimLab could not take, each with the reason. */
  skipped: string[];
  /** The file's format version when it was upgraded on the way in. */
  migratedFrom: string | null;
}

/**
 * Save a project as a `.mslab` file and open one as a new project (ADR-0021). Export reads the project from the
 * database in the API; import reads the uploaded file only in the sandboxed tool-runner (`mslab-read`) and
 * saves what it returns after checking it once more.
 */
@Injectable()
export class MslabService {
  private readonly logger = new Logger(MslabService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly tools: ToolRunner,
    private readonly map: MslabMapService,
    private readonly fetched: MslabFetchedService,
    // Absent when the API is assembled without imports (some tests): a file's map extract is then skipped.
    @Optional() private readonly geodata?: GeodataService,
  ) {}

  /**
   * Purpose: the project as a `.mslab` file. Members may save a copy; people who see the project only because it
   * is public may not (403), as they may not duplicate it.
   * Inputs: `includeRuns` adds the finished simulation runs, `includeMap` the viewer's map data and
   * `includeResults` the results the tools worked out; `includeVehicles` false leaves out the own vehicles and fleet;
   * `includeComments` and `includeHistory` add the comments and the history of changed values (format 1.5);
   * `fetched` names the kinds of fetched and imported data to add (format 1.6): location facts, live tiles,
   * elevation and population layers.
   * Output: the file name and bytes.
   * Side effects: audit `project.exported` (runs included, size).
   */
  async export(
    actor: ProjectActor,
    id: string,
    includeRuns: boolean,
    includeMap = false,
    includeResults = true,
    includeVehicles = true,
    includeComments = true,
    includeHistory = true,
    fetched: FetchedChoice = ALL_FETCHED,
  ): Promise<{ fileName: string; bytes: Buffer }> {
    if ((await this.projects.get(actor, id)).viaPublic)
      throw new ForbiddenException("public projects are read-only; ask the owner for access");
    const p = await this.db
      .selectFrom("project.project")
      .select([
        "id",
        "name",
        "description",
        "area_name",
        "modes",
        "created_at",
        "updated_at",
        "area_polygons",
      ])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const drawings = (
      await this.db
        .selectFrom("project.drawing")
        .select(["kind", "schema_version", "doc", "updated_at"])
        .where("project_id", "=", id)
        .orderBy("kind")
        .execute()
    ).filter((d) => includeVehicles || d.kind !== "fleet");
    const plugins = await this.db
      .selectFrom("project.plugin")
      .select(["plugin_id", "enabled", "version"])
      .where("project_id", "=", id)
      .orderBy("plugin_id")
      .execute();

    const files: [string, Buffer][] = [];
    const add = (name: string, value: unknown) =>
      files.push([
        name,
        Buffer.isBuffer(value)
          ? value
          : Buffer.from(typeof value === "string" ? value : JSON.stringify(value, null, 1)),
      ]);

    const project: ProjectFile = {
      id: p.id,
      name: p.name,
      description: p.description,
      areaName: p.area_name,
      modes: p.modes,
      createdAt: p.created_at.toISOString(),
      updatedAt: p.updated_at.toISOString(),
    };
    const polygons = storedPolygons(p.area_polygons);
    if (polygons.length) project.areaPolygons = polygons;
    add(FILES.project, project);
    const pluginsFile: PluginsFile = {
      plugins: plugins.map((r) => ({ id: r.plugin_id, enabled: r.enabled, version: r.version })),
    };
    add(FILES.plugins, pluginsFile);
    for (const d of drawings)
      add(FILES.drawing(d.kind), {
        kind: d.kind,
        schemaVersion: d.schema_version,
        updatedAt: d.updated_at.toISOString(),
        doc: d.doc,
      });

    // Results the project's tools worked out (format 1.2), so the project opens with them, also in the static
    // viewer, without working them out again.
    const results = !includeResults
      ? []
      : await this.db
          .selectFrom("project.result")
          .select(["kind", "inputs", "body", "computed_at"])
          .where("project_id", "=", id)
          .orderBy("kind")
          .execute();
    let resultCount = 0;
    for (const r of results) {
      let doc: unknown;
      try {
        doc = JSON.parse(gunzipSync(r.body).toString("utf8"));
      } catch {
        continue;
      }
      const file: ResultFile = {
        kind: r.kind,
        inputs: r.inputs,
        computedAt: r.computed_at.toISOString(),
        doc,
      };
      files.push([FILES.result(r.kind), Buffer.from(JSON.stringify(file))]);
      resultCount++;
    }

    let runCount = 0;
    let runFileCount = 0;
    if (includeRuns) {
      const runs = await this.db
        .selectFrom("simulation.run as r")
        .leftJoin("simulation.run_replay as rp", "rp.run_id", "r.id")
        .select([
          "r.id",
          "r.kind",
          "r.status",
          "r.input",
          "r.network",
          "r.lines",
          "r.progress",
          "r.result",
          "r.error",
          "r.created_at",
          "r.started_at",
          "r.finished_at",
          "rp.data as replay",
        ])
        .where("r.project_id", "=", id)
        .where("r.status", "in", [...FINISHED_RUN_STATUSES])
        .orderBy("r.created_at")
        .execute();
      // The files the runs saved next to their results (a demand run's OD matrices), up to the size one file in
      // a .mslab may have.
      const runFiles = runs.length
        ? await this.db
            .selectFrom("simulation.run_file")
            .select(["run_id", "name", "media_type", "content"])
            .where(
              "run_id",
              "in",
              runs.map((r) => r.id),
            )
            .orderBy("run_id")
            .orderBy("name")
            .execute()
        : [];
      for (const r of runs) {
        const saved = runFiles.filter(
          (f) => f.run_id === r.id && f.content.length <= MSLAB_ZIP_LIMITS.fileBytes,
        );
        for (const f of saved) add(FILES.runFile(r.id, f.name), f.content);
        runFileCount += saved.length;
        const run: RunFile = {
          id: r.id,
          kind: r.kind,
          status: r.status as RunFile["status"],
          input: r.input,
          progress: r.progress ?? null,
          result: withRunFiles(
            r.kind,
            r.result ?? null,
            saved.map((f) => f.name),
          ),
          error: r.error,
          createdAt: r.created_at.toISOString(),
          startedAt: r.started_at?.toISOString() ?? null,
          finishedAt: r.finished_at?.toISOString() ?? null,
        };
        if (saved.length) run.files = saved.map((f) => ({ name: f.name, mediaType: f.media_type }));
        add(FILES.run(r.id), run);
        add(FILES.runNetwork(r.id), r.network);
        add(FILES.runLines(r.id), r.lines);
        if (r.replay) add(FILES.runReplay(r.id), r.replay);
        runCount++;
      }
    }
    // Comments with their threads (format 1.5): the names of who wrote and resolved them as text, since the
    // people may not exist on the instance that opens the file.
    let commentCount = 0;
    if (includeComments) {
      const rows = await this.db
        .selectFrom("collab.comment as c")
        .leftJoin("iam.user as a", "a.id", "c.author_id")
        .leftJoin("iam.user as rb", "rb.id", "c.resolved_by")
        .select([
          "c.id",
          "c.object_type",
          "c.object_id",
          "c.parent_id",
          "c.body",
          "c.created_at",
          "c.edited_at",
          "c.resolved_at",
          "c.file_author",
          "c.file_resolved_by",
          "a.display_name as author_name",
          "rb.display_name as resolved_by_name",
        ])
        .where("c.project_id", "=", id)
        .orderBy("c.created_at")
        .orderBy("c.id")
        .execute();
      if (rows.length) {
        const comments: CommentsFile = {
          comments: rows.map((c) => ({
            id: c.id,
            objectType: c.object_type,
            objectId: c.object_id,
            parentId: c.parent_id,
            body: c.body,
            author: (c.author_name ?? c.file_author)?.slice(0, 200) ?? null,
            createdAt: c.created_at.toISOString(),
            editedAt: c.edited_at?.toISOString() ?? null,
            resolvedAt: c.resolved_at?.toISOString() ?? null,
            resolvedBy: c.resolved_at
              ? ((c.resolved_by_name ?? c.file_resolved_by)?.slice(0, 200) ?? null)
              : null,
          })),
        };
        add(FILES.comments, comments);
        commentCount = rows.length;
      }
    }
    // The history of changed values (format 1.5), newest first: the project's own changes, then the history it
    // was opened with, when it came from a file.
    let historyCount = 0;
    if (includeHistory) {
      const own = await this.db
        .selectFrom("audit.record as r")
        .leftJoin("iam.user as u", "u.id", "r.actor_id")
        .select(["r.at", "u.display_name", "r.action", "r.object_id", "r.before", "r.after", "r.reason"])
        .where("r.chain", "=", projectChain(id))
        .where("r.object_type", "=", VALUE_OBJECT)
        .where("r.action", "in", [VALUE_CHANGED, VALUE_REASON])
        .orderBy("r.seq", "desc")
        .limit(MAX_FILE_HISTORY)
        .execute();
      const opened = await this.db
        .selectFrom("project.file_value_history")
        .selectAll()
        .where("project_id", "=", id)
        .orderBy("n")
        .limit(MAX_FILE_HISTORY)
        .execute();
      const entries: HistoryFile["entries"] = [
        ...own
          .filter((r) => r.object_id)
          .map((r) => ({
            id: r.object_id!,
            kind: r.action === VALUE_REASON ? ("reason" as const) : ("changed" as const),
            before: valueState(r.before),
            after: valueState(r.after),
            reason: r.reason?.slice(0, 500) ?? null,
            at: r.at.toISOString(),
            by: r.display_name?.slice(0, 200) ?? null,
          })),
        ...opened.map((r) => ({
          id: r.value_id,
          kind: r.action,
          before: valueState(r.before),
          after: valueState(r.after),
          reason: r.reason,
          at: r.at.toISOString(),
          by: r.by_name,
        })),
      ].slice(0, MAX_FILE_HISTORY);
      if (entries.length) {
        add(FILES.history, { entries } satisfies HistoryFile);
        historyCount = entries.length;
      }
    }
    // Map data for the static viewer (format 1.4): the OpenStreetMap tiles, water, population and country
    // figures of the project area.
    let map: MapDataSummary | null = null;
    if (includeMap) {
      const m = await this.map.files({
        projectId: id,
        docs: Object.fromEntries(drawings.map((d) => [d.kind, d.doc])),
        plugins: plugins.map((r) => ({ id: r.plugin_id, enabled: r.enabled })),
      });
      for (const [name, body] of m.files) add(name, body);
      map = m.summary;
    }
    // The data the project fetched or imported (format 1.6), as far as it fits in what a file may hold.
    const held = files.reduce((n, [, b]) => n + b.length, 0);
    const got = await this.fetched.files(
      id,
      polygons,
      fetched,
      Math.max(0, MSLAB_ZIP_LIMITS.totalBytes - held - FETCHED_MARGIN_BYTES),
    );
    for (const [name, body] of got.files) add(name, body);
    // The oldest version that holds what the file carries, so that older readers still open it.
    const formatVersion = got.files.length
      ? FORMAT_VERSION
      : commentCount || historyCount || runFileCount
        ? FORMAT_VERSION_COMMENTS
        : includeMap
          ? FORMAT_VERSION_MAP
          : polygons.length
            ? FORMAT_VERSION_POLYGONS
            : resultCount
              ? FORMAT_VERSION_RESULTS
              : FORMAT_VERSION_WITHOUT_MAP;
    add(
      FILES.attribution,
      attribution(
        project,
        drawings.map((d) => ({ kind: d.kind, doc: d.doc })),
        runCount,
        formatVersion,
        map,
        got.summary,
      ),
    );

    const manifest: Manifest = {
      format: FORMAT_NAME,
      formatVersion,
      app: { name: "MobSimLab", version: APP_VERSION },
      createdAt: new Date().toISOString(),
      project: { id: p.id, name: p.name },
      includes: includeMap ? { runs: includeRuns, map: true } : { runs: includeRuns },
      files: Object.fromEntries(files.map(([n, b]) => [n, { sha256: sha256(b), bytes: b.length }])),
    };
    const bytes = writeZip([[FILES.manifest, JSON.stringify(manifest, null, 1)], ...files]);
    await this.projects.logProject(
      actor,
      id,
      "project.exported",
      null,
      {
        formatVersion,
        runs: runCount,
        results: resultCount,
        comments: commentCount,
        history: historyCount,
        map: map ? map.tiles : 0,
        facts: got.summary.facts,
        liveTiles: got.summary.liveTiles + got.summary.liveHeights,
        elevationTiles: got.summary.elevationTiles,
        populationLayers: got.summary.populationLayers.length,
        leftOut: got.summary.leftOut,
        bytes: bytes.length,
      },
      this.db,
    );
    return { fileName: mslabFileName(p.name), bytes };
  }

  /**
   * Purpose: open a `.mslab` file as a new project owned by the caller. Never changes an existing project.
   * Inputs: the uploaded bytes. Output: the new project and what was left out.
   * The file is read and checked only in the sandboxed tool-runner; its drawings are checked again against the
   * editors' outlines here. Drawings of tools this MobSimLab lacks, plugins it does not have, and drawings saved
   * by a newer version of a tool are left out and listed in `skipped`.
   * Side effects: audit `project.created` and `project.imported` on the new project's chain.
   */
  async import(actor: ProjectActor, bytes: Buffer): Promise<ImportOutcome> {
    let newId: string;
    let skipped: string[];
    let migratedFrom: string | null;
    try {
      ({ newId, skipped, migratedFrom } = await this.tools.run(
        "mslab-read",
        bytes,
        async (raw, scratch) => {
          const r = readResult.safeParse(raw);
          if (!r.success) throw new ToolFailedError("mslab-read returned an unexpected result");
          const res = r.data;
          const skipped = [...res.skipped];

          const drawings: { kind: keyof typeof DRAWING_KINDS; doc: string }[] = [];
          for (const d of res.drawings) {
            if (!isDrawingKind(d.kind)) {
              skipped.push(`${d.kind}: this MobSimLab does not have this tool`);
              continue;
            }
            const file = JSON.parse((await scratch.read(d.file)).toString("utf8")) as { doc: unknown };
            const doc = DRAWING_KINDS[d.kind].schema.safeParse(file.doc);
            if (!doc.success)
              throw new BadRequestException(
                `data/${d.kind}.json: ${doc.error.issues[0]?.message ?? "not a valid drawing"}`.slice(0, 300),
              );
            const json = JSON.stringify(doc.data);
            if (Buffer.byteLength(json) > MAX_DRAWING_BYTES)
              throw new BadRequestException(`data/${d.kind}.json is larger than a drawing may be`);
            drawings.push({ kind: d.kind, doc: json });
          }

          const runs: {
            m: z.infer<typeof runFile>;
            input: string;
            network: string;
            lines: string;
            progress: string | null;
            result: string | null;
            replay: Buffer | null;
            files: { name: string; mediaType: string; content: Buffer }[];
          }[] = [];
          for (const f of res.runs) {
            const meta = runFile.safeParse(JSON.parse((await scratch.read(f.file)).toString("utf8")));
            if (!meta.success) throw new BadRequestException("a simulation run in the file is not valid");
            const m = meta.data;
            const network = (await scratch.read(f.network)).toString("utf8");
            const lines = (await scratch.read(f.lines)).toString("utf8");
            const replay = f.replay ? await scratch.read(f.replay) : null;
            const runFiles: { name: string; mediaType: string; content: Buffer }[] = [];
            for (const rf of f.files ?? []) {
              const content = await scratch.read(rf.file);
              if (content.length > RUN_LIMITS.file)
                throw new BadRequestException(
                  `simulation run ${m.id} has a file larger than a run file may be`,
                );
              runFiles.push({ name: rf.name, mediaType: rf.mediaType, content });
            }
            const input = JSON.stringify(m.input);
            const progress = m.progress == null ? null : JSON.stringify(m.progress);
            const result = m.result == null ? null : JSON.stringify(m.result);
            if (
              Buffer.byteLength(input) >= RUN_LIMITS.input ||
              network.length > RUN_LIMITS.network ||
              lines.length > RUN_LIMITS.lines ||
              (progress && Buffer.byteLength(progress) >= RUN_LIMITS.json) ||
              (result && Buffer.byteLength(result) >= RUN_LIMITS.json) ||
              (replay && replay.length > RUN_LIMITS.replay)
            )
              throw new BadRequestException(`simulation run ${m.id} is larger than a run may be`);
            runs.push({ m, input, network, lines, progress, result, replay, files: runFiles });
          }

          const results: { kind: string; inputs: string; computedAt: Date; body: Buffer }[] = [];
          for (const f of res.results ?? []) {
            if (!isResultKind(f.kind)) {
              skipped.push(`${f.kind}: this MobSimLab does not keep this kind of result`);
              continue;
            }
            const file = JSON.parse((await scratch.read(f.file)).toString("utf8")) as ResultFile;
            const body = gzipSync(JSON.stringify(file.doc));
            if (
              file.kind !== f.kind ||
              !INPUTS_PATTERN.test(file.inputs) ||
              Number.isNaN(Date.parse(file.computedAt)) ||
              body.length > MAX_RESULT_BYTES
            ) {
              skipped.push(`${f.kind}: the saved result is not valid`);
              continue;
            }
            results.push({ kind: f.kind, inputs: file.inputs, computedAt: new Date(file.computedAt), body });
          }

          // Comments (format 1.5): threads on objects this MobSimLab knows, replies after their first comment.
          const comments: z.infer<typeof commentsFile>["comments"] = [];
          if (res.comments) {
            const parsed = commentsFile.safeParse(
              JSON.parse((await scratch.read(res.comments)).toString("utf8")),
            );
            if (!parsed.success)
              throw new BadRequestException(
                "the comments or the history of changed values in the file are not valid",
              );
            const firsts = new Set<string>();
            for (const c of parsed.data.comments)
              if (
                c.parentId === null &&
                (COMMENT_OBJECT_TYPES as readonly string[]).includes(c.objectType) &&
                c.body.trim()
              ) {
                comments.push(c);
                firsts.add(c.id);
              }
            for (const c of parsed.data.comments)
              if (c.parentId !== null && firsts.has(c.parentId) && c.body.trim()) comments.push(c);
            const left = parsed.data.comments.length - comments.length;
            if (left > 0)
              skipped.push(
                `${left} comment${left === 1 ? "" : "s"}: on objects this MobSimLab does not have, or replies without their thread`,
              );
          }
          const history = res.history
            ? historyFile.safeParse(JSON.parse((await scratch.read(res.history)).toString("utf8")))
            : null;
          if (history && !history.success)
            throw new BadRequestException(
              "the comments or the history of changed values in the file are not valid",
            );
          const historyEntries = history?.success ? history.data.entries : [];
          // Fetched and imported data (format 1.6).
          const fetchedData = res.fetched ? await parseFetched(res.fetched, (n) => scratch.read(n)) : null;

          const installed = await this.db
            .selectFrom("plugin.package")
            .select(["plugin_id", "version"])
            .execute();
          const plugins = res.plugins.filter((pl) => {
            const ok =
              pl.version === null
                ? BUNDLED.some((b) => b.id === pl.id)
                : installed.some((i) => i.plugin_id === pl.id && i.version === pl.version);
            if (!ok)
              skipped.push(
                `plugin ${pl.id}${pl.version ? ` ${pl.version}` : ""}: not installed on this MobSimLab`.slice(
                  0,
                  300,
                ),
              );
            return ok;
          });

          const modes = [...new Set(res.project.modes)].filter((m): m is (typeof PROJECT_MODES)[number] =>
            (PROJECT_MODES as readonly string[]).includes(m),
          );
          // A file saved before projects had drawn polygons carries no area: the box round its drawing, as the
          // project area then was, so the imported project can load its map data straight away.
          const saved = storedPolygons(res.project.areaPolygons);
          const area = saved.length
            ? saved
            : areaRoundDrawing(
                Object.fromEntries(drawings.map((d) => [d.kind, JSON.parse(d.doc) as unknown])),
                res.project.areaName ?? res.project.name,
              );
          const newId = await this.db.transaction().execute(async (tx) => {
            const now = new Date();
            // A name the importer already uses gets a number: "Damascus (2)", "Damascus (3)"…
            const taken = await tx
              .selectFrom("project.project as p")
              .innerJoin("project.member as m", "m.project_id", "p.id")
              .select("p.name")
              .where("m.user_id", "=", actor.userId)
              .where("p.deleted_at", "is", null)
              .execute();
            const name = freeName(
              res.project.name,
              taken.map((r) => r.name),
            );
            const p = await tx
              .insertInto("project.project")
              .values({
                name,
                description: res.project.description,
                area_name: res.project.areaName,
                area_polygons: JSON.stringify(area),
                modes,
                copied_from: null,
                updated_at: now,
                archived_at: null,
                deleted_at: null,
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            await tx
              .insertInto("project.member")
              .values({ project_id: p.id, user_id: actor.userId, role: "owner", added_by: actor.userId })
              .execute();
            for (const d of drawings)
              await tx
                .insertInto("project.drawing")
                .values({
                  project_id: p.id,
                  kind: d.kind,
                  schema_version: DRAWING_KINDS[d.kind].schemaVersion,
                  doc: d.doc,
                  updated_by: actor.userId,
                  updated_at: now,
                })
                .execute();
            for (const pl of plugins)
              await tx
                .insertInto("project.plugin")
                .values({
                  project_id: p.id,
                  plugin_id: pl.id,
                  enabled: pl.enabled,
                  version: pl.version,
                  updated_by: actor.userId,
                  updated_at: now,
                })
                .execute();
            for (const r of results)
              await tx
                .insertInto("project.result")
                .values({
                  project_id: p.id,
                  kind: r.kind,
                  inputs: r.inputs,
                  body: r.body,
                  computed_by: actor.userId,
                  computed_at: r.computedAt,
                })
                .execute();
            for (const r of runs) {
              // New ids: the same file may be opened more than once on one instance.
              const run = await tx
                .insertInto("simulation.run")
                .values({
                  project_id: p.id,
                  kind: r.m.kind,
                  status: r.m.status,
                  input: r.input,
                  network: r.network,
                  lines: r.lines,
                  progress: r.progress,
                  result: r.result,
                  error: r.m.error,
                  created_by: actor.userId,
                  created_at: new Date(r.m.createdAt),
                  started_at: r.m.startedAt ? new Date(r.m.startedAt) : null,
                  finished_at: r.m.finishedAt ? new Date(r.m.finishedAt) : null,
                })
                .returning("id")
                .executeTakeFirstOrThrow();
              if (r.replay)
                await tx
                  .insertInto("simulation.run_replay")
                  .values({ run_id: run.id, data: r.replay })
                  .execute();
              for (const f of r.files)
                await tx
                  .insertInto("simulation.run_file")
                  .values({ run_id: run.id, name: f.name, media_type: f.mediaType, content: f.content })
                  .execute();
            }
            // New ids for the comments, the replies pointing at their thread's new first comment.
            const newIds = new Map<string, string>();
            for (const c of comments) {
              const row = await tx
                .insertInto("collab.comment")
                .values({
                  project_id: p.id,
                  object_type: c.objectType,
                  object_id: c.objectId,
                  parent_id: c.parentId ? newIds.get(c.parentId)! : null,
                  body: c.body,
                  author_id: null,
                  created_at: new Date(c.createdAt),
                  edited_at: c.editedAt ? new Date(c.editedAt) : null,
                  resolved_at: c.parentId === null && c.resolvedAt ? new Date(c.resolvedAt) : null,
                  resolved_by: null,
                  from_file: true,
                  file_author: c.author,
                  file_resolved_by: c.parentId === null && c.resolvedAt ? c.resolvedBy : null,
                })
                .returning("id")
                .executeTakeFirstOrThrow();
              newIds.set(c.id, row.id);
            }
            for (const [n, e] of historyEntries.entries())
              await tx
                .insertInto("project.file_value_history")
                .values({
                  project_id: p.id,
                  n,
                  at: new Date(e.at),
                  by_name: e.by,
                  action: e.kind,
                  value_id: e.id,
                  before: JSON.stringify(e.before),
                  after: JSON.stringify(e.after),
                  reason: e.reason,
                })
                .execute();
            const stored: FetchedCounts = fetchedData
              ? await this.fetched.restore(tx, p.id, actor.userId, fetchedData)
              : { facts: 0, live: 0, elevationTiles: 0, populationLayers: 0 };
            await this.projects.logProject(
              actor,
              p.id,
              "project.created",
              null,
              { name, imported: true },
              tx,
            );
            await this.projects.logProject(
              actor,
              p.id,
              "project.imported",
              null,
              {
                formatVersion: res.migratedFrom ?? res.formatVersion,
                appVersion: res.appVersion,
                sourceProjectId: res.project.id,
                drawings: drawings.map((d) => d.kind),
                plugins: plugins.length,
                runs: runs.length,
                results: results.length,
                comments: comments.length,
                history: historyEntries.length,
                fetched: stored,
                skipped: skipped.length,
                bytes: bytes.length,
              },
              tx,
            );
            return p.id;
          });
          // The map extract is imported by a job, as an uploaded extract is; the project opens meanwhile.
          if (fetchedData?.osm) {
            let queued = false;
            try {
              queued = !!(await this.geodata?.restoreOsm(
                actor,
                newId,
                fetchedData.osm.body,
                fetchedData.osm.index,
              ));
            } catch (e) {
              this.logger.warn(`mslab import: the map extract was not queued: ${(e as Error).message}`);
            }
            if (!queued) skipped.push("the map extract: it could not be imported here");
          }
          return { newId, skipped, migratedFrom: res.migratedFrom };
        },
        READ_LIMITS,
      ));
    } catch (e) {
      if (e instanceof ToolInputError)
        throw new BadRequestException(`This file cannot be opened: ${e.message}`);
      if (e instanceof ToolFailedError) {
        this.logger.warn(`mslab import failed: ${e.message}`);
        throw new BadRequestException("This file cannot be opened: it could not be read safely");
      }
      throw e;
    }
    return { project: await this.projects.get(actor, newId), skipped, migratedFrom };
  }
}

/**
 * Purpose: ATTRIBUTION.md: what the file holds and the sources the project refers to (ADR-0021). Reference
 * data (OpenStreetMap, terrain, population) is not in the file; the project refers to it by id or position.
 */
/**
 * Purpose: a demand run's result listing only the saved files (the OD matrices) the `.mslab` file carries; other
 * results as they are.
 */
export function withRunFiles(kind: string, result: unknown, carried: readonly string[]): unknown {
  if (kind !== "demand" || !result || typeof result !== "object" || !("files" in result)) return result;
  const listed = (result as { files?: unknown }).files;
  return {
    ...(result as Record<string, unknown>),
    files: Array.isArray(listed) ? listed.filter((f) => typeof f === "string" && carried.includes(f)) : [],
  };
}

/** Purpose: the Contents lines of ATTRIBUTION.md for the fetched data in `fetched/`. */
function fetchedContents(f: FetchedSummary): string[] {
  const out: string[] = [];
  if (f.facts)
    out.push(`- ${f.facts} looked-up location facts (country, holidays, climate, economy figures)`);
  if (f.liveTiles) out.push(`- ${f.liveTiles} map tiles the tools fetched live`);
  if (f.elevationTiles || f.liveHeights)
    out.push(`- elevation: ${f.elevationTiles} tiles and ${f.liveHeights} heights fetched live`);
  if (f.populationLayers.length) out.push(`- ${f.populationLayers.length} population layers`);
  if (f.osmBytes)
    out.push(`- the OpenStreetMap extract of the project area (${(f.osmBytes / 1_048_576).toFixed(1)} MB)`);
  for (const kind of f.leftOut)
    out.push(`- not included, because the file would be larger than a project file may be: ${kind}`);
  return out;
}

/** Purpose: the Sources lines of ATTRIBUTION.md for the fetched data in `fetched/`. */
function fetchedSources(f: FetchedSummary): string[] {
  const out: string[] = [];
  const line = (s: string) => s.replace(/[\r\n]/g, " ").slice(0, 400);
  if (f.osmBytes)
    out.push(
      line(
        `- The map extract in \`fetched/\` is OpenStreetMap data © OpenStreetMap contributors, available under the Open Database Licence (ODbL 1.0): https://www.openstreetmap.org/copyright${f.osmVia ? `, got from ${f.osmVia}` : ""}. Share it under the ODbL.`,
      ),
    );
  if (f.liveTiles)
    out.push(
      "- The map tiles in `fetched/` are OpenStreetMap data © OpenStreetMap contributors, available under the",
      "  Open Database Licence (ODbL 1.0): https://www.openstreetmap.org/copyright. Share them under the ODbL.",
    );
  for (const s of new Set(f.elevationSources)) out.push(line(`- Elevation in \`fetched/\`: ${s}.`));
  if (f.liveHeights && !f.elevationSources.length)
    out.push(
      "- Heights in `fetched/`: Copernicus GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA).",
    );
  for (const l of f.populationLayers)
    out.push(
      line(
        `- Population layer "${l.name}" in \`fetched/\`: ${
          l.source === "worldpop" ? "WorldPop" : l.source === "ghsl" ? "GHSL" : "the planner's own data"
        }${l.licence ? `, ${l.licence}` : ""}.`,
      ),
    );
  if (f.facts)
    out.push(
      "- Location facts in `fetched/facts.json`: OpenStreetMap (country), Nager.Date (public holidays),",
      "  Open-Meteo (climate, CC BY 4.0) and World Bank Open Data (economy figures, CC BY 4.0).",
    );
  return out;
}

function attribution(
  project: ProjectFile,
  drawings: { kind: string; doc: unknown }[],
  runs: number,
  formatVersion: string,
  map: MapDataSummary | null,
  fetched: FetchedSummary | null = null,
): string {
  const lines = [
    `# ${project.name}`,
    "",
    `MobSimLab project file, format ${formatVersion}, saved ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "## Contents",
    "",
    ...drawings.map((d) => `- \`data/${d.kind}.json\``),
    `- ${runs} simulation run${runs === 1 ? "" : "s"}`,
    ...(map
      ? [
          `- map data: ${map.tiles} map tiles (${map.kinds.join(", ")}), water, population and country figures`,
        ]
      : []),
    ...(fetched ? fetchedContents(fetched) : []),
    "",
    "## Sources",
    "",
    ...(map
      ? [
          "- The map data in `map/` (streets, paths, railways, buildings, places, water and the country at the",
          "  project area) is OpenStreetMap data © OpenStreetMap contributors, available under the Open Database",
          "  Licence (ODbL 1.0): https://www.openstreetmap.org/copyright. Share it under the ODbL.",
          `- Population in \`map/population.json\`: ${map.population ?? "not included (no population grid was ready)"}.`,
          "- Country figures in `map/reference.json`: World Bank Open Data, CC BY 4.0.",
        ]
      : [
          "- Street, railway and place references (OpenStreetMap way ids and positions) refer to OpenStreetMap data",
          "  © OpenStreetMap contributors, available under the Open Database Licence (ODbL 1.0). The OpenStreetMap",
          "  data itself is not in this file.",
        ]),
  ];
  if (fetched) lines.push(...fetchedSources(fetched));
  const gtfs = drawings.find((d) => d.kind === "gtfs-network")?.doc as
    { feeds?: { name?: unknown }[] } | undefined;
  for (const f of gtfs?.feeds ?? [])
    if (typeof f.name === "string" && f.name)
      lines.push(
        `- GTFS feed "${f.name.replace(/[\r\n]/g, " ")}": timetable imported by the planner; see the feed's own licence.`,
      );
  return `${lines.join("\n")}\n`;
}

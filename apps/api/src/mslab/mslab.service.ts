import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { DATABASE, type Database } from "../db/database";
import { BUNDLED } from "../plugins/validate";
import { PROJECT_MODES } from "../projects/projects.controller";
import { DRAWING_KINDS, isDrawingKind, MAX_DRAWING_BYTES } from "../projects/drawings";
import { INPUTS_PATTERN, isResultKind, MAX_RESULT_BYTES } from "../projects/results";
import { type ProjectActor, ProjectsService, type ProjectSummary } from "../projects/projects.service";
import { ToolFailedError, ToolInputError, ToolRunner } from "../tool-runner/runner";
import { writeZip } from "../tool-runner/zip.mts";
import {
  FILES,
  FINISHED_RUN_STATUSES,
  FORMAT_NAME,
  FORMAT_VERSION,
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
} from "./format.mts";
import type { MslabReadResult } from "./read.mts";
import { storedPolygons } from "../projects/area-polygons";
import { type MapDataSummary, MslabMapService } from "./map-data";

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
      }),
    )
    .max(2000),
  results: z
    .array(z.object({ kind: z.string().max(40), file: scratchName }))
    .max(100)
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

/** Size limits of a run's columns (db/migrations/0007, 0009). */
const RUN_LIMITS = { input: 65536, network: 67108864, lines: 8388608, json: 8388608, replay: 67108864 };

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
  ) {}

  /**
   * Purpose: the project as a `.mslab` file. Members may save a copy; people who see the project only because it
   * is public may not (403), as they may not duplicate it.
   * Inputs: `includeRuns` adds the finished simulation runs. Output: the file name and bytes.
   * Side effects: audit `project.exported` (runs included, size).
   */
  async export(
    actor: ProjectActor,
    id: string,
    includeRuns: boolean,
    includeMap = false,
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
    const drawings = await this.db
      .selectFrom("project.drawing")
      .select(["kind", "schema_version", "doc", "updated_at"])
      .where("project_id", "=", id)
      .orderBy("kind")
      .execute();
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
    const results = await this.db
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
      for (const r of runs) {
        const run: RunFile = {
          id: r.id,
          kind: r.kind,
          status: r.status as RunFile["status"],
          input: r.input,
          progress: r.progress ?? null,
          result: withoutRunFiles(r.kind, r.result ?? null),
          error: r.error,
          createdAt: r.created_at.toISOString(),
          startedAt: r.started_at?.toISOString() ?? null,
          finishedAt: r.finished_at?.toISOString() ?? null,
        };
        add(FILES.run(r.id), run);
        add(FILES.runNetwork(r.id), r.network);
        add(FILES.runLines(r.id), r.lines);
        if (r.replay) add(FILES.runReplay(r.id), r.replay);
        runCount++;
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
    // The oldest version that holds what the file carries, so that older readers still open it.
    const formatVersion = includeMap
      ? FORMAT_VERSION
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
      { formatVersion, runs: runCount, results: resultCount, map: map ? map.tiles : 0, bytes: bytes.length },
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
          }[] = [];
          for (const f of res.runs) {
            const meta = runFile.safeParse(JSON.parse((await scratch.read(f.file)).toString("utf8")));
            if (!meta.success) throw new BadRequestException("a simulation run in the file is not valid");
            const m = meta.data;
            const network = (await scratch.read(f.network)).toString("utf8");
            const lines = (await scratch.read(f.lines)).toString("utf8");
            const replay = f.replay ? await scratch.read(f.replay) : null;
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
            runs.push({ m, input, network, lines, progress, result, replay });
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
                area_polygons: JSON.stringify(storedPolygons(res.project.areaPolygons)),
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
            }
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
                skipped: skipped.length,
                bytes: bytes.length,
              },
              tx,
            );
            return p.id;
          });
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
 * Purpose: a demand run's result without its list of saved files (the OD matrices), which a `.mslab` file does
 * not carry; other results as they are.
 */
function withoutRunFiles(kind: string, result: unknown): unknown {
  if (kind !== "demand" || !result || typeof result !== "object" || !("files" in result)) return result;
  return { ...(result as Record<string, unknown>), files: [] };
}

function attribution(
  project: ProjectFile,
  drawings: { kind: string; doc: unknown }[],
  runs: number,
  formatVersion: string,
  map: MapDataSummary | null,
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
  const gtfs = drawings.find((d) => d.kind === "gtfs-network")?.doc as
    { feeds?: { name?: unknown }[] } | undefined;
  for (const f of gtfs?.feeds ?? [])
    if (typeof f.name === "string" && f.name)
      lines.push(
        `- GTFS feed "${f.name.replace(/[\r\n]/g, " ")}": timetable imported by the planner; see the feed's own licence.`,
      );
  return `${lines.join("\n")}\n`;
}

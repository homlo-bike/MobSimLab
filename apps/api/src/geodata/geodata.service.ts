import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  PayloadTooLargeException,
} from "@nestjs/common";
import { sql } from "kysely";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { DATABASE, type Database } from "../db/database";
import { CopernicusDemClient, TERRAIN_SOURCE, cellName } from "../gateway/copernicus-dem.client";
import { GeofabrikClient, type GeofabrikRegion } from "../gateway/geofabrik.client";
import { OverpassClient, overpassEndpoint } from "../gateway/overpass.client";
import { projectArea } from "../projects/project-area";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";

import { cutTiles, type DemTile, encodeValues, tileBounds } from "./dem-tiles";
import { DemUploadError, resampleDem } from "./dem-upload";
import { type Box, OsmTools } from "./osm-tools";
import { fetchArea } from "./overpass-import";
import { bboxAreaKm2, type GeodataSettings, geodataDirs, geodataSettings } from "./settings";

/** Kinds of import (db/migrations/0017). */
export type ImportKind = "osm" | "dem" | "dem_upload";
export type ImportMethod = "overpass" | "geofabrik" | "upload" | "copernicus" | "geotiff";
export type ImportStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** One import run as the API answers it. */
export interface ImportRun {
  id: string;
  kind: ImportKind;
  method: ImportMethod;
  status: ImportStatus;
  bbox: Box;
  bufferKm: number;
  options: Record<string, unknown>;
  progress: { step?: string; done?: number; total?: number };
  stats: Record<string, unknown>;
  source: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** The OSM licence and attribution recorded with every OpenStreetMap import (06-gis §2.1). */
export const OSM_SOURCE = {
  name: "OpenStreetMap",
  url: "https://www.openstreetmap.org/copyright",
  licence: "© OpenStreetMap contributors, ODbL 1.0",
} as const;

/** The staging schema osm2pgsql writes into (db/migrations/0017). */
const STAGE = "geo_stage";
/** pg_advisory_lock key: one osm2pgsql run uses the staging schema at a time, across processes. */
const STAGE_LOCK = 7_316_525_311;

/** Columns copied from each staging table into `geo.<table>`, after osm_type, osm_id and tags. */
export const OSM_TABLES: Record<string, string[]> = {
  osm_way_road: [
    "highway",
    "name",
    "oneway",
    "maxspeed",
    "lanes",
    "bridge",
    "tunnel",
    "layer",
    "is_cycle",
    "is_foot",
  ],
  osm_way_rail: ["railway", "name", "bridge", "tunnel", "layer"],
  osm_building: ["building", "levels", "height"],
  osm_landuse: ["class", "value"],
  osm_water: ["class", "value"],
  osm_pt: ["name", "kind"],
  osm_poi: ["class", "name"],
  osm_barrier: ["barrier"],
  osm_place: ["place", "name"],
  osm_structure: ["kind", "carries", "layer"],
};

/** Raised inside a job when the planner cancelled it. */
class Cancelled extends Error {}

interface Row {
  id: string;
  kind: ImportKind;
  method: ImportMethod;
  status: ImportStatus;
  bbox: number[];
  buffer_km: string;
  options: Record<string, unknown>;
  progress: ImportRun["progress"];
  stats: Record<string, unknown>;
  source: Record<string, unknown>;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

function toRun(r: Row): ImportRun {
  return {
    id: r.id,
    kind: r.kind,
    method: r.method,
    status: r.status,
    bbox: r.bbox.map(Number) as Box,
    bufferKm: Number(r.buffer_km),
    options: r.options,
    progress: r.progress,
    stats: r.stats,
    source: r.source,
    error: r.error,
    createdAt: r.created_at.toISOString(),
    startedAt: r.started_at?.toISOString() ?? null,
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

/**
 * Imports OpenStreetMap data and elevation into PostGIS per project area (06-gis §2 and §4, ADR-0045).
 * Imports run in the API process, one at a time, in the order they were asked for; their state is in
 * `geo.import`, so the panel shows progress and the result after a reload. An import that was running when the
 * server stopped is marked failed at the next start. Owners and Editors start imports; every member reads them.
 */
@Injectable()
export class GeodataService implements OnApplicationBootstrap {
  private readonly log = new Logger("Geodata");
  readonly settings: GeodataSettings;
  private readonly dirs: ReturnType<typeof geodataDirs>;
  private readonly tools: OsmTools;
  private readonly geofabrik: GeofabrikClient;
  private readonly overpass: OverpassClient;
  private chain: Promise<void> = Promise.resolve();
  private readonly cancelled = new Set<string>();
  /** Called when an import finishes, so readers drop what they cached for the project. */
  private readonly listeners: Array<(projectId: string) => void> = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly dem: CopernicusDemClient,
  ) {
    this.settings = geodataSettings();
    this.dirs = geodataDirs(this.settings);
    this.tools = new OsmTools(this.settings.toolTimeoutMin * 60_000);
    this.geofabrik = new GeofabrikClient({
      baseUrl: this.settings.geofabrikUrl,
      dir: this.dirs.geofabrik,
      cacheDays: this.settings.geofabrikCacheDays,
      maxBytes: this.settings.maxPbfMb * 1024 * 1024,
      timeoutMs: 60_000,
      fetchImpl: (...a) => fetch(...a),
    });
    const op = this.settings.overpass;
    this.overpass = new OverpassClient({
      timeoutMs: (op.queryTimeoutS + 30) * 1000,
      maxBytes: op.maxResponseMb * 1024 * 1024,
      minIntervalMs: op.intervalS * 1000,
      backoffMs: [2_000, 4_000, 8_000, 16_000, 32_000],
      retryTimeouts: false,
    });
  }

  /** Purpose: mark imports left queued or running by a stopped server as failed. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await sql`UPDATE geo.import SET status = 'failed', finished_at = now(),
                error = 'The server restarted during the import. Start it again.'
                WHERE status IN ('queued', 'running')`.execute(this.db);
    } catch (e) {
      this.log.warn(`Could not settle unfinished imports: ${(e as Error).message}`);
    }
  }

  /** Purpose: be told when a project's imported data changes. */
  onChange(fn: (projectId: string) => void): void {
    this.listeners.push(fn);
  }

  /**
   * Purpose: what the import panel shows: the project area, the current and latest import of each kind, whether
   * the current imports still cover the area, and the limits.
   */
  async status(actor: ProjectActor, projectId: string) {
    const role = await this.projects.access(actor, projectId, "read");
    const area = await projectArea(this.db, projectId);
    const { rows } = await sql<Row>`
      SELECT * FROM geo.import WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 30`.execute(
      this.db,
    );
    const runs = rows.map(toRun);
    const of = (kind: ImportKind) => ({
      current: runs.find((r) => r.kind === kind && r.status === "done") ?? null,
      latest: runs.find((r) => r.kind === kind) ?? null,
    });
    const covers = (r: ImportRun | null) =>
      !!r &&
      !!area &&
      r.bbox[0] <= area.drawnBbox[0] &&
      r.bbox[1] <= area.drawnBbox[1] &&
      r.bbox[2] >= area.drawnBbox[2] &&
      r.bbox[3] >= area.drawnBbox[3];
    const osm = of("osm");
    const dem = of("dem");
    const demUpload = of("dem_upload");
    const areaKm2 = area ? Math.round(bboxAreaKm2(area.bbox) * 10) / 10 : null;
    return {
      canImport: role === "owner" || role === "editor",
      area: area ? { ...area, areaKm2 } : null,
      osm: { ...osm, coversDrawing: covers(osm.current) },
      dem: { ...dem, coversDrawing: covers(dem.current) },
      demUpload,
      suggestedMethod:
        areaKm2 !== null && areaKm2 > this.settings.overpass.maxAreaKm2 ? "geofabrik" : "overpass",
      limits: {
        overpassMaxKm2: this.settings.overpass.maxAreaKm2,
        osmMaxAreaKm2: this.settings.maxAreaKm2,
        demMaxAreaKm2: this.settings.dem.maxAreaKm2,
        maxPbfMb: this.settings.maxPbfMb,
        demUploadMaxMb: this.settings.dem.maxUploadMb,
      },
    };
  }

  /** Purpose: the Geofabrik regions holding the project area, smallest first. */
  async regions(actor: ProjectActor, projectId: string): Promise<GeofabrikRegion[]> {
    await this.projects.access(actor, projectId, "read");
    const area = await this.requireArea(projectId);
    return this.geofabrik.regions(area.bbox);
  }

  /**
   * Purpose: queue an OpenStreetMap import of the project area.
   * Inputs: the method (Overpass or a Geofabrik region; uploads go through `uploadPbf`), the region id for
   * Geofabrik, and whether planned roads are kept.
   */
  async startOsm(
    actor: ProjectActor,
    projectId: string,
    o: { method: "overpass" | "geofabrik"; region?: string; planned: boolean },
  ): Promise<ImportRun> {
    await this.projects.access(actor, projectId, "edit");
    const area = await this.requireArea(projectId);
    const km2 = bboxAreaKm2(area.bbox);
    if (km2 > this.settings.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km², more than the ${this.settings.maxAreaKm2} km² an import accepts`,
      );
    if (o.method === "overpass" && km2 > this.settings.overpass.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km²; Overpass is used up to ${this.settings.overpass.maxAreaKm2} km². Pick a Geofabrik region or upload an .osm.pbf file.`,
      );
    let region: GeofabrikRegion | null = null;
    if (o.method === "geofabrik") {
      if (!o.region) throw new BadRequestException("Pick a Geofabrik region");
      region = await this.geofabrik.region(o.region);
      if (!region) throw new BadRequestException("Unknown Geofabrik region");
    }
    const run = await this.insert(actor, projectId, "osm", o.method, area, {
      planned: o.planned,
      ...(region ? { region: { id: region.id, name: region.name } } : {}),
    });
    this.enqueue(run.id, () => this.osmJob(run, projectId, { planned: o.planned, region }));
    return run;
  }

  /**
   * Purpose: take an uploaded `.osm.pbf` (streamed to the data volume, at most `maxPbfMb`) and queue its import.
   * Inputs: the request body stream and the file name for the record.
   */
  async uploadPbf(
    actor: ProjectActor,
    projectId: string,
    body: NodeJS.ReadableStream,
    o: { fileName: string; planned: boolean },
  ): Promise<ImportRun> {
    await this.projects.access(actor, projectId, "edit");
    const area = await this.requireArea(projectId);
    const km2 = bboxAreaKm2(area.bbox);
    if (km2 > this.settings.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km², more than the ${this.settings.maxAreaKm2} km² an import accepts`,
      );
    await mkdir(this.dirs.uploads, { recursive: true });
    const file = join(this.dirs.uploads, `${randomUUID()}.osm.pbf`);
    const size = await this.saveUpload(body, file, this.settings.maxPbfMb);
    const run = await this.insert(actor, projectId, "osm", "upload", area, {
      planned: o.planned,
      upload: { name: o.fileName.slice(0, 200), bytes: size },
    });
    this.enqueue(run.id, async () => {
      try {
        await this.osmJob(run, projectId, { planned: o.planned, upload: file });
      } finally {
        await rm(file, { force: true });
      }
    });
    return run;
  }

  /** Purpose: queue a Copernicus GLO-30 import of the project area. */
  async startDem(actor: ProjectActor, projectId: string): Promise<ImportRun> {
    await this.projects.access(actor, projectId, "edit");
    const area = await this.requireArea(projectId);
    const km2 = bboxAreaKm2(area.bbox);
    if (km2 > this.settings.dem.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km², more than the ${this.settings.dem.maxAreaKm2} km² an elevation import accepts`,
      );
    const run = await this.insert(actor, projectId, "dem", "copernicus", area, {});
    this.enqueue(run.id, () => this.demJob(run, projectId));
    return run;
  }

  /**
   * Purpose: take the planner's own elevation GeoTIFF (streamed to the data volume, at most `dem.maxUploadMb`) and
   * queue its import. It replaces the planner's earlier grid and wins over GLO-30 where it has heights.
   * Inputs: the request body and what the planner says about the grid (all optional but the file name).
   */
  async uploadDem(
    actor: ProjectActor,
    projectId: string,
    body: NodeJS.ReadableStream,
    o: {
      fileName: string;
      crs?: string | null;
      sourceName?: string | null;
      licence?: string | null;
      accuracyM?: number | null;
    },
  ): Promise<ImportRun> {
    await this.projects.access(actor, projectId, "edit");
    const area = await this.requireArea(projectId);
    const km2 = bboxAreaKm2(area.bbox);
    if (km2 > this.settings.dem.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km², more than the ${this.settings.dem.maxAreaKm2} km² an elevation import accepts`,
      );
    await mkdir(this.dirs.uploads, { recursive: true });
    const file = join(this.dirs.uploads, `${randomUUID()}.tif`);
    const size = await this.saveUpload(body, file, this.settings.dem.maxUploadMb);
    const options = {
      upload: { name: o.fileName.slice(0, 200), bytes: size },
      crs: o.crs?.trim() || null,
      sourceName: o.sourceName?.trim() || null,
      licence: o.licence?.trim() || null,
      accuracyM: o.accuracyM ?? null,
    };
    const run = await this.insert(actor, projectId, "dem_upload", "geotiff", area, options);
    this.enqueue(run.id, async () => {
      try {
        await this.demUploadJob(run, projectId, file, options);
      } finally {
        await rm(file, { force: true });
      }
    });
    return run;
  }

  /** Purpose: cancel a queued or running import. Already finished imports are left as they are. */
  async cancel(actor: ProjectActor, projectId: string, importId: string): Promise<ImportRun> {
    await this.projects.access(actor, projectId, "edit");
    const { rows } = await sql<Row>`
      UPDATE geo.import SET status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
        finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END
      WHERE id = ${importId} AND project_id = ${projectId} RETURNING *`.execute(this.db);
    const row = rows[0];
    if (!row) throw new NotFoundException("import not found");
    if (row.status === "running") this.cancelled.add(importId);
    return toRun(row);
  }

  /**
   * Purpose: remove an import of the project (the planner's own elevation grid, or any finished import) and the
   * data it brought.
   */
  async remove(actor: ProjectActor, projectId: string, importId: string): Promise<void> {
    await this.projects.access(actor, projectId, "edit");
    const { rows } = await sql<{ status: ImportStatus }>`
      SELECT status FROM geo.import WHERE id = ${importId} AND project_id = ${projectId}`.execute(this.db);
    if (!rows[0]) throw new NotFoundException("import not found");
    if (rows[0].status === "running" || rows[0].status === "queued")
      throw new ConflictException("Cancel the import first");
    await sql`DELETE FROM geo.import WHERE id = ${importId}`.execute(this.db);
    await rm(join(this.dirs.project(projectId), `area-${importId}.osm.pbf`), { force: true });
    this.changed(projectId);
  }

  /** Purpose: the project's current import of a kind, or null. */
  async current(projectId: string, kind: ImportKind): Promise<ImportRun | null> {
    const { rows } = await sql<Row>`
      SELECT * FROM geo.import WHERE project_id = ${projectId} AND kind = ${kind} AND status = 'done'
      ORDER BY finished_at DESC LIMIT 1`.execute(this.db);
    return rows[0] ? toRun(rows[0]) : null;
  }

  /** Purpose: the extract a finished OSM import keeps for the street tiles. */
  extractPath(projectId: string, importId: string): string {
    return join(this.dirs.project(projectId), `area-${importId}.osm.pbf`);
  }

  /** Purpose: the osmium/osm2pgsql runner, shared with the readers. */
  get osmTools(): OsmTools {
    return this.tools;
  }

  // ---- jobs ------------------------------------------------------------------------------------------------

  private enqueue(id: string, job: () => Promise<void>): void {
    this.chain = this.chain.then(async () => {
      const { rows } = await sql<{ status: ImportStatus }>`
        SELECT status FROM geo.import WHERE id = ${id}`.execute(this.db);
      if (rows[0]?.status !== "queued") return;
      await this.mark(id, { status: "running", started: true });
      try {
        await job();
      } catch (e) {
        await this.fail(id, e);
      } finally {
        this.cancelled.delete(id);
      }
    });
  }

  /** Purpose: wait until every queued import has run (tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  private check(id: string): void {
    if (this.cancelled.has(id)) throw new Cancelled();
  }

  private async osmJob(
    run: ImportRun,
    projectId: string,
    o: { planned: boolean; region?: GeofabrikRegion | null; upload?: string },
  ): Promise<void> {
    const work = join(this.dirs.work, run.id);
    await mkdir(work, { recursive: true });
    try {
      const area = join(work, "area.osm.pbf");
      const stats: Record<string, unknown> = {};
      let dataTimestamp: string | null = null;
      if (run.method === "overpass") {
        const fetched = await fetchArea(this.overpass, run.bbox, join(work, "tiles"), {
          tileKm: this.settings.overpass.tileKm,
          minTileKm: this.settings.overpass.minTileKm,
          queryTimeoutS: this.settings.overpass.queryTimeoutS,
          maxBytes: this.settings.overpass.maxResponseMb * 1024 * 1024,
          cacheDir: this.dirs.overpassCache,
          cacheDays: this.settings.overpass.cacheDays,
          endpoint: overpassEndpoint(),
          progress: (done, total) => this.mark(run.id, { progress: { step: "download", done, total } }),
          checkCancelled: () => this.check(run.id),
        });
        Object.assign(stats, {
          tiles: fetched.tiles,
          cachedTiles: fetched.cachedTiles,
          downloadBytes: fetched.bytes,
        });
        dataTimestamp = fetched.dataTimestamp;
        await this.mark(run.id, { progress: { step: "merge" } });
        const sorted: string[] = [];
        for (const [i, f] of fetched.files.entries()) {
          this.check(run.id);
          const out = join(work, `sorted-${i}.osm.pbf`);
          await this.tools.sort(f, out);
          await rm(f, { force: true });
          sorted.push(out);
        }
        await this.tools.merge(sorted, area);
      } else {
        let source = o.upload;
        if (run.method === "geofabrik") {
          await this.mark(run.id, { progress: { step: "download" } });
          let lastMark = 0;
          source = await this.geofabrik.download(o.region!, (bytes, total) => {
            if (Date.now() - lastMark < 2_000) return;
            lastMark = Date.now();
            void this.mark(run.id, {
              progress: { step: "download", done: bytes, total: total ?? undefined },
            });
          });
        }
        this.check(run.id);
        await this.mark(run.id, { progress: { step: "extract" } });
        await this.tools.extract(source!, run.bbox, area);
        dataTimestamp = await this.tools.dataTimestamp(source!);
      }
      this.check(run.id);
      stats.extractBytes = (await stat(area)).size;
      await this.mark(run.id, { progress: { step: "database" } });
      const rows = await this.loadIntoDatabase(run, projectId, area, o.planned);
      stats.rows = rows;
      this.check(run.id);
      const dir = this.dirs.project(projectId);
      await mkdir(dir, { recursive: true });
      await rename(area, this.extractPath(projectId, run.id));
      await this.finish(run, projectId, stats, {
        ...OSM_SOURCE,
        retrievedAt: new Date().toISOString(),
        dataTimestamp,
        via:
          run.method === "overpass"
            ? overpassEndpoint()
            : run.method === "geofabrik"
              ? `Geofabrik: ${o.region!.name}`
              : `Uploaded file ${String((run.options.upload as { name?: string })?.name ?? "")}`,
        tagMapping: "tools/osm/tag_mapping.lua v1",
      });
      // Keep only the extract of the current import.
      for (const f of await readdir(dir).catch(() => [] as string[]))
        if (f.startsWith("area-") && f !== `area-${run.id}.osm.pbf`) await rm(join(dir, f), { force: true });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /**
   * Purpose: run osm2pgsql into the staging schema and copy the rows into the project's tables.
   * Output: rows per table. Side effects: replaces nothing yet; the earlier import is dropped by `finish`.
   */
  private async loadIntoDatabase(
    run: ImportRun,
    projectId: string,
    file: string,
    planned: boolean,
  ): Promise<Record<string, number>> {
    const rows: Record<string, number> = {};
    await this.db.connection().execute(async (conn) => {
      await sql`SELECT pg_advisory_lock(${STAGE_LOCK})`.execute(conn);
      try {
        await this.tools.osm2pgsql(file, {
          schema: STAGE,
          planned,
          db: {
            host: this.config.db.host,
            port: this.config.db.port,
            name: this.config.db.name,
            user: "mobsimlab_app",
            password: this.config.secrets.db_app_password,
          },
        });
        this.check(run.id);
        await conn.transaction().execute(async (tx) => {
          for (const [table, cols] of Object.entries(OSM_TABLES)) {
            const list = ["osm_type", "osm_id", "tags", ...cols, "geom"].map((c) => sql.id(c));
            const res = await sql`
              INSERT INTO ${sql.table(`geo.${table}`)} (project_id, import_id, ${sql.join(list)})
              SELECT ${projectId}::uuid, ${run.id}::uuid, ${sql.join(list)}
              FROM ${sql.table(`${STAGE}.${table}`)}`.execute(tx);
            rows[table] = Number(res.numAffectedRows ?? 0);
          }
        });
      } finally {
        try {
          for (const table of [...Object.keys(OSM_TABLES), "osm2pgsql_properties"])
            await sql`DROP TABLE IF EXISTS ${sql.table(`${STAGE}.${table}`)}`.execute(conn);
        } finally {
          await sql`SELECT pg_advisory_unlock(${STAGE_LOCK})`.execute(conn);
        }
      }
    });
    return rows;
  }

  private async demJob(run: ImportRun, projectId: string): Promise<void> {
    const [w, s, e, n] = run.bbox;
    const cells: string[] = [];
    for (let lat = Math.floor(s); lat <= Math.floor(n - 1e-12); lat++)
      for (let lon = Math.floor(w); lon <= Math.floor(e - 1e-12); lon++)
        cells.push(cellName(lon + 0.5, lat + 0.5));
    let tiles = 0;
    let pixels = 0;
    let missingCells = 0;
    for (const [i, name] of cells.entries()) {
      this.check(run.id);
      await this.mark(run.id, { progress: { step: "download", done: i, total: cells.length } });
      const win = await this.dem.window(name, run.bbox);
      if (!win) {
        missingCells++;
        continue;
      }
      const cut = cutTiles(win);
      await this.writeTiles(run.id, projectId, 0, cut);
      tiles += cut.length;
      pixels += win.width * win.height;
    }
    await this.finish(
      run,
      projectId,
      { cells: cells.length, cellsWithoutData: missingCells, tiles, pixels },
      { ...TERRAIN_SOURCE, retrievedAt: new Date().toISOString() },
    );
  }

  private async demUploadJob(
    run: ImportRun,
    projectId: string,
    file: string,
    o: {
      upload: { name: string; bytes: number };
      crs: string | null;
      sourceName: string | null;
      licence: string | null;
      accuracyM: number | null;
    },
  ): Promise<void> {
    await this.mark(run.id, { progress: { step: "extract" } });
    const fh = await open(file, "r");
    let res;
    try {
      res = await resampleDem(
        async (offset, len) => {
          const buf = Buffer.alloc(len);
          const { bytesRead } = await fh.read(buf, 0, len, offset);
          if (bytesRead < len) throw new DemUploadError("The file ends early; it may be damaged");
          return buf;
        },
        run.bbox,
        { crs: o.crs, maxCells: this.settings.dem.maxUploadCells },
      );
    } finally {
      await fh.close();
    }
    this.check(run.id);
    await this.mark(run.id, { progress: { step: "database" } });
    const cut = cutTiles(res.window);
    await this.writeTiles(run.id, projectId, 1, cut);
    this.check(run.id);
    await this.finish(
      run,
      projectId,
      {
        tiles: cut.length,
        pixels: res.window.width * res.window.height,
        cellsWithData: res.cellsWithData,
        notes: res.notes,
      },
      {
        id: "own_geotiff",
        name: o.sourceName ?? o.upload.name,
        kind: "own",
        file: o.upload.name,
        licence: o.licence,
        crs: res.crs,
        resolutionM: Math.round(res.resolutionM * 10) / 10,
        fileResolutionM: Math.round(res.fileResolutionM * 10) / 10,
        ...(o.accuracyM !== null ? { verticalAccuracyM: o.accuracyM } : {}),
        note: "Uploaded by the planner; heights taken as metres.",
        retrievedAt: new Date().toISOString(),
      },
    );
  }

  /** Purpose: store elevation tiles of an import, 32 rows a statement. Higher `priority` wins when reading. */
  private async writeTiles(importId: string, projectId: string, priority: number, cut: DemTile[]) {
    for (let k = 0; k < cut.length; k += 32) {
      const batch = cut.slice(k, k + 32);
      await sql`
        INSERT INTO geo.dem_tile (project_id, import_id, priority, width, height, origin_lon, origin_lat,
          step_lon, step_lat, data, envelope)
        VALUES ${sql.join(
          batch.map((t) => {
            const [bw, bs, be, bn] = tileBounds(t);
            return sql`(${projectId}::uuid, ${importId}::uuid, ${priority}, ${t.width}, ${t.height}, ${t.originLon},
              ${t.originLat}, ${t.stepLon}, ${t.stepLat}, ${encodeValues(t.values)},
              ST_MakeEnvelope(${bw}, ${bs}, ${be}, ${bn}, 4326))`;
          }),
        )}`.execute(this.db);
    }
  }

  // ---- rows ------------------------------------------------------------------------------------------------

  private async requireArea(projectId: string) {
    const area = await projectArea(this.db, projectId);
    if (!area)
      throw new BadRequestException(
        "Draw something in the project first: the import covers the box around it",
      );
    return area;
  }

  private async insert(
    actor: ProjectActor,
    projectId: string,
    kind: ImportKind,
    method: ImportMethod,
    area: { bbox: Box; bufferKm: number },
    options: Record<string, unknown>,
  ): Promise<ImportRun> {
    const run = await this.db.transaction().execute(async (tx) => {
      const { rows } = await sql<Row>`
        INSERT INTO geo.import (project_id, kind, method, bbox, buffer_km, options, requested_by)
        VALUES (${projectId}, ${kind}, ${method}, ${area.bbox}::double precision[], ${area.bufferKm},
                ${JSON.stringify(options)}::jsonb, ${actor.userId})
        RETURNING *`.execute(tx);
      await this.projects.logProject(
        actor,
        projectId,
        `geodata.import.${kind}`,
        null,
        { method, options },
        tx,
      );
      return toRun(rows[0]!);
    });
    return run;
  }

  private async mark(
    id: string,
    o: { status?: ImportStatus; started?: boolean; progress?: ImportRun["progress"] },
  ): Promise<void> {
    await sql`
      UPDATE geo.import SET
        status = COALESCE(${o.status ?? null}, status),
        started_at = CASE WHEN ${o.started ?? false} THEN now() ELSE started_at END,
        progress = COALESCE(${o.progress ? JSON.stringify(o.progress) : null}::jsonb, progress)
      WHERE id = ${id}`.execute(this.db);
  }

  private async fail(id: string, e: unknown): Promise<void> {
    const cancelled = e instanceof Cancelled;
    if (!cancelled) this.log.warn(`Import ${id} failed: ${(e as Error).message}`);
    await sql`
      UPDATE geo.import SET status = ${cancelled ? "cancelled" : "failed"}, finished_at = now(),
        error = ${cancelled ? null : String((e as Error).message ?? e).slice(0, 2_000)}
      WHERE id = ${id}`.execute(this.db);
    // Rows written before the failure belong to the failed run; drop them.
    await sql`DELETE FROM geo.dem_tile WHERE import_id = ${id}`.execute(this.db);
    for (const table of Object.keys(OSM_TABLES))
      await sql`DELETE FROM ${sql.table(`geo.${table}`)} WHERE import_id = ${id}`.execute(this.db);
  }

  /** Purpose: mark a run done and drop the project's earlier finished runs of the same kind with their data. */
  private async finish(
    run: ImportRun,
    projectId: string,
    stats: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await sql`
        UPDATE geo.import SET status = 'done', finished_at = now(), progress = '{}'::jsonb,
          stats = ${JSON.stringify(stats)}::jsonb, source = ${JSON.stringify(source)}::jsonb
        WHERE id = ${run.id}`.execute(tx);
      await sql`
        DELETE FROM geo.import WHERE project_id = ${projectId} AND kind = ${run.kind} AND id <> ${run.id}
          AND status IN ('done', 'failed', 'cancelled')`.execute(tx);
    });
    this.changed(projectId);
  }

  private changed(projectId: string): void {
    for (const fn of this.listeners) fn(projectId);
  }

  private async get(id: string): Promise<ImportRun | null> {
    const { rows } = await sql<Row>`SELECT * FROM geo.import WHERE id = ${id}`.execute(this.db);
    return rows[0] ? toRun(rows[0]) : null;
  }

  /** Purpose: stream an upload to a file, refusing more than `maxMb`. Output: bytes written. */
  async saveUpload(body: NodeJS.ReadableStream, file: string, maxMb: number): Promise<number> {
    let bytes = 0;
    const max = maxMb * 1024 * 1024;
    const count = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > max) return cb(new PayloadTooLargeException(`The file is larger than ${maxMb} MB`));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, count, createWriteStream(file));
    } catch (e) {
      await rm(file, { force: true });
      throw e;
    }
    if (bytes === 0) {
      await rm(file, { force: true });
      throw new BadRequestException("The file is empty");
    }
    return bytes;
  }
}

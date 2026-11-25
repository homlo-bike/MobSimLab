import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
import { CONTINENTS, GeofabrikClient, type GeofabrikRegion } from "../gateway/geofabrik.client";
import { OverpassClient, overpassEndpoint } from "../gateway/overpass.client";
import {
  type AreaPolygon,
  boxMeetsPolygons,
  polygonsBox,
  polygonsCover,
  polygonsGeoJson,
  polygonsKm2,
  storedPolygons,
} from "../projects/area-polygons";
import { projectArea } from "../projects/project-area";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";

import { cutTiles, type DemTile, encodeValues, tileBounds } from "./dem-tiles";
import { DemUploadError, resampleDem } from "./dem-upload";
import { type Box, OsmTools } from "./osm-tools";
import { fetchArea } from "./overpass-import";
import { type GeodataSettings, geodataDirs, geodataSettings } from "./settings";

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
 * Imports OpenStreetMap data and elevation into PostGIS per project area (06-gis §2 and §4, ADR-0046).
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
  /** One per running import: aborted on Cancel, so a download under way stops at once, not at the next step. */
  private readonly aborts = new Map<string, AbortController>();
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
    // An import covers the area when its polygons hold today's (imports before 2026-11-19 recorded a box only).
    const covers = (r: ImportRun | null) => !!r && !!area && polygonsCover(importPolygons(r), area.polygons);
    // It matches the area when it covers it and holds nothing more: no polygon the planner has since removed or
    // made smaller.
    const matches = (r: ImportRun | null) => covers(r) && polygonsCover(area!.polygons, importPolygons(r!));
    const osm = of("osm");
    const dem = of("dem");
    const demUpload = of("dem_upload");
    const areaKm2 = area ? Math.round(polygonsKm2(area.polygons) * 10) / 10 : null;
    return {
      canImport: role === "owner" || role === "editor",
      area: area ? { ...area, areaKm2 } : null,
      osm: { ...osm, coversDrawing: covers(osm.current), matchesDrawing: matches(osm.current) },
      dem: { ...dem, coversDrawing: covers(dem.current), matchesDrawing: matches(dem.current) },
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

  /**
   * Purpose: the Geofabrik regions an import of the project area downloads: for each polygon the smallest region
   * holding it, each region once (a project across a border needs one per country).
   * Throws 400 naming a polygon no region holds.
   */
  async regions(actor: ProjectActor, projectId: string): Promise<GeofabrikRegion[]> {
    await this.projects.access(actor, projectId, "read");
    const area = await this.requireArea(projectId);
    return this.regionsFor(area.polygons);
  }

  private async regionsFor(polygons: readonly AreaPolygon[]): Promise<GeofabrikRegion[]> {
    const out = new Map<string, GeofabrikRegion>();
    for (const p of polygons) {
      const box = polygonsBox([p])!;
      // Never a whole continent: a polygon across a border takes the countries it reaches instead.
      const held = (await this.geofabrik.regions(box)).filter((r) => !CONTINENTS.has(r.id));
      // A region already chosen for another polygon is reused when it holds this one too.
      const pick = held.find((r) => out.has(r.id)) ?? held[0];
      const picks = pick ? [pick] : await this.geofabrik.regionsCovering(p.ring, new Set(out.keys()));
      if (!picks.length)
        throw new BadRequestException(
          `No Geofabrik region holds the polygon ${p.name}. Use Overpass or upload an .osm.pbf file.`,
        );
      for (const r of picks) out.set(r.id, r);
    }
    return [...out.values()];
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
    const km2 = polygonsKm2(area.polygons);
    if (km2 > this.settings.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km², more than the ${this.settings.maxAreaKm2} km² an import accepts`,
      );
    if (o.method === "overpass" && km2 > this.settings.overpass.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2)} km²; Overpass is used up to ${this.settings.overpass.maxAreaKm2} km². Pick a Geofabrik region or upload an .osm.pbf file.`,
      );
    const regions = o.method === "geofabrik" ? await this.regionsFor(area.polygons) : [];
    const run = await this.insert(actor, projectId, "osm", o.method, area, {
      planned: o.planned,
      ...(regions.length
        ? {
            region: { id: regions.map((r) => r.id).join("+"), name: regions.map((r) => r.name).join(", ") },
            regions: regions.map((r) => ({ id: r.id, name: r.name })),
          }
        : {}),
    });
    this.enqueue(run.id, () => this.osmJob(run, projectId, { planned: o.planned, regions }));
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
    const km2 = polygonsKm2(area.polygons);
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

  /**
   * Purpose: bring back the OpenStreetMap extract a project file carried: queue its import into the new project,
   * as an uploaded file would be, keeping the method and Source the saved import had.
   * Inputs: the extract and what the file says about it. Output: the queued run, or null when the project has no
   * area to import into. Side effects: writes the extract to the data volume until the job has run.
   */
  async restoreOsm(
    actor: ProjectActor,
    projectId: string,
    body: Buffer,
    o: { method: "overpass" | "geofabrik" | "upload"; planned: boolean; source: Record<string, unknown> },
  ): Promise<ImportRun | null> {
    await this.projects.access(actor, projectId, "edit");
    const area = await projectArea(this.db, projectId);
    if (!area) return null;
    await mkdir(this.dirs.uploads, { recursive: true });
    const file = join(this.dirs.uploads, `${randomUUID()}.osm.pbf`);
    await writeFile(file, body);
    const run = await this.insert(actor, projectId, "osm", o.method, area, {
      planned: o.planned,
      fromFile: true,
    });
    this.enqueue(run.id, async () => {
      try {
        await this.osmJob(run, projectId, { planned: o.planned, upload: file, restored: o.source });
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
    const km2 = polygonsKm2(area.polygons);
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
    const km2 = polygonsKm2(area.polygons);
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
    if (row.status === "running") {
      this.cancelled.add(importId);
      this.aborts.get(importId)?.abort();
    }
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
      this.aborts.set(id, new AbortController());
      try {
        await job();
      } catch (e) {
        await this.fail(id, e);
      } finally {
        this.cancelled.delete(id);
        this.aborts.delete(id);
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

  /**
   * Purpose: cut an OSM file to the project area's polygons, each at its detail (large-area projects, step 3):
   * Full polygons keep everything, "Main roads and railways only" polygons keep only `MAIN_FILTERS`.
   * Inputs: the source file, the polygons, a work folder, the output file. Side effects: writes temporary files.
   */
  private async cutToArea(input: string, polygons: readonly AreaPolygon[], work: string, output: string) {
    const full = polygons.filter((p) => p.detail !== "main");
    const main = polygons.filter((p) => p.detail === "main");
    const cut = async (ps: readonly AreaPolygon[], name: string) => {
      const file = join(work, `${name}.geojson`);
      await writeFile(file, polygonsGeoJson(ps));
      const out = join(work, `${name}.osm.pbf`);
      await this.tools.extractPolygons(input, file, out);
      return out;
    };
    if (!main.length) return this.tools.extractPolygons(input, await writePolygons(work, full), output);
    const mainRaw = await cut(main, "main-raw");
    const mainPart = join(work, "main.osm.pbf");
    await this.tools.tagsFilter(mainRaw, [...MAIN_FILTERS], mainPart);
    await rm(mainRaw, { force: true });
    if (!full.length) return rename(mainPart, output);
    const fullPart = await cut(full, "full");
    await this.tools.merge([fullPart, mainPart], output);
    await rm(fullPart, { force: true });
    await rm(mainPart, { force: true });
  }

  private async osmJob(
    run: ImportRun,
    projectId: string,
    o: {
      planned: boolean;
      regions?: GeofabrikRegion[];
      upload?: string;
      /** The Source of the import a project file's extract came from; the run keeps it. */
      restored?: Record<string, unknown>;
    },
  ): Promise<void> {
    const work = join(this.dirs.work, run.id);
    await mkdir(work, { recursive: true });
    try {
      const area = join(work, "area.osm.pbf");
      // Only the project area's polygons are imported (osmium cuts to them, keeping whole ways at the edges).
      const polygons = importPolygons(run);
      const stats: Record<string, unknown> = {};
      let dataTimestamp: string | null = null;
      if (run.method === "overpass" && !o.upload) {
        const fetched = await fetchArea(this.overpass, run.bbox, join(work, "tiles"), {
          keep: (b) => boxMeetsPolygons(b, polygons),
          tileKm: this.settings.overpass.tileKm,
          minTileKm: this.settings.overpass.minTileKm,
          queryTimeoutS: this.settings.overpass.queryTimeoutS,
          maxBytes: this.settings.overpass.maxResponseMb * 1024 * 1024,
          cacheDir: this.dirs.overpassCache,
          cacheDays: this.settings.overpass.cacheDays,
          endpoint: overpassEndpoint(),
          progress: (done, total) => this.mark(run.id, { progress: { step: "download", done, total } }),
          checkCancelled: () => this.check(run.id),
          signal: this.aborts.get(run.id)?.signal,
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
        const merged = join(work, "merged.osm.pbf");
        await this.tools.merge(sorted, merged);
        await this.mark(run.id, { progress: { step: "extract" } });
        await this.cutToArea(merged, polygons, work, area);
        await rm(merged, { force: true });
      } else if (run.method === "geofabrik" && !o.upload) {
        // One download per region (a project across a border needs one per country), each cut to the polygons.
        const parts: string[] = [];
        const stamps: string[] = [];
        for (const [i, region] of (o.regions ?? []).entries()) {
          this.check(run.id);
          await this.mark(run.id, { progress: { step: "download" } });
          let lastMark = 0;
          const source = await this.geofabrik.download(
            region,
            (bytes, total) => {
              if (Date.now() - lastMark < 2_000) return;
              lastMark = Date.now();
              void this.mark(run.id, {
                progress: { step: "download", done: bytes, total: total ?? undefined },
              });
            },
            this.aborts.get(run.id)?.signal,
          );
          this.check(run.id);
          await this.mark(run.id, { progress: { step: "extract" } });
          const part = join(work, `part-${i}.osm.pbf`);
          await this.cutToArea(source, polygons, work, part);
          parts.push(part);
          const stamp = await this.tools.dataTimestamp(source);
          if (stamp) stamps.push(stamp);
        }
        if (parts.length === 1) await rename(parts[0]!, area);
        else await this.tools.merge(parts, area);
        stamps.sort();
        dataTimestamp = stamps[0] ?? null;
      } else {
        this.check(run.id);
        await this.mark(run.id, { progress: { step: "extract" } });
        await this.cutToArea(o.upload!, polygons, work, area);
        dataTimestamp = await this.tools.dataTimestamp(o.upload!);
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
      await this.finish(
        run,
        projectId,
        stats,
        o.restored
          ? // From a project file: where and when the saved import got the data, not today.
            {
              ...o.restored,
              ...OSM_SOURCE,
              fromProjectFile: true,
              tagMapping: "tools/osm/tag_mapping.lua v1",
            }
          : {
              ...OSM_SOURCE,
              retrievedAt: new Date().toISOString(),
              dataTimestamp,
              via:
                run.method === "overpass"
                  ? overpassEndpoint()
                  : run.method === "geofabrik"
                    ? `Geofabrik: ${(o.regions ?? []).map((r) => r.name).join(", ")}`
                    : `Uploaded file ${String((run.options.upload as { name?: string })?.name ?? "")}`,
              tagMapping: "tools/osm/tag_mapping.lua v1",
            },
      );
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
    const polygons = importPolygons(run);
    // Only the 1° cells, and in them the 256 px tiles, that touch the project area's polygons.
    const cells: string[] = [];
    for (let lat = Math.floor(s); lat <= Math.floor(n - 1e-12); lat++)
      for (let lon = Math.floor(w); lon <= Math.floor(e - 1e-12); lon++)
        if (!polygons.length || boxMeetsPolygons([lon, lat, lon + 1, lat + 1], polygons))
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
      const cut = inArea(cutTiles(win), polygons);
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
    const cut = inArea(cutTiles(res.window), importPolygons(run));
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
        "Draw the project area first (Project preferences, Project area): the import covers it",
      );
    return area;
  }

  private async insert(
    actor: ProjectActor,
    projectId: string,
    kind: ImportKind,
    method: ImportMethod,
    area: { bbox: Box; polygons: readonly AreaPolygon[] },
    options: Record<string, unknown>,
  ): Promise<ImportRun> {
    // The polygons the import covers, for its jobs and for whether it still covers the area later.
    options = { ...options, area: area.polygons };
    const run = await this.db.transaction().execute(async (tx) => {
      const { rows } = await sql<Row>`
        INSERT INTO geo.import (project_id, kind, method, bbox, buffer_km, options, requested_by)
        VALUES (${projectId}, ${kind}, ${method}, ${area.bbox}::double precision[], 0,
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
    // A request aborted by Cancel fails with its client's error; it is still a cancellation.
    const cancelled = e instanceof Cancelled || this.cancelled.has(id);
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

/**
 * What a "Main roads and railways only" polygon keeps of OpenStreetMap: main roads with their links and turn
 * restrictions, railways, and the coastline (water on the map).
 */
const MAIN_FILTERS = [
  "w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link",
  "r/type=restriction",
  "w/railway=rail,light_rail,tram,subway,narrow_gauge,monorail,funicular,construction,disused,preserved",
  "w/natural=coastline",
] as const;

/** Purpose: write polygons as the GeoJSON file osmium cuts with; output: its path. */
async function writePolygons(work: string, polygons: readonly AreaPolygon[]): Promise<string> {
  const file = join(work, "area.geojson");
  await writeFile(file, polygonsGeoJson(polygons));
  return file;
}

/** Purpose: the polygons an import covers (`options.area`); none for imports from before polygons. */
function importPolygons(r: ImportRun): AreaPolygon[] {
  return storedPolygons(r.options.area);
}

/** Purpose: the elevation tiles touching the polygons; all of them without polygons. */
function inArea(tiles: DemTile[], polygons: readonly AreaPolygon[]): DemTile[] {
  return polygons.length ? tiles.filter((t) => boxMeetsPolygons(tileBounds(t), polygons)) : tiles;
}

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { type Selectable, sql } from "kysely";
import { z } from "zod";
import {
  DATABASE,
  type Database,
  type DB,
  type PopulationConfidence,
  type PopulationLayerKind,
  type PopulationLayerSource,
} from "../db/database";
import {
  GHSL_EPOCHS,
  GHSL_RESOLUTION_M,
  GHSL_SOURCE,
  GhslClient,
  type GhslResolution,
  nearestEpoch,
} from "../gateway/ghsl.client";
import { CELL_DEG, emptyGrid, WorldPopClient, type WorldPopEntry } from "../gateway/worldpop.client";
import { AreaIndex, type AreaPolygon, polygonsKm2 } from "../projects/area-polygons";
import { coarsenMain } from "./coarsen";
import { type Bbox, type ProjectArea, projectArea } from "../projects/project-area";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";
import { type Lattice, layerLattice } from "./lattice";
import { POPULATION_SOURCE, PopulationService } from "./population.service";
import {
  type ParsedUpload,
  parseCsvPoints,
  parseCsvZones,
  parseGeoJson,
  parseGeoTiff,
  type PopulationFeatureIn,
  ringAreaM2,
  UploadError,
  type UploadMeta,
} from "./uploads";

/**
 * Population layers of a project (06-gis §3, FR-GIS-04): WorldPop and GHSL grids imported into PostGIS for the
 * project area, and the planners' own population files. Each layer records source, licence, confidence,
 * reference year, resolution and coverage. One layer can be primary; the noise map, the walk analysis and the
 * benefit tables then read it (PopulationService.gridFor). Any two layers can be compared as a difference
 * layer on a lattice. Imports run in the API process (a few seconds to minutes, mostly the download); a
 * restart marks unfinished imports as failed.
 */

/** Limits of imports and uploads, from the environment (`MOBSIMLAB_POPULATION_*`). */
export interface PopulationSettings {
  /** Largest uploaded file, bytes (default 200 MB). */
  maxUploadBytes: number;
  /** Most features (cells with people, zones, points) one layer may hold (default 2,000,000). */
  maxFeatures: number;
  /** Largest project area a grid is imported for, km² (default 10,000). */
  maxAreaKm2: number;
}

/** Purpose: the limits from the environment. */
export function populationSettings(env: NodeJS.ProcessEnv = process.env): PopulationSettings {
  const int = (v: string | undefined, dflt: number, max: number) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(max)
      .parse(v || dflt);
  return {
    maxUploadBytes: int(env.MOBSIMLAB_POPULATION_UPLOAD_MB, 200, 2_000) * 1024 * 1024,
    maxFeatures: int(env.MOBSIMLAB_POPULATION_MAX_FEATURES, 2_000_000, 20_000_000),
    maxAreaKm2: int(env.MOBSIMLAB_POPULATION_MAX_AREA_KM2, 10_000, 1_000_000),
  };
}

/** WorldPop R2025A years. */
export const WORLDPOP_YEARS = { first: 2015, last: 2030 } as const;

/** One population layer as the GIS tab shows it. */
export interface PopulationLayer {
  id: string;
  name: string;
  source: PopulationLayerSource;
  kind: PopulationLayerKind;
  status: "importing" | "ready" | "failed";
  error: string | null;
  progress: { step: string; receivedBytes?: number; totalBytes?: number | null } | null;
  licence: string;
  sourceUrl: string;
  citation: string;
  confidence: PopulationConfidence;
  referenceYear: number | null;
  resolutionM: number | null;
  coverage: Bbox | null;
  peopleTotal: number;
  featureCount: number;
  isPrimary: boolean;
  options: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** What the GIS tab needs: the area, the layers and the choices an import offers. */
export interface PopulationOverview {
  area: ProjectArea | null;
  areaKm2: number | null;
  layers: PopulationLayer[];
  choices: {
    worldpopYears: { first: number; last: number };
    ghslEpochs: readonly number[];
    ghslResolutions: readonly GhslResolution[];
    maxUploadMb: number;
    maxAreaKm2: number;
    maxFeatures: number;
  };
}

/** Common details the planner gives an upload. */
export const layerDetails = z.strictObject({
  name: z.string().trim().min(1).max(200),
  licence: z.string().trim().max(500).default(""),
  sourceUrl: z.string().trim().max(2000).default(""),
  citation: z.string().trim().max(2000).default(""),
  confidence: z.enum(["high", "medium", "low"]),
  referenceYear: z.number().int().min(1800).max(2200).nullable(),
});
export type LayerDetails = z.infer<typeof layerDetails>;

/** What an import asks for. */
export const importRequest = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("worldpop"),
    year: z.number().int().min(WORLDPOP_YEARS.first).max(WORLDPOP_YEARS.last).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    confidence: z.enum(["high", "medium", "low"]).default("medium"),
  }),
  z.strictObject({
    source: z.literal("ghsl"),
    epoch: z
      .number()
      .int()
      .refine(
        (y) => (GHSL_EPOCHS as readonly number[]).includes(y),
        "GHSL epochs are 1975 to 2030 in steps of 5",
      )
      .optional(),
    resolution: z.enum(["3ss", "30ss"]).default("3ss"),
    name: z.string().trim().min(1).max(200).optional(),
    confidence: z.enum(["high", "medium", "low"]).default("medium"),
  }),
]);
export type ImportRequest = z.infer<typeof importRequest>;

/** What the difference or layer view asks for. */
export const viewRequest = z.strictObject({
  layerId: z.uuid(),
  /** Shown as `layerId` minus this layer; null or absent shows the layer itself. */
  minusId: z.uuid().nullable().optional(),
  /** Cell size, metres (rounded to whole multiples of 3 arc seconds). */
  cellM: z.number().min(90).max(20_000).default(500),
});
export type ViewRequest = z.infer<typeof viewRequest>;

/** One arc second of latitude, metres. */
const ARC_SECOND_M = 30.87;
/** Rows inserted per statement. */
const BATCH = 5_000;

type LayerRow = Omit<Selectable<DB["geo.population_layer"]>, "coverage"> & { coverage_box: string | null };

/** Purpose: the area of a box, km². */
export function boxAreaKm2(b: Bbox): number {
  return (
    ringAreaM2([
      [b[0], b[1]],
      [b[2], b[1]],
      [b[2], b[3]],
      [b[0], b[3]],
      [b[0], b[1]],
    ]) / 1e6
  );
}

/** Purpose: a cell size in metres as degrees: whole multiples of 3 arc seconds, at least 3. */
export function cellDegrees(cellM: number): number {
  return (Math.max(1, Math.round(cellM / ARC_SECOND_M / 3)) * 3) / 3600;
}

@Injectable()
export class PopulationLayersService implements OnModuleInit {
  private readonly log = new Logger("PopulationLayers");
  private readonly settings = populationSettings();
  /** Imports under way, so tests and shutdown can wait for them. */
  readonly running = new Set<Promise<void>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly population: PopulationService,
    private readonly worldpop: WorldPopClient,
    private readonly ghsl: GhslClient,
  ) {}

  /** Imports do not survive a restart: mark those left unfinished as failed. */
  async onModuleInit(): Promise<void> {
    await this.db
      .updateTable("geo.population_layer")
      .set({
        status: "failed",
        error: "The server restarted during the import; import it again",
        progress: null,
      })
      .where("status", "=", "importing")
      .execute()
      .catch((e: unknown) => this.log.warn(`could not mark unfinished imports: ${String(e)}`));
  }

  /** Purpose: the limits in use. */
  get limits(): PopulationSettings {
    return this.settings;
  }

  // -------------------------------------------------------------------------------------------------------
  // Reading

  /** Purpose: the project area, the layers and the import choices. Every member. */
  async overview(actor: ProjectActor, projectId: string): Promise<PopulationOverview> {
    await this.projects.access(actor, projectId, "read");
    const area = await projectArea(this.db, projectId);
    return {
      area,
      areaKm2: area ? Math.round(polygonsKm2(area.polygons) * 10) / 10 : null,
      layers: await this.list(projectId),
      choices: {
        worldpopYears: WORLDPOP_YEARS,
        ghslEpochs: GHSL_EPOCHS,
        ghslResolutions: ["3ss", "30ss"],
        maxUploadMb: Math.round(this.settings.maxUploadBytes / 1024 / 1024),
        maxAreaKm2: this.settings.maxAreaKm2,
        maxFeatures: this.settings.maxFeatures,
      },
    };
  }

  /** Purpose: check that the caller may read the project (404 otherwise). */
  async checkRead(actor: ProjectActor, projectId: string): Promise<void> {
    await this.projects.access(actor, projectId, "read");
  }

  /** Purpose: one layer of a project the caller may read. */
  async get(actor: ProjectActor, projectId: string, layerId: string): Promise<PopulationLayer> {
    await this.projects.access(actor, projectId, "read");
    return this.layer(projectId, layerId);
  }

  /** Purpose: the project's primary layer when it is ready, for the readers of PopulationService. */
  async primary(projectId: string): Promise<PopulationLayer | null> {
    const row = await this.rows(projectId)
      .where("is_primary", "=", true)
      .where("status", "=", "ready")
      .executeTakeFirst();
    return row ? this.view(row as LayerRow) : null;
  }

  /**
   * Purpose: a layer, or a layer minus another (the difference layer), on a lattice over the project area.
   * Output: the lattice (people per cell, rounded to hundredths) and both layers' totals in the area.
   */
  async lattice(
    actor: ProjectActor,
    projectId: string,
    req: ViewRequest,
  ): Promise<{ grid: Omit<Lattice, "people"> & { values: number[] }; cellM: number; bbox: Bbox }> {
    await this.projects.access(actor, projectId, "read");
    const layer = await this.layer(projectId, req.layerId);
    const minus = req.minusId ? await this.layer(projectId, req.minusId) : null;
    for (const l of [layer, minus])
      if (l && l.status !== "ready") throw new BadRequestException(`The layer "${l.name}" is not ready`);
    const area = await projectArea(this.db, projectId);
    const bbox = area?.bbox ?? layer.coverage;
    if (!bbox)
      throw new BadRequestException("Draw the project area first (Project preferences, Project area)");
    const d = cellDegrees(req.cellM);
    let a: Lattice;
    let b: Lattice | null = null;
    try {
      a = await layerLattice(this.db, layer.id, bbox, d);
      if (minus) b = await layerLattice(this.db, minus.id, bbox, d);
    } catch (e) {
      if (e instanceof RangeError) throw new BadRequestException(e.message);
      throw e;
    }
    const values = Array.from(a.people, (v, i) => Math.round((v - (b ? b.people[i]! : 0)) * 100) / 100);
    const grid = { x0: a.x0, y0: a.y0, dx: a.dx, dy: a.dy, nx: a.nx, ny: a.ny };
    return { grid: { ...grid, values }, cellM: Math.round(d * 3600 * ARC_SECOND_M), bbox };
  }

  // -------------------------------------------------------------------------------------------------------
  // Changes (Owners and Editors)

  /**
   * Purpose: import WorldPop or GHSL for the project area into a new layer. Output: the layer, `importing`;
   * the import goes on in the background and the layer turns `ready` or `failed`.
   */
  async startImport(actor: ProjectActor, projectId: string, req: ImportRequest): Promise<PopulationLayer> {
    await this.projects.access(actor, projectId, "edit");
    const area = await projectArea(this.db, projectId);
    if (!area)
      throw new BadRequestException(
        "Draw the project area first (Project preferences, Project area): the import covers it",
      );
    const km2 = polygonsKm2(area.polygons);
    if (km2 > this.settings.maxAreaKm2)
      throw new BadRequestException(
        `The project area is ${Math.round(km2).toLocaleString("en")} km², above the ${this.settings.maxAreaKm2.toLocaleString("en")} km² an import may cover; make the project area smaller or ask the administrator to raise MOBSIMLAB_POPULATION_MAX_AREA_KM2`,
      );
    const year = new Date().getUTCFullYear();
    const isWp = req.source === "worldpop";
    const refYear = isWp ? (req.year ?? year) : (req.epoch ?? nearestEpoch(year));
    const res = isWp ? null : req.resolution;
    const name =
      req.name ?? (isWp ? `WorldPop ${refYear}` : `GHSL ${refYear}, ${res === "3ss" ? "100 m" : "1 km"}`);
    const options = isWp
      ? { year: refYear, bbox: area.bbox }
      : { epoch: refYear, resolution: res, bbox: area.bbox };
    const id = await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto("geo.population_layer")
        .values({
          project_id: projectId,
          name,
          source: req.source,
          kind: "grid",
          status: "importing",
          progress: JSON.stringify({ step: "starting" }),
          licence: isWp ? POPULATION_SOURCE.licence : GHSL_SOURCE.licence,
          source_url: isWp ? POPULATION_SOURCE.url : GHSL_SOURCE.url,
          citation: isWp ? "" : GHSL_SOURCE.citation,
          confidence: req.confidence,
          reference_year: refYear,
          resolution_m: isWp ? 100 : GHSL_RESOLUTION_M[res!],
          options: JSON.stringify(options),
          created_by: actor.userId,
          updated_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await sql`UPDATE geo.population_layer SET coverage = ST_MakeEnvelope(${area.bbox[0]}, ${area.bbox[1]}, ${area.bbox[2]}, ${area.bbox[3]}, 4326) WHERE id = ${row.id}`.execute(
        tx,
      );
      await this.projects.logProject(
        actor,
        projectId,
        "project.population_imported",
        null,
        { layer: row.id, ...options, source: req.source },
        tx,
      );
      return row.id;
    });
    const job = (
      isWp
        ? this.importWorldPop(id, area.bbox, area.polygons, refYear)
        : this.importGhsl(id, area.bbox, area.polygons, refYear, res!)
    )
      .catch(async (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`population import ${id} failed: ${msg}`);
        await this.db.deleteFrom("geo.population_feature").where("layer_id", "=", id).execute();
        await this.db
          .updateTable("geo.population_layer")
          .set({ status: "failed", error: msg.slice(0, 2000), progress: null, updated_at: new Date() })
          .where("id", "=", id)
          .execute();
      })
      .finally(() => this.running.delete(job));
    this.running.add(job);
    return this.layer(projectId, id);
  }

  /**
   * Purpose: store a planner's population file as a new layer.
   * Inputs: the details, the file's format options and its bytes. Output: the ready layer. 400 with a message
   * the planner can act on when the file cannot be used.
   */
  async upload(
    actor: ProjectActor,
    projectId: string,
    details: LayerDetails,
    meta: UploadMeta,
    bytes: Buffer,
  ): Promise<PopulationLayer> {
    await this.projects.access(actor, projectId, "edit");
    if (bytes.length > this.settings.maxUploadBytes)
      throw new BadRequestException(
        `The file is larger than ${Math.round(this.settings.maxUploadBytes / 1024 / 1024)} MB`,
      );
    if (!bytes.length) throw new BadRequestException("The file is empty");
    const limits = { maxFeatures: this.settings.maxFeatures };
    const area = await projectArea(this.db, projectId);
    let parsed: ParsedUpload | null = null;
    let join: { values: Map<string, number>; skipped: number; zones: PopulationLayer } | null = null;
    try {
      if (meta.format === "geotiff") parsed = await parseGeoTiff(bytes, meta, area?.bbox ?? null, limits);
      else if (meta.format === "geojson") parsed = parseGeoJson(bytes, meta, limits);
      else if (meta.mode === "points") parsed = parseCsvPoints(bytes, meta, limits);
      else {
        const zones = await this.layer(projectId, meta.zonesLayerId);
        if (zones.kind !== "zones" || zones.status !== "ready")
          throw new UploadError("Values per zone are joined to a ready zone layer (GeoJSON) of this project");
        join = { ...parseCsvZones(bytes, meta, limits), zones };
      }
    } catch (e) {
      if (e instanceof UploadError) throw new BadRequestException(e.message);
      throw e;
    }
    const options: Record<string, unknown> = { ...meta, fileBytes: bytes.length };
    delete options.crs;
    if (meta.format !== "csv" || meta.mode === "points") if (meta.crs) options.crs = meta.crs.slice(0, 2000);
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto("geo.population_layer")
        .values({
          project_id: projectId,
          name: details.name,
          source: "upload",
          kind: join ? "zones" : parsed!.kind,
          status: "ready",
          licence: details.licence,
          source_url: details.sourceUrl,
          citation: details.citation,
          confidence: details.confidence,
          reference_year: details.referenceYear,
          resolution_m: parsed?.resolutionM ?? null,
          options: JSON.stringify(options),
          created_by: actor.userId,
          updated_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      let notes = parsed?.notes ?? [];
      if (parsed) await this.insertFeatures(tx, row.id, parsed.features);
      else if (join) {
        const ids = [...join.values.keys()];
        const people = ids.map((k) => join.values.get(k)!);
        const { rows } = await sql<{ matched: number }>`
          WITH v AS (SELECT * FROM unnest(${ids}::text[], ${people}::float8[]) AS t(zone_id, people)),
          ins AS (
            INSERT INTO geo.population_feature (layer_id, n, zone_id, people, geom)
            SELECT ${row.id}, row_number() OVER (ORDER BY f.n), f.zone_id, v.people, f.geom
            FROM geo.population_feature f JOIN v ON v.zone_id = f.zone_id
            WHERE f.layer_id = ${join.zones.id}
            RETURNING 1)
          SELECT count(*)::int AS matched FROM ins`.execute(tx);
        const matched = rows[0]?.matched ?? 0;
        if (!matched)
          throw new BadRequestException(`No zone id of the CSV matches a zone of "${join.zones.name}"`);
        notes = [];
        const unmatched = ids.length - matched;
        if (unmatched > 0) notes.push(`${unmatched} zone ids of the CSV match no zone and were left out.`);
        if (join.skipped) notes.push(`${join.skipped} rows without a zone id or people were left out.`);
      }
      await this.finish(tx, row.id, null, notes);
      await this.projects.logProject(
        actor,
        projectId,
        "project.population_uploaded",
        null,
        { layer: row.id, format: meta.format, bytes: bytes.length },
        tx,
      );
      return this.layer(projectId, row.id, tx);
    });
  }

  /** Purpose: change a layer's details (name, licence, citation, confidence, reference year). */
  async update(
    actor: ProjectActor,
    projectId: string,
    layerId: string,
    patch: Partial<LayerDetails>,
  ): Promise<PopulationLayer> {
    return this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const before = await this.layer(projectId, layerId, tx);
      await tx
        .updateTable("geo.population_layer")
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.licence !== undefined && { licence: patch.licence }),
          ...(patch.sourceUrl !== undefined && { source_url: patch.sourceUrl }),
          ...(patch.citation !== undefined && { citation: patch.citation }),
          ...(patch.confidence !== undefined && { confidence: patch.confidence }),
          ...(patch.referenceYear !== undefined && { reference_year: patch.referenceYear }),
          updated_at: new Date(),
        })
        .where("id", "=", layerId)
        .execute();
      await this.projects.logProject(
        actor,
        projectId,
        "project.population_layer_changed",
        {
          layer: layerId,
          name: before.name,
          confidence: before.confidence,
          referenceYear: before.referenceYear,
        },
        { layer: layerId, ...patch },
        tx,
      );
      return this.layer(projectId, layerId, tx);
    });
  }

  /** Purpose: choose the primary layer, or none (WorldPop's live grid). Output: the layers. */
  async setPrimary(
    actor: ProjectActor,
    projectId: string,
    layerId: string | null,
  ): Promise<PopulationLayer[]> {
    return this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const before = await this.rows(projectId, tx)
        .where("is_primary", "=", true)
        .select("id")
        .executeTakeFirst();
      if (layerId) {
        const l = await this.layer(projectId, layerId, tx);
        if (l.status !== "ready") throw new BadRequestException("Only a ready layer can be primary");
      }
      await tx
        .updateTable("geo.population_layer")
        .set({ is_primary: false })
        .where("project_id", "=", projectId)
        .where("is_primary", "=", true)
        .execute();
      if (layerId)
        await tx
          .updateTable("geo.population_layer")
          .set({ is_primary: true, updated_at: new Date() })
          .where("id", "=", layerId)
          .execute();
      await this.projects.logProject(
        actor,
        projectId,
        "project.population_primary_changed",
        { layer: before?.id ?? null },
        { layer: layerId },
        tx,
      );
      return this.list(projectId, tx);
    });
  }

  /** Purpose: delete a layer and its features. */
  async remove(actor: ProjectActor, projectId: string, layerId: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await this.projects.access(actor, projectId, "edit", tx, true);
      const l = await this.layer(projectId, layerId, tx);
      await tx.deleteFrom("geo.population_layer").where("id", "=", layerId).execute();
      await this.projects.logProject(
        actor,
        projectId,
        "project.population_layer_deleted",
        { layer: layerId, name: l.name, source: l.source },
        null,
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------------------------------------
  // Imports

  private async progress(id: string, p: Record<string, unknown>): Promise<void> {
    await this.db
      .updateTable("geo.population_layer")
      .set({ progress: JSON.stringify(p), updated_at: new Date() })
      .where("id", "=", id)
      .where("status", "=", "importing")
      .execute();
  }

  /** Purpose: run `wait` while copying a download's progress to the layer every two seconds. */
  private async withProgress<T>(
    id: string,
    step: string,
    read: () => { receivedBytes: number; totalBytes: number | null } | null,
    wait: Promise<T>,
  ): Promise<T> {
    await this.progress(id, { step });
    const timer = setInterval(() => {
      const p = read();
      if (p) this.progress(id, { step, ...p }).catch(() => undefined);
    }, 2_000);
    try {
      return await wait;
    } finally {
      clearInterval(timer);
    }
  }

  /** Purpose: WorldPop cells whose centre lies in the polygons, from the grid over their box. */
  private async importWorldPop(
    id: string,
    bbox: Bbox,
    polygons: readonly AreaPolygon[],
    year: number,
  ): Promise<void> {
    const inside = new AreaIndex(polygons);
    await this.progress(id, { step: "countries" });
    const codes = await this.population.countriesOf(bbox);
    if (!codes.length) throw new Error("OpenStreetMap places no country in the project area");
    const entries = (await Promise.all(codes.map((c) => this.worldpop.entry(c, year)))).filter(
      (e): e is WorldPopEntry => !!e,
    );
    if (!entries.length) throw new Error(`WorldPop has no population grid for ${codes.join(", ")}`);
    const files = await this.withProgress(
      id,
      "download",
      () => {
        const each = entries.map((e) => this.worldpop.downloadProgress(e)).filter((p) => !!p);
        return each.length
          ? {
              receivedBytes: each.reduce((a, p) => a + p.receivedBytes, 0),
              totalBytes: each.some((p) => p.totalBytes === null)
                ? null
                : each.reduce((a, p) => a + p.totalBytes!, 0),
            }
          : null;
      },
      Promise.all(entries.map((e) => this.worldpop.file(e))),
    );
    await this.progress(id, { step: "store" });
    const grid = emptyGrid(bbox);
    for (const f of files) await this.worldpop.addTo(grid, f);
    const w: number[] = [];
    const s: number[] = [];
    const p: number[] = [];
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const v = grid.people[j * grid.nx + i]!;
        if (!(v > 0)) continue;
        if (!inside.contains(grid.x0 + (i + 0.5) * CELL_DEG, grid.y0 + (j + 0.5) * CELL_DEG)) continue;
        w.push(grid.x0 + i * CELL_DEG);
        s.push(grid.y0 + j * CELL_DEG);
        p.push(v);
      }
    if (p.length > this.settings.maxFeatures)
      throw new Error(
        `The area has more than ${this.settings.maxFeatures.toLocaleString("en")} cells with people`,
      );
    const kept = coarsenMain(
      { w, s, e: w.map((x) => x + CELL_DEG), n: s.map((y) => y + CELL_DEG), p },
      polygons,
    );
    await this.insertCells(id, kept.w, kept.s, kept.e, kept.n, kept.p);
    const citation = entries.map((e) => e.citation).filter(Boolean)[0] ?? "";
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("geo.population_layer")
        .set({ citation, reference_year: entries[0]!.year })
        .where("id", "=", id)
        .execute();
      const notes =
        entries[0]!.year !== year ? [`WorldPop has no ${year}; ${entries[0]!.year} was used.`] : [];
      await this.finish(tx, id, { countries: entries.map((e) => e.iso3) }, notes);
    });
  }

  /** Purpose: GHSL cells whose centre lies in the polygons. */
  private async importGhsl(
    id: string,
    bbox: Bbox,
    polygons: readonly AreaPolygon[],
    epoch: number,
    res: GhslResolution,
  ): Promise<void> {
    const inside = new AreaIndex(polygons);
    const urls = this.ghsl.urls(bbox, epoch, res);
    const w: number[] = [];
    const s: number[] = [];
    const e: number[] = [];
    const n: number[] = [];
    const p: number[] = [];
    const tooMany = new Error(
      `The area has more than ${this.settings.maxFeatures.toLocaleString("en")} cells with people`,
    );
    const got = await this.withProgress(
      id,
      "download",
      () => this.ghsl.progress(urls),
      this.ghsl.read(bbox, epoch, res, (cw, cs, ce, cn, people) => {
        // Cells whose centre lies in the area's polygons, like the WorldPop import.
        const cx = (cw + ce) / 2;
        const cy = (cs + cn) / 2;
        if (!inside.contains(cx, cy)) return;
        if (p.length >= this.settings.maxFeatures) throw tooMany;
        w.push(cw);
        s.push(cs);
        e.push(ce);
        n.push(cn);
        p.push(people);
      }),
    );
    await this.progress(id, { step: "store" });
    const kept = coarsenMain({ w, s, e, n, p }, polygons);
    await this.insertCells(id, kept.w, kept.s, kept.e, kept.n, kept.p);
    const notes = got.missing.length
      ? [`GHSL has no tile ${got.missing.join(", ")} (open sea); it counts as nobody.`]
      : [];
    await this.db.transaction().execute(async (tx) => this.finish(tx, id, { tiles: got.tiles }, notes));
  }

  // -------------------------------------------------------------------------------------------------------
  // Storage

  /** Purpose: store grid cells (boxes in degrees) of a layer, in batches. */
  private async insertCells(id: string, w: number[], s: number[], e: number[], n: number[], p: number[]) {
    for (let k = 0; k < p.length; k += BATCH) {
      const sl = <T>(a: T[]) => a.slice(k, k + BATCH);
      await sql`
        INSERT INTO geo.population_feature (layer_id, n, people, geom)
        SELECT ${id}, ${k} + t.i, t.p, ST_MakeEnvelope(t.w, t.s, t.e, t.n, 4326)
        FROM unnest(${sl(w)}::float8[], ${sl(s)}::float8[], ${sl(e)}::float8[], ${sl(n)}::float8[], ${sl(p)}::float8[])
          WITH ORDINALITY AS t(w, s, e, n, p, i)`.execute(this.db);
    }
  }

  /** Purpose: store a parsed upload's features, in batches. */
  private async insertFeatures(db: Database, id: string, features: PopulationFeatureIn[]) {
    for (let k = 0; k < features.length; k += BATCH) {
      const part = features.slice(k, k + BATCH);
      await sql`
        INSERT INTO geo.population_feature (layer_id, n, zone_id, people, geom)
        SELECT ${id}, ${k} + t.i, t.z, t.p, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(t.g), 4326))
        FROM unnest(${part.map((f) => JSON.stringify(f.geom))}::text[], ${part.map((f) => f.people)}::float8[],
                    ${part.map((f) => f.zoneId)}::text[])
          WITH ORDINALITY AS t(g, p, z, i)`.execute(db);
    }
  }

  /**
   * Purpose: mark a layer ready with its totals, coverage (uploads: the box round its features; none when the
   * features lie on a line or a point) and notes.
   */
  private async finish(db: Database, id: string, extra: Record<string, unknown> | null, notes: string[]) {
    await sql`
      UPDATE geo.population_layer l SET
        status = 'ready', error = NULL, progress = NULL, updated_at = now(),
        people_total = coalesce(t.total, 0), feature_count = coalesce(t.count, 0),
        coverage = coalesce(l.coverage, CASE WHEN GeometryType(t.box) = 'POLYGON' THEN t.box END),
        options = l.options || ${JSON.stringify({ ...(extra ?? {}), notes })}::jsonb
      FROM (SELECT sum(people) AS total, count(*)::int AS count,
                   ST_SetSRID(ST_Envelope(ST_Extent(geom)::geometry), 4326) AS box
            FROM geo.population_feature WHERE layer_id = ${id}) t
      WHERE l.id = ${id}`.execute(db);
  }

  private rows(projectId: string, db: Database = this.db) {
    return db
      .selectFrom("geo.population_layer")
      .selectAll()
      .select(
        sql<
          string | null
        >`CASE WHEN coverage IS NULL THEN NULL ELSE ST_AsGeoJSON(ST_Envelope(coverage)) END`.as(
          "coverage_box",
        ),
      )
      .where("project_id", "=", projectId);
  }

  private async list(projectId: string, db: Database = this.db): Promise<PopulationLayer[]> {
    const rows = await this.rows(projectId, db).orderBy("created_at", "asc").execute();
    return rows.map((r) => this.view(r as LayerRow));
  }

  private async layer(projectId: string, layerId: string, db: Database = this.db): Promise<PopulationLayer> {
    const row = await this.rows(projectId, db).where("id", "=", layerId).executeTakeFirst();
    if (!row) throw new NotFoundException("population layer not found");
    return this.view(row as LayerRow);
  }

  private view(r: LayerRow): PopulationLayer {
    let coverage: Bbox | null = null;
    if (r.coverage_box) {
      const ring = (JSON.parse(r.coverage_box) as { coordinates: [number, number][][] }).coordinates[0] ?? [];
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      if (xs.length) coverage = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    return {
      id: r.id,
      name: r.name,
      source: r.source,
      kind: r.kind,
      status: r.status,
      error: r.error,
      progress: (r.progress as PopulationLayer["progress"]) ?? null,
      licence: r.licence,
      sourceUrl: r.source_url,
      citation: r.citation,
      confidence: r.confidence,
      referenceYear: r.reference_year,
      resolutionM: r.resolution_m === null ? null : Number(r.resolution_m),
      coverage,
      peopleTotal: Math.round(Number(r.people_total) * 100) / 100,
      featureCount: Number(r.feature_count),
      isPrimary: r.is_primary,
      options: r.options,
      createdAt: r.created_at.toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }
}

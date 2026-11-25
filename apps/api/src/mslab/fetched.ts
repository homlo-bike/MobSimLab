import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { DATABASE, type Database, type DB } from "../db/database";
import { decodeValues, encodeValues, tileBounds } from "../geodata/dem-tiles";
import { GeodataService } from "../geodata/geodata.service";
import { type AreaPolygon, boxMeetsPolygons } from "../projects/area-polygons";
import {
  FETCHED_CHUNK_BYTES,
  FETCHED_FILES,
  type FetchedElevationFile,
  type FetchedElevationTile,
  type FetchedFactsFile,
  type FetchedLiveFile,
  type FetchedOsmFile,
  type FetchedPopulationFile,
  type LiveKind,
} from "./format.mts";
import type { ReadFetched } from "./read.mts";

/**
 * The data a project fetched or imported, saved in a `.mslab` file (format 1.6) and brought back when the file is
 * opened, so the new project works without downloading it again: the location facts it looked up (country,
 * holidays, climate, economy figures), the street tiles and heights its tools fetched live, its elevation tiles and
 * its population layers.
 */

/** Which kinds of fetched data a saved file holds (Project preferences → Saved project files). */
export interface FetchedChoice {
  /** Country, public holidays and climate. */
  facts: boolean;
  /** Price levels, exchange rates and the benefit tables' country figures. */
  economy: boolean;
  /** Other looked-up answers (the OpenStreetMap areas round a point). */
  otherFetched: boolean;
  /** Street, rail, walk, building and place tiles the tools fetched live. */
  liveTiles: boolean;
  /** Elevation tiles of the GLO-30 import and heights fetched live. */
  elevation: boolean;
  /** WorldPop and GHSL layers. */
  population: boolean;
  /** The planner's own elevation and population files. */
  uploads: boolean;
  /** The OpenStreetMap extract of the project area. */
  osm: boolean;
}

/** Every kind in the file. */
export const ALL_FETCHED: FetchedChoice = {
  facts: true,
  economy: true,
  otherFetched: true,
  liveTiles: true,
  elevation: true,
  population: true,
  uploads: true,
  osm: true,
};

/** What of the fetched data a file holds, for its attribution and the audit trail. */
export interface FetchedSummary {
  facts: number;
  liveTiles: number;
  liveHeights: number;
  elevationTiles: number;
  /** Names of the population layers with their sources. */
  populationLayers: { name: string; source: string; licence: string }[];
  /** Sources of the elevation: names with licences. */
  elevationSources: string[];
  /** Megabytes of the OpenStreetMap extract (0 without one) and how the import got it. */
  osmBytes: number;
  osmVia: string | null;
  /** Kinds left out because the file would have grown beyond what a project file may hold. */
  leftOut: string[];
}

/** Location facts by key prefix (projects/data-cache.ts `factKey`): economy figures, other answers, the rest. */
export function factGroup(key: string): "economy" | "otherFetched" | "facts" {
  if (key.startsWith("economy") || key.startsWith("benefit-indicators/")) return "economy";
  if (key.startsWith("osm-areas/")) return "otherFetched";
  return "facts";
}

/** GLO-30 tiles outside the full-detail polygons keep every third sample: about 90 m instead of 30 m. */
const COARSE = 3;

/**
 * Purpose: a tile with every third row and column (about 90 m for GLO-30), keeping its outer rows and columns so
 * it still meets its neighbours. Output: null when the tile's size does not allow that; it is then saved as it is.
 */
export function coarseTile(
  data: Buffer,
  width: number,
  height: number,
): { data: Buffer; width: number; height: number } | null {
  if (width < COARSE + 1 || height < COARSE + 1) return null;
  if ((width - 1) % COARSE !== 0 || (height - 1) % COARSE !== 0) return null;
  const from = decodeValues(data, width, height);
  const w = (width - 1) / COARSE + 1;
  const h = (height - 1) / COARSE + 1;
  const to = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) to[y * w + x] = from[y * COARSE * width + x * COARSE]!;
  return { data: encodeValues(to), width: w, height: h };
}

const isoDate = z.iso.datetime({ offset: true });
const key = z.string().min(1).max(250);
const box = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const factsFile = z.object({
  entries: z.array(z.object({ key, fetchedAt: isoDate, body: z.string().max(8_388_608) })).max(5000),
}) satisfies z.ZodType<FetchedFactsFile>;
const liveFile = z.object({
  kind: z.enum(["osm", "height"]),
  entries: z.array(z.object({ key, dataDate: isoDate, body: z.string().max(67_108_864) })).max(200_000),
}) satisfies z.ZodType<FetchedLiveFile>;
const elevationFile = z.object({
  imports: z
    .array(
      z.object({
        kind: z.enum(["dem", "dem_upload"]),
        method: z.enum(["copernicus", "geotiff"]),
        bbox: box,
        bufferKm: z.number().min(0).max(50),
        source: z.record(z.string(), z.unknown()),
        finishedAt: isoDate,
        tiles: z
          .array(
            z.object({
              chunk: z.number().int().min(1).max(9999),
              offset: z.number().int().min(0),
              bytes: z.number().int().min(1).max(67_108_864),
              priority: z.number().int().min(0).max(1),
              width: z.number().int().min(1).max(4096),
              height: z.number().int().min(1).max(4096),
              originLon: z.number().min(-180).max(180),
              originLat: z.number().min(-90).max(90),
              stepLon: z.number().positive().max(1),
              stepLat: z.number().positive().max(1),
            }),
          )
          .max(200_000),
      }),
    )
    .max(20),
}) satisfies z.ZodType<FetchedElevationFile>;
const populationFile = z.object({
  layers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        source: z.enum(["worldpop", "ghsl", "upload"]),
        kind: z.enum(["grid", "zones", "points"]),
        licence: z.string().max(500),
        sourceUrl: z.string().max(2000),
        citation: z.string().max(2000),
        confidence: z.enum(["high", "medium", "low"]),
        referenceYear: z.number().int().min(1800).max(2200).nullable(),
        resolutionM: z.number().positive().nullable(),
        coverage: box.nullable(),
        peopleTotal: z.number().min(0),
        featureCount: z.number().int().min(0),
        isPrimary: z.boolean(),
        options: z.record(z.string(), z.unknown()),
        updatedAt: isoDate,
        files: z.number().int().min(0).max(9999),
      }),
    )
    .max(50),
}) satisfies z.ZodType<FetchedPopulationFile>;
const featureLine = z.tuple([
  z.number().int().min(0).max(2_147_483_647),
  z.string().max(200).nullable(),
  z.number().min(0),
  z
    .string()
    .regex(/^(?:[0-9a-f]{2}){5,}$/)
    .max(4_000_000),
]);

const osmFile = z.object({
  method: z.enum(["overpass", "geofabrik", "upload"]),
  planned: z.boolean(),
  source: z.record(z.string(), z.unknown()),
  finishedAt: isoDate,
  bytes: z.number().int().min(1).max(1_073_741_824),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  chunks: z.number().int().min(1).max(999),
}) satisfies z.ZodType<FetchedOsmFile>;

/** The fetched data of an opened file, checked, ready to be stored with the new project. */
export interface FetchedData {
  facts: FetchedFactsFile["entries"];
  live: FetchedLiveFile[];
  elevation: { index: FetchedElevationFile; chunks: Map<number, Buffer> } | null;
  population: { index: FetchedPopulationFile; features: Map<number, z.infer<typeof featureLine>[][]> } | null;
  /** The OpenStreetMap extract; it is imported after the project is stored (`GeodataService.restoreOsm`). */
  osm: { index: FetchedOsmFile; body: Buffer } | null;
}

/** What `restore` stored. */
export interface FetchedCounts {
  facts: number;
  live: number;
  elevationTiles: number;
  populationLayers: number;
}

const notValid = () => new BadRequestException("the downloaded data in the file is not valid");

/**
 * Purpose: read the fetched data the sandboxed reader wrote to its scratch folder and check it once more.
 * Inputs: the reader's answer and a function reading a scratch file. Output: the data. 400 when it is not valid.
 */
export async function parseFetched(
  read: ReadFetched,
  file: (name: string) => Promise<Buffer>,
): Promise<FetchedData> {
  const parse = async <T>(name: string, schema: z.ZodType<T>): Promise<T> => {
    let value: unknown;
    try {
      value = JSON.parse((await file(name)).toString("utf8"));
    } catch {
      throw notValid();
    }
    const r = schema.safeParse(value);
    if (!r.success) throw notValid();
    return r.data;
  };
  const out: FetchedData = { facts: [], live: [], elevation: null, population: null, osm: null };
  if (read.facts) out.facts = (await parse(read.facts, factsFile)).entries;
  for (const name of read.live) out.live.push(await parse(name, liveFile));
  if (read.elevation) {
    const index = await parse(read.elevation.index, elevationFile);
    const chunks = new Map<number, Buffer>();
    for (const c of read.elevation.chunks) chunks.set(c.n, await file(c.file));
    for (const imp of index.imports)
      for (const t of imp.tiles)
        if ((chunks.get(t.chunk)?.length ?? -1) < t.offset + t.bytes) throw notValid();
    out.elevation = { index, chunks };
  }
  if (read.population) {
    const index = await parse(read.population.index, populationFile);
    const features = new Map<number, z.infer<typeof featureLine>[][]>();
    for (const f of [...read.population.files].sort((a, b) => a.layer - b.layer || a.n - b.n)) {
      if (f.layer < 1 || f.layer > index.layers.length) throw notValid();
      const rows: z.infer<typeof featureLine>[] = [];
      for (const line of (await file(f.file)).toString("utf8").split("\n")) {
        if (!line) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          throw notValid();
        }
        const r = featureLine.safeParse(value);
        if (!r.success) throw notValid();
        rows.push(r.data);
      }
      const list = features.get(f.layer) ?? [];
      list.push(rows);
      features.set(f.layer, list);
    }
    out.population = { index, features };
  }
  if (read.osm) {
    const index = await parse(read.osm.index, osmFile);
    if (read.osm.chunks.length !== index.chunks) throw notValid();
    const body = Buffer.concat(await Promise.all(read.osm.chunks.map((c) => file(c))));
    if (body.length !== index.bytes || createHash("sha256").update(body).digest("hex") !== index.sha256)
      throw notValid();
    out.osm = { index, body };
  }
  return out;
}

@Injectable()
export class MslabFetchedService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    // Absent when the API is assembled without imports (some tests): files then carry no map extract.
    @Optional() private readonly geodata?: GeodataService,
  ) {}

  /**
   * Purpose: the files of the project's fetched and imported data for a `.mslab` file.
   * Inputs: the project, its area polygons (GLO-30 tiles outside the full-detail ones are saved at about 90 m),
   * which kinds to save, and how many bytes the files may take together; a kind that no longer fits is left out
   * and named in the summary. Output: the files and what they hold. Side effects: none.
   */
  async files(
    projectId: string,
    polygons: readonly AreaPolygon[],
    choice: FetchedChoice,
    budgetBytes: number,
  ): Promise<{ files: [string, Buffer][]; summary: FetchedSummary }> {
    const files: [string, Buffer][] = [];
    const summary: FetchedSummary = {
      facts: 0,
      liveTiles: 0,
      liveHeights: 0,
      elevationTiles: 0,
      populationLayers: [],
      elevationSources: [],
      osmBytes: 0,
      osmVia: null,
      leftOut: [],
    };
    let left = budgetBytes;
    /** Adds a kind's files when they fit; otherwise names the kind as left out. */
    const take = (label: string, part: [string, Buffer][]): boolean => {
      const bytes = part.reduce((s, [, b]) => s + b.length, 0);
      if (bytes > left) {
        summary.leftOut.push(label);
        return false;
      }
      left -= bytes;
      files.push(...part);
      return true;
    };

    if (choice.facts || choice.economy || choice.otherFetched) {
      const rows = await this.db
        .selectFrom("project.data_cache")
        .select(["key", "body", "fetched_at"])
        .where("project_id", "=", projectId)
        .where("kind", "=", "facts")
        .orderBy("key")
        .execute();
      const entries = rows
        .filter((r) => choice[factGroup(r.key)] && r.key.length <= 250 && r.body.length <= 8_388_608)
        .map((r) => ({ key: r.key, fetchedAt: r.fetched_at.toISOString(), body: r.body }));
      if (
        entries.length &&
        take("location facts", [
          [FETCHED_FILES.facts, Buffer.from(JSON.stringify({ entries } satisfies FetchedFactsFile))],
        ])
      )
        summary.facts = entries.length;
    }

    for (const kind of ["osm", "height"] as const) {
      if (!(kind === "osm" ? choice.liveTiles : choice.elevation)) continue;
      const part = await this.liveFiles(projectId, kind);
      if (
        part.count &&
        take(kind === "osm" ? "street tiles fetched live" : "heights fetched live", part.files)
      )
        summary[kind === "osm" ? "liveTiles" : "liveHeights"] = part.count;
    }

    if (choice.elevation || choice.uploads) {
      const part = await this.elevationFiles(projectId, polygons, choice);
      if (part.tiles && take("elevation", part.files)) {
        summary.elevationTiles = part.tiles;
        summary.elevationSources = part.sources;
      }
    }

    if (choice.population || choice.uploads) {
      const part = await this.populationFiles(projectId, choice);
      if (part.layers.length && take("population layers", part.files)) summary.populationLayers = part.layers;
    }

    // Last, as it is the largest: the other kinds stay when it no longer fits.
    if (choice.osm) {
      const part = await this.osmFiles(projectId);
      if (part && take("map extract", part.files)) {
        summary.osmBytes = part.bytes;
        summary.osmVia = part.via;
      }
    }
    return { files, summary };
  }

  /** Purpose: the extract of the project's current OpenStreetMap import, in parts, with its index. */
  private async osmFiles(
    projectId: string,
  ): Promise<{ files: [string, Buffer][]; bytes: number; via: string | null } | null> {
    const run = await this.geodata?.current(projectId, "osm");
    if (!run || !this.geodata) return null;
    if (run.method !== "overpass" && run.method !== "geofabrik" && run.method !== "upload") return null;
    let body: Buffer;
    try {
      body = await readFile(this.geodata.extractPath(projectId, run.id));
    } catch {
      // Imports from before extracts were kept, or a data volume that lost the file.
      return null;
    }
    if (!body.length) return null;
    const files: [string, Buffer][] = [];
    for (let at = 0; at < body.length; at += FETCHED_CHUNK_BYTES)
      files.push([FETCHED_FILES.osmChunk(files.length + 1), body.subarray(at, at + FETCHED_CHUNK_BYTES)]);
    const index: FetchedOsmFile = {
      method: run.method,
      planned: run.options.planned === true,
      source: run.source ?? {},
      finishedAt: (run.finishedAt ? new Date(run.finishedAt) : new Date()).toISOString(),
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      chunks: files.length,
    };
    files.unshift([FETCHED_FILES.osm, Buffer.from(JSON.stringify(index))]);
    const via = typeof index.source.via === "string" ? index.source.via : null;
    return { files, bytes: body.length, via };
  }

  /** Purpose: the live-fetched copies the project points at, in files of at most FETCHED_CHUNK_BYTES of bodies. */
  private async liveFiles(
    projectId: string,
    kind: LiveKind,
  ): Promise<{ files: [string, Buffer][]; count: number }> {
    const files: [string, Buffer][] = [];
    let entries: FetchedLiveFile["entries"] = [];
    let bytes = 0;
    let count = 0;
    const flush = () => {
      if (!entries.length) return;
      files.push([
        FETCHED_FILES.live(kind, files.length + 1),
        Buffer.from(JSON.stringify({ kind, entries } satisfies FetchedLiveFile)),
      ]);
      entries = [];
      bytes = 0;
    };
    let after = "";
    for (;;) {
      const rows = await this.db
        .selectFrom("project.data_use as u")
        .innerJoin("geo.shared_data as s", "s.id", "u.shared_id")
        .select(["u.key", "s.data_date", "s.body"])
        .where("u.project_id", "=", projectId)
        .where("u.kind", "=", kind)
        .where("u.key", ">", after)
        .orderBy("u.key")
        .limit(200)
        .execute();
      if (!rows.length) break;
      after = rows[rows.length - 1]!.key;
      for (const r of rows) {
        if (r.key.length > 250) continue;
        if (bytes + r.body.length > FETCHED_CHUNK_BYTES) flush();
        entries.push({ key: r.key, dataDate: r.data_date.toISOString(), body: r.body.toString("utf8") });
        bytes += r.body.length + r.key.length + 60;
        count++;
      }
    }
    flush();
    return { files, count };
  }

  /** Purpose: the elevation tiles of the project's finished imports, packed into chunks, with their index. */
  private async elevationFiles(
    projectId: string,
    polygons: readonly AreaPolygon[],
    choice: FetchedChoice,
  ): Promise<{ files: [string, Buffer][]; tiles: number; sources: string[] }> {
    const { rows: imports } = await sql<{
      id: string;
      kind: "dem" | "dem_upload";
      method: "copernicus" | "geotiff";
      bbox: number[];
      buffer_km: string;
      source: Record<string, unknown> | null;
      finished_at: Date | null;
    }>`
      SELECT i.id, i.kind, i.method, i.bbox, i.buffer_km, i.source, i.finished_at
      FROM geo.import i
      WHERE i.project_id = ${projectId} AND i.status = 'done' AND i.kind IN ('dem', 'dem_upload')
        AND EXISTS (SELECT 1 FROM geo.dem_tile t WHERE t.import_id = i.id)
      ORDER BY i.finished_at`.execute(this.db);
    const full = polygons.filter((p) => p.detail === "full");
    const coarsen = polygons.length > 0;
    const files: [string, Buffer][] = [];
    const index: FetchedElevationFile = { imports: [] };
    const sources: string[] = [];
    let chunk: Buffer[] = [];
    let chunkBytes = 0;
    let tiles = 0;
    const flush = () => {
      if (!chunk.length) return;
      files.push([FETCHED_FILES.elevationChunk(files.length + 1), Buffer.concat(chunk)]);
      chunk = [];
      chunkBytes = 0;
    };
    for (const imp of imports) {
      const own = imp.method === "geotiff";
      if (!(own ? choice.uploads : choice.elevation)) continue;
      const out: FetchedElevationTile[] = [];
      let after = "0";
      for (;;) {
        const { rows } = await sql<{
          id: string;
          priority: number;
          width: number;
          height: number;
          origin_lon: number;
          origin_lat: number;
          step_lon: number;
          step_lat: number;
          data: Buffer;
        }>`
          SELECT id::text AS id, priority, width, height, origin_lon, origin_lat, step_lon, step_lat, data
          FROM geo.dem_tile WHERE import_id = ${imp.id} AND id > ${after}::bigint
          ORDER BY id LIMIT 16`.execute(this.db);
        if (!rows.length) break;
        after = rows[rows.length - 1]!.id;
        for (const r of rows) {
          let t = {
            data: r.data,
            width: r.width,
            height: r.height,
            stepLon: r.step_lon,
            stepLat: r.step_lat,
          };
          // GLO-30 outside the full-detail polygons: about 90 m (every third sample).
          if (!own && coarsen) {
            const bounds = tileBounds({
              width: r.width,
              height: r.height,
              originLon: r.origin_lon,
              originLat: r.origin_lat,
              stepLon: r.step_lon,
              stepLat: r.step_lat,
            });
            const c = boxMeetsPolygons(bounds, full) ? null : coarseTile(r.data, r.width, r.height);
            if (c) t = { ...c, stepLon: r.step_lon * COARSE, stepLat: r.step_lat * COARSE };
          }
          if (chunkBytes + t.data.length > FETCHED_CHUNK_BYTES) flush();
          out.push({
            chunk: files.length + 1,
            offset: chunkBytes,
            bytes: t.data.length,
            priority: r.priority,
            width: t.width,
            height: t.height,
            originLon: r.origin_lon,
            originLat: r.origin_lat,
            stepLon: t.stepLon,
            stepLat: t.stepLat,
          });
          chunk.push(t.data);
          chunkBytes += t.data.length;
        }
      }
      if (!out.length) continue;
      tiles += out.length;
      const source = imp.source ?? {};
      index.imports.push({
        kind: imp.kind,
        method: imp.method,
        bbox: imp.bbox.slice(0, 4) as [number, number, number, number],
        bufferKm: Number(imp.buffer_km),
        source,
        finishedAt: (imp.finished_at ?? new Date()).toISOString(),
        tiles: out,
      });
      const name =
        typeof source.name === "string" ? source.name : own ? "the planner's own file" : "Copernicus GLO-30";
      const licence = typeof source.licence === "string" && source.licence ? `, ${source.licence}` : "";
      sources.push(`${name}${licence}`.replace(/[\r\n]/g, " ").slice(0, 300));
    }
    flush();
    if (tiles) files.unshift([FETCHED_FILES.elevation, Buffer.from(JSON.stringify(index))]);
    return { files, tiles, sources };
  }

  /** Purpose: the project's ready population layers with their features as lines of `[n, zone, people, WKB hex]`. */
  private async populationFiles(
    projectId: string,
    choice: FetchedChoice,
  ): Promise<{ files: [string, Buffer][]; layers: FetchedSummary["populationLayers"] }> {
    const { rows } = await sql<{
      id: string;
      name: string;
      source: "worldpop" | "ghsl" | "upload";
      kind: "grid" | "zones" | "points";
      licence: string;
      source_url: string;
      citation: string;
      confidence: "high" | "medium" | "low";
      reference_year: number | null;
      resolution_m: number | null;
      w: number | null;
      s: number | null;
      e: number | null;
      n: number | null;
      people_total: number;
      feature_count: number;
      is_primary: boolean;
      options: Record<string, unknown> | null;
      updated_at: Date;
    }>`
      SELECT id, name, source, kind, licence, source_url, citation, confidence, reference_year, resolution_m,
             ST_XMin(coverage) AS w, ST_YMin(coverage) AS s, ST_XMax(coverage) AS e, ST_YMax(coverage) AS n,
             people_total, feature_count, is_primary, options, updated_at
      FROM geo.population_layer
      WHERE project_id = ${projectId} AND status = 'ready'
      ORDER BY created_at, id`.execute(this.db);
    const files: [string, Buffer][] = [];
    const index: FetchedPopulationFile = { layers: [] };
    const layers: FetchedSummary["populationLayers"] = [];
    for (const l of rows) {
      if (!(l.source === "upload" ? choice.uploads : choice.population)) continue;
      const k = index.layers.length + 1;
      let lines: string[] = [];
      let bytes = 0;
      let n = 0;
      const flush = () => {
        if (!lines.length) return;
        n++;
        files.push([FETCHED_FILES.populationFeatures(k, n), Buffer.from(`${lines.join("\n")}\n`)]);
        lines = [];
        bytes = 0;
      };
      let after = -1;
      for (;;) {
        const feats = await sql<{ n: number; zone_id: string | null; people: number; g: string }>`
          SELECT n, zone_id, people, encode(ST_AsBinary(geom), 'hex') AS g
          FROM geo.population_feature WHERE layer_id = ${l.id} AND n > ${after}
          ORDER BY n LIMIT 5000`.execute(this.db);
        if (!feats.rows.length) break;
        after = feats.rows[feats.rows.length - 1]!.n;
        for (const f of feats.rows) {
          const line = JSON.stringify([f.n, f.zone_id, f.people, f.g]);
          if (bytes + line.length > FETCHED_CHUNK_BYTES) flush();
          lines.push(line);
          bytes += line.length + 1;
        }
      }
      flush();
      index.layers.push({
        name: l.name,
        source: l.source,
        kind: l.kind,
        licence: l.licence,
        sourceUrl: l.source_url,
        citation: l.citation,
        confidence: l.confidence,
        referenceYear: l.reference_year,
        resolutionM: l.resolution_m,
        coverage: l.w === null || l.s === null || l.e === null || l.n === null ? null : [l.w, l.s, l.e, l.n],
        peopleTotal: l.people_total,
        featureCount: l.feature_count,
        isPrimary: l.is_primary,
        options: l.options ?? {},
        updatedAt: l.updated_at.toISOString(),
        files: n,
      });
      layers.push({ name: l.name, source: l.source, licence: l.licence });
    }
    if (index.layers.length) files.unshift([FETCHED_FILES.population, Buffer.from(JSON.stringify(index))]);
    return { files, layers };
  }

  /**
   * Purpose: store an opened file's fetched data with the new project, in the import's transaction.
   * Live tiles and heights are stored for this project only (their key in the shared store carries the project),
   * so a file cannot change what other projects read. Output: what was stored. 400 when a population geometry or
   * an elevation tile cannot be stored.
   */
  async restore(
    tx: Transaction<DB>,
    projectId: string,
    userId: string,
    data: FetchedData,
  ): Promise<FetchedCounts> {
    const counts: FetchedCounts = { facts: 0, live: 0, elevationTiles: 0, populationLayers: 0 };
    for (let i = 0; i < data.facts.length; i += 200) {
      const batch = data.facts.slice(i, i + 200);
      await tx
        .insertInto("project.data_cache")
        .values(
          batch.map((f) => ({
            project_id: projectId,
            kind: "facts" as const,
            key: f.key,
            body: f.body,
            fetched_at: new Date(f.fetchedAt),
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
      counts.facts += batch.length;
    }

    for (const file of data.live) {
      const seen = new Set<string>();
      const entries = file.entries.filter((e) => !seen.has(e.key) && seen.add(e.key));
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100);
        const rows = await tx
          .insertInto("geo.shared_data")
          .values(
            batch.map((e) => ({
              kind: file.kind,
              // Not a key any tool asks for: only this project's pointer reaches the copy.
              key: `file/${projectId}/${e.key}`,
              data_date: new Date(e.dataDate),
              body: Buffer.from(e.body, "utf8"),
            })),
          )
          .returning(["id", "key"])
          .execute();
        const prefix = `file/${projectId}/`.length;
        await tx
          .insertInto("project.data_use")
          .values(
            rows.map((r) => ({
              project_id: projectId,
              kind: file.kind,
              key: r.key.slice(prefix),
              shared_id: r.id,
            })),
          )
          .onConflict((oc) => oc.doNothing())
          .execute();
        counts.live += rows.length;
      }
    }

    if (data.elevation) {
      for (const imp of data.elevation.index.imports) {
        const { rows } = await sql<{ id: string }>`
          INSERT INTO geo.import (project_id, kind, method, status, bbox, buffer_km, options, stats, source,
            requested_by, started_at, finished_at)
          VALUES (${projectId}::uuid, ${imp.kind}, ${imp.method}, 'done',
            ${sql.raw(`ARRAY[${imp.bbox.map((v) => Number(v)).join(",")}]::double precision[]`)},
            ${imp.bufferKm}, ${JSON.stringify({ fromFile: true })}::jsonb,
            ${JSON.stringify({ tiles: imp.tiles.length })}::jsonb, ${JSON.stringify(imp.source)}::jsonb,
            ${userId}::uuid, ${new Date(imp.finishedAt)}, ${new Date(imp.finishedAt)})
          RETURNING id`.execute(tx);
        const importId = rows[0]!.id;
        for (let i = 0; i < imp.tiles.length; i += 16) {
          const batch = imp.tiles.slice(i, i + 16);
          await sql`
            INSERT INTO geo.dem_tile (project_id, import_id, priority, width, height, origin_lon, origin_lat,
              step_lon, step_lat, data, envelope)
            VALUES ${sql.join(
              batch.map((t) => {
                const [bw, bs, be, bn] = tileBounds(t);
                const body = data.elevation!.chunks.get(t.chunk)!.subarray(t.offset, t.offset + t.bytes);
                return sql`(${projectId}::uuid, ${importId}::uuid, ${t.priority}, ${t.width}, ${t.height},
                  ${t.originLon}, ${t.originLat}, ${t.stepLon}, ${t.stepLat}, ${Buffer.from(body)},
                  ST_MakeEnvelope(${bw}, ${bs}, ${be}, ${bn}, 4326))`;
              }),
            )}`.execute(tx);
          counts.elevationTiles += batch.length;
        }
      }
    }

    if (data.population) {
      let primary = false;
      for (const [k, l] of data.population.index.layers.entries()) {
        const isPrimary: boolean = l.isPrimary && !primary;
        primary ||= isPrimary;
        const row = await tx
          .insertInto("geo.population_layer")
          .values({
            project_id: projectId,
            name: l.name,
            source: l.source,
            kind: l.kind,
            status: "ready",
            progress: null,
            licence: l.licence,
            source_url: l.sourceUrl,
            citation: l.citation,
            confidence: l.confidence,
            reference_year: l.referenceYear,
            resolution_m: l.resolutionM,
            is_primary: isPrimary,
            options: JSON.stringify(l.options),
            created_by: userId,
            updated_at: new Date(l.updatedAt),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        if (l.coverage)
          await sql`UPDATE geo.population_layer SET coverage = ST_MakeEnvelope(${l.coverage[0]}, ${l.coverage[1]},
            ${l.coverage[2]}, ${l.coverage[3]}, 4326) WHERE id = ${row.id}`.execute(tx);
        const seen = new Set<number>();
        for (const part of data.population.features.get(k + 1) ?? []) {
          const feats = part.filter((f) => !seen.has(f[0]) && seen.add(f[0]));
          for (let i = 0; i < feats.length; i += 1000) {
            const batch = feats.slice(i, i + 1000);
            try {
              await sql`
                INSERT INTO geo.population_feature (layer_id, n, zone_id, people, geom)
                SELECT ${row.id}::uuid, v.n, v.zone_id, v.people, ST_SetSRID(ST_GeomFromWKB(decode(v.g, 'hex')), 4326)
                FROM (VALUES ${sql.join(
                  batch.map(
                    (f) => sql`(${f[0]}::integer, ${f[1]}::text, ${f[2]}::double precision, ${f[3]}::text)`,
                  ),
                )}) AS v (n, zone_id, people, g)`.execute(tx);
            } catch {
              throw notValid();
            }
          }
        }
        // The totals as the stored features give them, not as the file says.
        await sql`
          UPDATE geo.population_layer l
          SET feature_count = f.n, people_total = f.people
          FROM (SELECT count(*)::integer AS n, coalesce(sum(people), 0) AS people
                FROM geo.population_feature WHERE layer_id = ${row.id}) f
          WHERE l.id = ${row.id}`.execute(tx);
        counts.populationLayers++;
      }
    }
    return counts;
  }
}

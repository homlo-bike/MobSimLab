import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { projectChain } from "../audit/audit.service";
import { DATABASE, type Database } from "../db/database";
import { VALUE_CHANGED, VALUE_OBJECT, VALUE_REASON } from "../projects/value-history";
import { type ProjectActor, ProjectsService } from "../projects/projects.service";

/**
 * The kinds of data a project holds, as Project preferences → Saved project files lists them. `design` (what the
 * planner drew and set) is always saved; the others have a switch. `uploads` are the planner's own OpenStreetMap,
 * elevation and population files.
 */
export const SAVED_DATA_IDS = [
  "design",
  "vehicles",
  "processed",
  "runs",
  "comments",
  "history",
  "osm",
  "liveTiles",
  "elevation",
  "population",
  "uploads",
  "facts",
  "economy",
  "otherFetched",
  "viewerMap",
] as const;
export type SavedDataId = (typeof SAVED_DATA_IDS)[number];

/** One kind of data the project holds: how large it is, where it came from and when it was fetched or made. */
export interface SavedDataRow {
  id: SavedDataId;
  /** Bytes the project holds of it (before the file's compression); 0 when it holds none. */
  bytes: number;
  /** How many items: drawings, results, runs, comments, changes, tiles, layers, facts. */
  items: number;
  /** When it was last fetched or worked out, ISO time; null when the project holds none. */
  at: string | null;
  /** Where it came from: the services' names, or empty for what the planner made. */
  sources: string[];
}

/** Location facts by key prefix (projects/area-facts.ts): economy figures, other fetched data, the rest. */
function factGroup(key: string): "economy" | "otherFetched" | "facts" {
  if (key.startsWith("economy") || key.startsWith("benefit-indicators/")) return "economy";
  if (key.startsWith("osm-areas/")) return "otherFetched";
  return "facts";
}

const FACT_SOURCES: Record<string, string> = {
  "country-at/": "OpenStreetMap",
  "holidays/": "Nager.Date",
  "climate/": "Open-Meteo",
  "area-countries": "OpenStreetMap",
  economy: "World Bank",
  "benefit-indicators/": "World Bank",
  "osm-areas/": "OpenStreetMap",
};

const POPULATION_SOURCES: Record<string, string> = { worldpop: "WorldPop", ghsl: "GHSL" };
const OSM_SOURCES: Record<string, string> = {
  overpass: "OpenStreetMap (Overpass)",
  geofabrik: "OpenStreetMap (Geofabrik)",
};
const DEM_SOURCES: Record<string, string> = { copernicus: "Copernicus GLO-30" };

const iso = (d: Date | string | null | undefined): string | null =>
  d ? (d instanceof Date ? d : new Date(d)).toISOString() : null;
const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);
const num = (x: unknown): number => (typeof x === "number" ? x : Number(x ?? 0)) || 0;

/**
 * What a project holds of each kind of data a `.mslab` file can carry: size, count, date and source, for
 * Project preferences → Saved project files.
 */
@Injectable()
export class MslabContentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Purpose: the size, count, date and source of each kind of data the project holds.
   * Inputs: the caller (must be able to read the project) and the project id. Output: one row per `SAVED_DATA_IDS`
   * entry, in that order. Side effects: none.
   */
  async contents(actor: ProjectActor, id: string): Promise<SavedDataRow[]> {
    await this.projects.get(actor, id);
    const rows = new Map<SavedDataId, SavedDataRow>(
      SAVED_DATA_IDS.map((k) => [k, { id: k, bytes: 0, items: 0, at: null, sources: [] }]),
    );
    const add = (k: SavedDataId, bytes: number, items: number, at: string | null, source?: string) => {
      const r = rows.get(k)!;
      r.bytes += bytes;
      r.items += items;
      r.at = later(r.at, at);
      if (source && !r.sources.includes(source)) r.sources.push(source);
    };

    const drawings = await sql<{ kind: string; bytes: string; at: Date }>`
      SELECT kind, octet_length(doc::text) AS bytes, updated_at AS at
      FROM project.drawing WHERE project_id = ${id}`.execute(this.db);
    for (const d of drawings.rows)
      add(d.kind === "fleet" ? "vehicles" : "design", num(d.bytes), 1, iso(d.at));

    const results = await sql<{ bytes: string; n: string; at: Date | null }>`
      SELECT coalesce(sum(octet_length(body)), 0) AS bytes, count(*) AS n, max(computed_at) AS at
      FROM project.result WHERE project_id = ${id}`.execute(this.db);
    for (const r of results.rows) add("processed", num(r.bytes), num(r.n), iso(r.at));

    const runs = await sql<{ bytes: string; n: string; at: Date | null }>`
      SELECT coalesce(sum(octet_length(r.network) + octet_length(r.lines)
               + coalesce(octet_length(r.result::text), 0)
               + coalesce((SELECT octet_length(p.data) FROM simulation.run_replay p WHERE p.run_id = r.id), 0)
               + coalesce((SELECT sum(octet_length(f.content)) FROM simulation.run_file f WHERE f.run_id = r.id), 0)
             ), 0) AS bytes,
             count(*) AS n, max(r.finished_at) AS at
      FROM simulation.run r
      WHERE r.project_id = ${id} AND r.finished_at IS NOT NULL`.execute(this.db);
    for (const r of runs.rows) add("runs", num(r.bytes), num(r.n), iso(r.at));

    const comments = await sql<{ bytes: string; n: string; at: Date | null }>`
      SELECT coalesce(sum(octet_length(body)), 0) AS bytes, count(*) AS n,
             max(greatest(created_at, edited_at, resolved_at)) AS at
      FROM collab.comment WHERE project_id = ${id}`.execute(this.db);
    for (const r of comments.rows) add("comments", num(r.bytes), num(r.n), iso(r.at));

    const history = await sql<{ bytes: string; n: string; at: Date | null }>`
      SELECT coalesce(sum(coalesce(octet_length(before::text), 0) + coalesce(octet_length(after::text), 0)
               + coalesce(octet_length(reason), 0)), 0) AS bytes,
             count(*) AS n, max(at) AS at
      FROM audit.record
      WHERE chain = ${projectChain(id)} AND object_type = ${VALUE_OBJECT}
        AND action IN (${VALUE_CHANGED}, ${VALUE_REASON})`.execute(this.db);
    for (const r of history.rows) add("history", num(r.bytes), num(r.n), iso(r.at));

    // The latest finished import of each kind: the OpenStreetMap extract on disk, the elevation tiles.
    const imports = await sql<{ id: string; kind: string; method: string; stats: unknown; at: Date | null }>`
      SELECT DISTINCT ON (kind) id, kind, method, stats, finished_at AS at
      FROM geo.import WHERE project_id = ${id} AND status = 'done'
      ORDER BY kind, finished_at DESC`.execute(this.db);
    for (const i of imports.rows) {
      if (i.kind === "osm") {
        const s = (i.stats ?? {}) as { extractBytes?: unknown };
        if (i.method === "upload") add("uploads", num(s.extractBytes), 1, iso(i.at));
        else add("osm", num(s.extractBytes), 1, iso(i.at), OSM_SOURCES[i.method] ?? "OpenStreetMap");
      }
    }
    const dem = await sql<{ method: string; bytes: string; n: string; at: Date | null }>`
      SELECT i.method, sum(octet_length(t.data)) AS bytes, count(*) AS n, max(i.finished_at) AS at
      FROM geo.dem_tile t JOIN geo.import i ON i.id = t.import_id
      WHERE t.project_id = ${id}
      GROUP BY i.method`.execute(this.db);
    for (const r of dem.rows)
      if (r.method === "geotiff") add("uploads", num(r.bytes), num(r.n), iso(r.at));
      else add("elevation", num(r.bytes), num(r.n), iso(r.at), DEM_SOURCES[r.method] ?? "Copernicus GLO-30");

    // Street tiles and heights the tools fetched live, held once for the instance.
    const shared = await sql<{ kind: string; bytes: string; n: string; at: Date | null }>`
      SELECT s.kind, sum(octet_length(s.body)) AS bytes, count(*) AS n, max(s.data_date) AS at
      FROM project.data_use u JOIN geo.shared_data s ON s.id = u.shared_id
      WHERE u.project_id = ${id}
      GROUP BY s.kind`.execute(this.db);
    for (const r of shared.rows)
      add(
        r.kind === "osm" ? "liveTiles" : "elevation",
        num(r.bytes),
        num(r.n),
        iso(r.at),
        r.kind === "osm" ? "OpenStreetMap" : "Copernicus GLO-30",
      );

    const population = await sql<{ source: string; bytes: string; n: string; at: Date | null }>`
      SELECT l.source,
             coalesce(sum((SELECT sum(pg_column_size(f.geom) + 16) FROM geo.population_feature f
                           WHERE f.layer_id = l.id)), 0) AS bytes,
             count(*) AS n, max(l.updated_at) AS at
      FROM geo.population_layer l
      WHERE l.project_id = ${id} AND l.status = 'ready'
      GROUP BY l.source`.execute(this.db);
    for (const r of population.rows)
      if (r.source === "upload") add("uploads", num(r.bytes), num(r.n), iso(r.at));
      else add("population", num(r.bytes), num(r.n), iso(r.at), POPULATION_SOURCES[r.source] ?? r.source);

    const facts = await sql<{ key: string; bytes: string; at: Date }>`
      SELECT key, octet_length(body) AS bytes, fetched_at AS at
      FROM project.data_cache WHERE project_id = ${id} AND kind = 'facts'`.execute(this.db);
    for (const f of facts.rows) {
      const prefix = Object.keys(FACT_SOURCES).find((p) => f.key.startsWith(p));
      add(factGroup(f.key), num(f.bytes), 1, iso(f.at), prefix ? FACT_SOURCES[prefix] : undefined);
    }

    return SAVED_DATA_IDS.map((k) => rows.get(k)!);
  }
}

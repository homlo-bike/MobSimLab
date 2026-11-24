import { Inject, Injectable, Optional } from "@nestjs/common";
import { sql } from "kysely";
import { DATABASE, type Database } from "../db/database";
import { ProjectDataCache } from "../projects/data-cache";
import { type DemTile, covers, decodeValues, sample } from "./dem-tiles";
import { GeodataService, type ImportRun } from "./geodata.service";
import type { Box } from "./osm-tools";

/**
 * Reads a project's imported OpenStreetMap data and elevation for the features that used to ask Overpass and
 * the GLO-30 bucket directly: street, walk and railway tiles, buildings, places, water, and terrain heights.
 * Each reader answers null when the project has no import covering the request, and the caller then falls back
 * to the live source. Answers are in the shapes the live readers produce: OSM XML cut from the project's
 * extract, or Overpass-style JSON elements built from the `geo.osm_*` tables, so the existing parsers serve both.
 */

/** An Overpass JSON element (`out tags geom` / `out tags center`). */
export interface OverpassLikeElement {
  type: "node" | "way" | "relation";
  id: number;
  tags: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: { type: "way"; role: "outer" | "inner" | ""; geometry: { lat: number; lon: number }[] }[];
}

type Pos = [number, number];
type GeoJson =
  | { type: "Point"; coordinates: Pos }
  | { type: "LineString"; coordinates: Pos[] }
  | { type: "Polygon"; coordinates: Pos[][] }
  | { type: "MultiPolygon"; coordinates: Pos[][][] }
  | { type: "MultiLineString"; coordinates: Pos[][] }
  | { type: "GeometryCollection"; geometries: GeoJson[] };

const TYPE: Record<string, OverpassLikeElement["type"]> = { N: "node", W: "way", R: "relation" };
const geom = (ring: Pos[]) => ring.map(([lon, lat]) => ({ lat, lon }));

/**
 * Purpose: an Overpass-style element from one imported row. A way's polygon becomes its ring; a relation's
 * polygons become outer and inner members; a line becomes the way's geometry; a point a node.
 */
export function toElement(
  osmType: string,
  osmId: string | number,
  tags: Record<string, string> | null,
  g: GeoJson,
  center?: Pos,
): OverpassLikeElement | null {
  const type = TYPE[osmType.trim().toUpperCase()] ?? "way";
  const base = { type, id: Number(osmId), tags: tags ?? {} } as OverpassLikeElement;
  if (center) base.center = { lon: center[0], lat: center[1] };
  switch (g.type) {
    case "Point":
      return { ...base, lon: g.coordinates[0], lat: g.coordinates[1] };
    case "LineString":
      return { ...base, geometry: geom(g.coordinates) };
    case "MultiLineString":
      return { ...base, geometry: geom(g.coordinates.flat()) };
    case "Polygon":
    case "MultiPolygon": {
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      if (type === "way" && polys.length === 1) return { ...base, geometry: geom(polys[0]![0]!) };
      return {
        ...base,
        type: "relation",
        members: polys.flatMap((rings) =>
          rings.map((r, i) => ({
            type: "way" as const,
            role: i === 0 ? ("outer" as const) : ("inner" as const),
            geometry: geom(r),
          })),
        ),
      };
    }
    default:
      return null;
  }
}

/** Purpose: whether box `outer` holds box `inner`. */
export function holds(outer: readonly number[], inner: readonly number[]): boolean {
  return outer[0]! <= inner[0]! && outer[1]! <= inner[1]! && outer[2]! >= inner[2]! && outer[3]! >= inner[3]!;
}

/**
 * Purpose: the part of box `inner` inside box `outer`, or null when they do not overlap. A box that pokes out of
 * the project's import is answered from the import for the part it covers: the import is the planner's chosen
 * data, and a request just past its edge (a margin around a schematic, a street tile at the edge) must not turn
 * into a request to the public Overpass API for the whole box.
 */
export function clipTo(outer: readonly number[], inner: readonly number[]): Box | null {
  const b: Box = [
    Math.max(outer[0]!, inner[0]!),
    Math.max(outer[1]!, inner[1]!),
    Math.min(outer[2]!, inner[2]!),
    Math.min(outer[3]!, inner[3]!),
  ];
  return b[0] < b[2] && b[1] < b[3] ? b : null;
}

/** The ways the live street-network queries ask for, as osmium tag filters (street-network.service.ts). */
export const TILE_FILTERS = {
  road: [
    "w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,unclassified,residential,living_street,service,road,busway,bus_guideway,pedestrian",
    "r/type=restriction",
  ],
  /** A "Main roads and railways only" tile: the street line router's intercity roads (large-area step 3). */
  roadMain: ["w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link", "r/type=restriction"],
  walk: [
    "w/highway=footway,path,pedestrian,steps,living_street,residential,service,unclassified,tertiary,tertiary_link,secondary,secondary_link,primary,primary_link,trunk,trunk_link,track,road,cycleway,bridleway,corridor,platform",
  ],
  rail: [
    "w/railway=rail,light_rail,tram,subway,narrow_gauge,monorail,funicular,construction,disused,preserved",
  ],
} as const;

const TILE_MAX_BYTES = 256 * 1024 * 1024;
const DEM_TILE_CACHE = 64;

interface DemIndexEntry extends Omit<DemTile, "values"> {
  id: string;
  priority: number;
  importId: string;
}

/** Heights at points from imported grids: value per point (undefined where none covers it) and the sources used. */
export interface ImportedHeights {
  values: Array<number | null | undefined>;
  sources: Record<string, unknown>[];
}

@Injectable()
export class GeodataReader {
  private readonly demIndex = new Map<
    string,
    Promise<{ tiles: DemIndexEntry[]; sources: Map<string, Record<string, unknown>> }>
  >();
  private readonly demData = new Map<string, Promise<Float32Array>>();
  private readonly osmRun = new Map<string, Promise<ImportRun | null>>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly imports: GeodataService,
    @Optional() private readonly kept?: ProjectDataCache,
  ) {
    imports.onChange((projectId) => {
      this.demIndex.delete(projectId);
      this.osmRun.delete(projectId);
    });
  }

  /** Purpose: be told when a project's imported data changes (to drop cached answers). */
  onChange(fn: (projectId: string) => void): void {
    this.imports.onChange(fn);
  }

  /**
   * Purpose: the project's current OSM import when it overlaps the box, with the part of the box it covers (all of
   * it when the import holds the box); else null (no import, or the box is wholly outside it).
   */
  private async osmFor(
    projectId: string,
    box: readonly number[],
  ): Promise<{ run: ImportRun; box: Box } | null> {
    let p = this.osmRun.get(projectId);
    if (!p) {
      p = this.imports.current(projectId, "osm");
      p.catch(() => this.osmRun.delete(projectId));
      this.osmRun.set(projectId, p);
    }
    const run = await p;
    if (!run) return null;
    const part = clipTo(run.bbox, box);
    return part ? { run, box: part } : null;
  }

  /** Purpose: whether the project has imported OpenStreetMap data (whatever area it covers). */
  async hasOsm(projectId: string): Promise<boolean> {
    let p = this.osmRun.get(projectId);
    if (!p) {
      p = this.imports.current(projectId, "osm");
      p.catch(() => this.osmRun.delete(projectId));
      this.osmRun.set(projectId, p);
    }
    return !!(await p);
  }

  /**
   * Purpose: OSM XML of one kind of way inside a box, cut from the project's extract, or null when the project's
   * import does not hold the box.
   */
  async tileXml(projectId: string, kind: keyof typeof TILE_FILTERS, wanted: Box): Promise<string | null> {
    const hit = await this.osmFor(projectId, wanted);
    if (!hit) return null;
    const { run, box } = hit;
    // Cutting a tile runs osmium twice over the whole extract (seconds on a city): a tile cut once is kept with
    // the project, by its import, so opening a tool again reads it instead of cutting it again (bug 14).
    const key = `import:${run.id}:${kind}:${box.join(",")}`;
    const kept = await this.kept?.get(projectId, "osm", key);
    if (kept != null) return kept;
    const xml = await this.imports.osmTools.filteredXml(
      this.imports.extractPath(projectId, run.id),
      box,
      [...TILE_FILTERS[kind]],
      TILE_MAX_BYTES,
    );
    await this.kept?.put(projectId, "osm", key, xml);
    return xml;
  }

  /** Purpose: Overpass-style JSON of the buildings in a box (for `footprints` and `crossings`), or null. */
  async buildings(projectId: string, wanted: Box): Promise<string | null> {
    const hit = await this.osmFor(projectId, wanted);
    if (!hit) return null;
    const { run, box } = hit;
    const { rows } = await sql<{ osm_type: string; osm_id: string; tags: Record<string, string>; g: string }>`
      SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom, 7) AS g FROM geo.osm_building
      WHERE import_id = ${run.id} AND geom && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
        AND ST_Intersects(geom, ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326))`.execute(
      this.db,
    );
    return elementsJson(rows.map((r) => toElement(r.osm_type, r.osm_id, r.tags, JSON.parse(r.g) as GeoJson)));
  }

  /**
   * Purpose: Overpass-style JSON (`out tags center`) of the schools, universities, hospitals and clinics in a box,
   * for `places`, or null.
   */
  async places(projectId: string, wanted: Box): Promise<string | null> {
    const hit = await this.osmFor(projectId, wanted);
    if (!hit) return null;
    const { run, box } = hit;
    const { rows } = await sql<{ osm_type: string; osm_id: string; tags: Record<string, string>; c: string }>`
      SELECT osm_type, osm_id, tags, ST_AsGeoJSON(ST_PointOnSurface(geom), 7) AS c FROM geo.osm_poi
      WHERE import_id = ${run.id} AND class IN ('education', 'health')
        AND geom && ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)
        AND ST_Intersects(ST_PointOnSurface(geom), ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326))`.execute(
      this.db,
    );
    return elementsJson(
      rows.map((r) => {
        const c = (JSON.parse(r.c) as { coordinates: Pos }).coordinates;
        const type = TYPE[r.osm_type.trim().toUpperCase()] ?? "way";
        return type === "node"
          ? { type, id: Number(r.osm_id), tags: r.tags ?? {}, lon: c[0], lat: c[1] }
          : { type, id: Number(r.osm_id), tags: r.tags ?? {}, center: { lon: c[0], lat: c[1] } };
      }),
    );
  }

  /**
   * Purpose: Overpass-style JSON (`out tags geom`) of the water in a box, as `waterQuery` asks for it: water areas,
   * river areas, reservoirs, rivers and canals, and the coastline; or null.
   */
  async water(projectId: string, wanted: Box): Promise<string | null> {
    const hit = await this.osmFor(projectId, wanted);
    if (!hit) return null;
    const { run, box } = hit;
    const env = sql`ST_MakeEnvelope(${box[0]}, ${box[1]}, ${box[2]}, ${box[3]}, 4326)`;
    const { rows } = await sql<{ osm_type: string; osm_id: string; tags: Record<string, string>; g: string }>`
      SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom, 7) AS g FROM geo.osm_water
      WHERE import_id = ${run.id} AND geom && ${env} AND ST_Intersects(geom, ${env})
        AND (class IN ('water', 'coastline') OR (class = 'waterway' AND value IN ('river', 'canal', 'riverbank')))
      UNION ALL
      SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom, 7) FROM geo.osm_landuse
      WHERE import_id = ${run.id} AND value = 'reservoir' AND geom && ${env} AND ST_Intersects(geom, ${env})`.execute(
      this.db,
    );
    return elementsJson(rows.map((r) => toElement(r.osm_type, r.osm_id, r.tags, JSON.parse(r.g) as GeoJson)));
  }

  /**
   * Purpose: heights at points from the project's imported grids (the planner's own grid first, then GLO-30).
   * Output: per point a height, null (covered but no data), or undefined (no imported grid there); and the
   * Source records of the grids used.
   */
  async heights(projectId: string, points: Pos[]): Promise<ImportedHeights> {
    const idx = await this.loadDemIndex(projectId);
    const values: ImportedHeights["values"] = new Array(points.length).fill(undefined);
    const used = new Set<string>();
    if (!idx.tiles.length) return { values, sources: [] };
    for (const [i, [lon, lat]] of points.entries()) {
      for (const t of idx.tiles) {
        if (!covers(t, lon, lat)) continue;
        const v = sample({ ...t, values: await this.tileValues(t) }, lon, lat);
        values[i] = v;
        used.add(t.importId);
        if (v !== null) break;
      }
    }
    return { values, sources: [...used].map((id) => idx.sources.get(id)!).filter(Boolean) };
  }

  private loadDemIndex(projectId: string) {
    let p = this.demIndex.get(projectId);
    if (!p) {
      p = (async () => {
        const { rows } = await sql<{
          id: string;
          priority: number;
          import_id: string;
          width: number;
          height: number;
          origin_lon: number;
          origin_lat: number;
          step_lon: number;
          step_lat: number;
          source: Record<string, unknown>;
        }>`
          SELECT t.id::text AS id, t.priority, t.import_id, t.width, t.height, t.origin_lon, t.origin_lat,
                 t.step_lon, t.step_lat, i.source
          FROM geo.dem_tile t JOIN geo.import i ON i.id = t.import_id
          WHERE t.project_id = ${projectId} AND i.status = 'done'
          ORDER BY t.priority DESC, t.id`.execute(this.db);
        const sources = new Map<string, Record<string, unknown>>();
        for (const r of rows) sources.set(r.import_id, r.source);
        return {
          tiles: rows.map((r) => ({
            id: r.id,
            priority: r.priority,
            importId: r.import_id,
            width: r.width,
            height: r.height,
            originLon: r.origin_lon,
            originLat: r.origin_lat,
            stepLon: r.step_lon,
            stepLat: r.step_lat,
          })),
          sources,
        };
      })();
      p.catch(() => this.demIndex.delete(projectId));
      this.demIndex.set(projectId, p);
    }
    return p;
  }

  private tileValues(t: DemIndexEntry): Promise<Float32Array> {
    let p = this.demData.get(t.id);
    if (p) {
      this.demData.delete(t.id);
      this.demData.set(t.id, p);
      return p;
    }
    p = sql<{ data: Buffer }>`SELECT data FROM geo.dem_tile WHERE id = ${t.id}`
      .execute(this.db)
      .then(({ rows }) => {
        if (!rows[0]) throw new Error("DEM tile was removed");
        return decodeValues(rows[0].data, t.width, t.height);
      });
    p.catch(() => this.demData.delete(t.id));
    this.demData.set(t.id, p);
    while (this.demData.size > DEM_TILE_CACHE)
      this.demData.delete(this.demData.keys().next().value as string);
    return p;
  }
}

function elementsJson(els: Array<OverpassLikeElement | null>): string {
  return JSON.stringify({ elements: els.filter((e): e is OverpassLikeElement => e !== null) });
}

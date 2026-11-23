import { BadRequestException, HttpException, Inject, Injectable } from "@nestjs/common";
import { BenefitsService } from "../benefits/benefits.service";
import { DATABASE, type Database } from "../db/database";
import { COUNTRY_SOURCE, EconomyService } from "../economy/economy.service";
import { CELL_DEG } from "../gateway/worldpop.client";
import { OverpassError } from "../gateway/overpass.client";
import { PopulationService, MAX_SIDE_DEG, type PopulationAnswer } from "../population/population.service";
import { areaTiles } from "../projects/area-polygons";
import { type Bbox, projectArea } from "../projects/project-area";
import { StreetNetworkService, TILE_ZOOM } from "../street-network/street-network.service";
import { MAX_WATER_SPAN_DEG } from "../street-network/water";
import { MAP_FILES, type MapAreaFile, type MapTileKind } from "./format.mts";

/** Most zoom-14 tiles the map data of one file may cover (each kind is one file per tile). */
export const MAX_MAP_TILES = 400;
/** Largest map data a file may carry, uncompressed, so that it still opens (format.mts MSLAB_ZIP_LIMITS). */
export const MAX_MAP_BYTES = 300 * 1024 * 1024;
/** Tiles fetched at once from the street network service (each uncached tile is an Overpass request). */
const PARALLEL = 4;
/** How long to wait for a population grid that is still downloading to the server. */
const POPULATION_WAIT_MS = 60_000;
/** The price base year of the unit costs (web: library value `cost.price_base_year`). */
const PRICE_BASE_YEARS = [2023];

/** Purpose: the zoom-14 tiles covering a box, as [x, y]. */
export function tilesOf(b: Bbox, z = TILE_ZOOM): [number, number][] {
  const n = 2 ** z;
  const tx = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const ty = (lat: number) => {
    const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  };
  const out: [number, number][] = [];
  for (let y = ty(b[3]); y <= ty(b[1]); y++) for (let x = tx(b[0]); x <= tx(b[2]); x++) out.push([x, y]);
  return out;
}

/** Purpose: a box cut into boxes of at most `side` degrees, on multiples of `cell`. */
export function chunks(b: Bbox, side: number, cell: number): Bbox[] {
  const snap = (v: number, f: (x: number) => number) => f(v / cell) * cell;
  const [w, s, e, n] = [
    snap(b[0], Math.floor),
    snap(b[1], Math.floor),
    snap(b[2], Math.ceil),
    snap(b[3], Math.ceil),
  ];
  const step = Math.floor(side / cell) * cell;
  const out: Bbox[] = [];
  for (let y = s; y < n - cell / 2; y += step)
    for (let x = w; x < e - cell / 2; x += step)
      out.push([x, y, Math.min(e, x + step), Math.min(n, y + step)]);
  return out;
}

/** What the map data of a project needs: its drawings by kind and the plugins switched on. */
export interface MapDataInput {
  projectId: string;
  docs: Record<string, unknown>;
  plugins: { id: string; enabled: boolean }[];
}

/** What went into the file, for the manifest, the attribution and the audit record. */
export interface MapDataSummary {
  tiles: number;
  kinds: MapTileKind[];
  population: string | null;
  bytes: number;
}

/**
 * The map data a `.mslab` file may carry for the static viewer (`map/`, format 1.1): the OpenStreetMap tiles of
 * the project area as the street network API serves them, the water of the area, the population grid and the
 * country figures the cost and benefit tables read. A MobSimLab that opens the file ignores them and loads its
 * own; the static viewer (apps/web, `pnpm build:static`) serves them in place of the API.
 */
@Injectable()
export class MslabMapService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly streets: StreetNetworkService,
    private readonly population: PopulationService,
    private readonly economy: EconomyService,
    private readonly benefits: BenefitsService,
  ) {}

  /**
   * Purpose: the map data files of a project, path → bytes. 400 when nothing is drawn or the area is too large;
   * 502/504 when OpenStreetMap cannot be reached for a tile that is not cached.
   */
  async files(input: MapDataInput): Promise<{ files: [string, Buffer][]; summary: MapDataSummary }> {
    const area = await projectArea(this.db, input.projectId);
    if (!area)
      throw new BadRequestException("draw something in the project first: map data covers the project area");
    // The tiles touching the project area's polygons, not the box round them.
    const tiles: [number, number][] = areaTiles(area.polygons, TILE_ZOOM).map((t) => [t.x, t.y]);
    if (tiles.length > MAX_MAP_TILES)
      throw new BadRequestException(
        `the project area takes ${tiles.length} map tiles, more than the ${MAX_MAP_TILES} a file may carry; make the project area smaller or save without map data`,
      );
    const on = (id: string) => input.plugins.some((p) => p.id === id && p.enabled);
    const kinds: MapTileKind[] = ["streets", "walk", "buildings", "places"];
    if (input.docs.railway) kinds.push("rail");
    if (on("cargo-bike")) kinds.push("bike-amenities");

    const files: [string, Buffer][] = [];
    let bytes = 0;
    const add = (name: string, body: string) => {
      const b = Buffer.from(body, "utf8");
      bytes += b.length;
      if (bytes > MAX_MAP_BYTES)
        throw new BadRequestException(
          `the map data of the project area is larger than ${MAX_MAP_BYTES / 1024 / 1024} MB; make the project area smaller or save without map data`,
        );
      files.push([name, b]);
    };

    // With the project named, tiles come from its OpenStreetMap import where it has one (Map data), as in the
    // editors, and only the rest from Overpass.
    const pid = input.projectId;
    const fetchTile = (kind: MapTileKind, x: number, y: number): Promise<string> => {
      switch (kind) {
        case "streets":
          return this.streets.tile(x, y, pid);
        case "walk":
          return this.streets.walkTile(x, y, pid);
        case "rail":
          return this.streets.railTile(x, y, pid);
        case "buildings":
          return this.streets.buildingTile(x, y, pid);
        case "places":
          return this.streets.placeTile(x, y, pid);
        case "bike-amenities":
          return this.streets.bikeAmenityTile(x, y);
      }
    };
    const jobs = kinds.flatMap((kind) => tiles.map(([x, y]) => ({ kind, x, y })));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++]!;
        const body = await osm(() => fetchTile(j.kind, j.x, j.y));
        add(MAP_FILES.tile(j.kind, j.x, j.y), body);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    // Same order every time, whatever order the tiles arrived in.
    files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    // Water of the area (the Schematic tab's network map), at most 1° a side round the area's centre.
    add(MAP_FILES.water, await osm(() => this.streets.water(waterBox(area.bbox), pid)));

    // People per cell over the area, from the project's primary layer or WorldPop.
    const population = await this.populationGrid(input.projectId, area.bbox);
    if (population) add(MAP_FILES.population, JSON.stringify(population));

    // Country figures for the cost and benefit tables, keyed by the API path the browser asks for.
    add(MAP_FILES.reference, JSON.stringify(await this.reference(input.projectId, area.bbox, input.docs)));

    const areaFile: MapAreaFile = {
      bbox: area.bbox,
      zoom: TILE_ZOOM,
      kinds,
      tiles,
    };
    add(MAP_FILES.area, JSON.stringify(areaFile));
    return {
      files,
      summary: {
        tiles: tiles.length,
        kinds,
        population: population?.source ?? null,
        bytes,
      },
    };
  }

  /** Purpose: the population grids over the area, in chunks the population service answers; null when none is ready. */
  private async populationGrid(
    projectId: string,
    bbox: Bbox,
  ): Promise<{
    grids: Extract<PopulationAnswer, { status: "ready" }>["grid"][];
    source: string;
    info: unknown;
  } | null> {
    const grids: Extract<PopulationAnswer, { status: "ready" }>["grid"][] = [];
    let info: unknown = null;
    let source = "";
    for (const box of chunks(bbox, MAX_SIDE_DEG * 0.99, CELL_DEG)) {
      let a: PopulationAnswer;
      try {
        a = await this.population.gridFor(box, projectId, POPULATION_WAIT_MS);
      } catch {
        return null;
      }
      if (a.status !== "ready") return null;
      grids.push(a.grid);
      info = a.source;
      source = a.source.name;
    }
    return grids.length ? { grids, source, info } : null;
  }

  /**
   * Purpose: the answers of the economy and benefit APIs the tables ask for, by request path: the country at
   * the area's centre, the country list, and the price and benefit figures of that country and of the
   * country the cost tables were set to. Figures that cannot be loaded are left out; the tables then say so.
   */
  private async reference(
    projectId: string,
    bbox: Bbox,
    docs: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    // Every fact the project kept (country, holidays, climate, price levels, GDP…), by its key
    // (projects/data-cache.ts `factKey`), for the viewer to answer the same questions the same way.
    const kept = await this.db
      .selectFrom("project.data_cache")
      .select(["key", "body"])
      .where("project_id", "=", projectId)
      .where("kind", "=", "facts")
      .execute()
      .catch(() => []);
    const facts: Record<string, unknown> = {};
    for (const f of kept)
      try {
        facts[f.key] = JSON.parse(f.body);
      } catch {
        // Not JSON: left out.
      }
    if (kept.length) out[FACTS_KEY] = facts;
    const tryAdd = async (path: string, f: () => Promise<unknown>) => {
      try {
        out[path] = await f();
      } catch {
        // Not available right now: the viewer's tables show what they show without it.
      }
    };
    const lon = (bbox[0] + bbox[2]) / 2;
    const lat = (bbox[1] + bbox[3]) / 2;
    let iso3: string | null = null;
    await tryAdd("/api/economy/country-at", async () => {
      const c = await this.economy.countryAt(lon, lat);
      iso3 = c.iso3;
      return { ...c, source: COUNTRY_SOURCE };
    });
    await tryAdd("/api/economy/countries", async () => ({ countries: await this.economy.countries() }));
    const codes = new Set<string>();
    if (iso3) codes.add(iso3);
    const chosen = costsCountry(docs.costs);
    if (chosen) codes.add(chosen);
    for (const code of codes) {
      for (const base of PRICE_BASE_YEARS)
        await tryAdd(`/api/economy/indicators?code=${code}&base=${base}`, () =>
          this.economy.economy(code, base),
        );
      await tryAdd(`/api/benefits/indicators?code=${code}`, () => this.benefits.indicators(code));
    }
    return out;
  }
}

/** Key of `map/reference.json` holding the project's kept facts by fact key (static viewer, shim.ts). */
export const FACTS_KEY = "@facts";

/** Purpose: the country the cost tables convert to when the planner chose one (Tables tab), else null. */
function costsCountry(costs: unknown): string | null {
  const c = (costs as { country?: unknown } | null | undefined)?.country;
  return typeof c === "string" && /^[A-Za-z]{2,3}$/.test(c) ? c : null;
}

/** Purpose: the area as a water box, at most MAX_WATER_SPAN_DEG a side round its centre, on 0.01° steps. */
function waterBox(b: Bbox): Bbox {
  const half = MAX_WATER_SPAN_DEG / 2 - 0.01;
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const w = Math.max(b[0], cx - half);
  const e = Math.min(b[2], cx + half);
  const s = Math.max(b[1], cy - half);
  const n = Math.min(b[3], cy + half);
  const down = (x: number) => Math.floor(x * 100) / 100;
  const up = (x: number) => Math.ceil(x * 100) / 100;
  return [down(w), down(s), up(e), up(n)];
}

/** Purpose: run an OpenStreetMap request, turning an Overpass failure into a plain HTTP error. */
async function osm<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof OverpassError)
      throw new HttpException(
        "OpenStreetMap is unavailable right now, so the map data cannot be saved; try again",
        e.status,
      );
    throw e;
  }
}

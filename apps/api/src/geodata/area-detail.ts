import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../db/database";
import { type AreaDetail, areaTiles } from "../projects/area-polygons";
import { projectArea } from "../projects/project-area";

const TTL_MS = 60_000;

/** A project's zoom-14 tiles (`x/y` keys) by detail; `main` is null when the project has no main polygon. */
export interface AreaTileDetails {
  main: Set<string> | null;
  full: Set<string>;
}
const MAX_PROJECTS = 200;

/**
 * The detail each zoom-14 tile of a project's area is held at (large-area projects, step 3): a tile touching a
 * Full polygon is full, a tile touching only "Main roads and railways only" polygons is main, and a tile outside
 * every polygon has none. The street services answer main tiles with light data. Remembered for a minute per
 * project; saving the area forgets it at once.
 */
@Injectable()
export class AreaDetailService {
  private readonly cache = new Map<string, { until: number } & AreaTileDetails>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Purpose: whether tile x/y (zoom 14) of a project is held at "main" detail only.
   * Inputs: project id (read access checked by the caller), tile. Output: true only for a tile that touches a
   * main polygon and no Full polygon; false without a project, outside the area or in a Full polygon.
   */
  async isMain(projectId: string | undefined, x: number, y: number): Promise<boolean> {
    if (!projectId) return false;
    return (await this.mainTiles(projectId))?.has(`${x}/${y}`) ?? false;
  }

  /** Purpose: the keys `x/y` of a project's main-only tiles, or null when it has no main polygon. */
  async mainTiles(projectId: string): Promise<Set<string> | null> {
    return (await this.tiles(projectId)).main;
  }

  /**
   * Purpose: the keys `x/y` of a project's tiles by detail: `main` as `mainTiles`, and `full` the tiles touching
   * a Full polygon, listed only when the project has a main polygon (empty otherwise).
   */
  async tiles(projectId: string): Promise<AreaTileDetails> {
    const hit = this.cache.get(projectId);
    if (hit && hit.until > Date.now()) return { main: hit.main, full: hit.full };
    const area = await projectArea(this.db, projectId);
    let details: AreaTileDetails = { main: null, full: new Set() };
    if (area && area.polygons.some((p) => p.detail === "main")) {
      const all = areaTiles(area.polygons, 14);
      const keys = (d: AreaDetail) => new Set(all.filter((t) => t.detail === d).map((t) => `${t.x}/${t.y}`));
      details = { main: keys("main"), full: keys("full") };
    }
    if (this.cache.size > MAX_PROJECTS) this.cache.clear();
    this.cache.set(projectId, { until: Date.now() + TTL_MS, ...details });
    return details;
  }

  /** Purpose: forget a project's tiles after its area changed. */
  forget(projectId: string): void {
    this.cache.delete(projectId);
  }
}

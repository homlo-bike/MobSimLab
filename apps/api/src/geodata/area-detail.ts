import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../db/database";
import { type AreaDetail, areaTiles } from "../projects/area-polygons";
import { projectArea } from "../projects/project-area";

const TTL_MS = 60_000;
const MAX_PROJECTS = 200;

/**
 * The detail each zoom-14 tile of a project's area is held at (large-area projects, step 3): a tile touching a
 * Full polygon is full, a tile touching only "Main roads and railways only" polygons is main, and a tile outside
 * every polygon has none. The street services answer main tiles with light data. Remembered for a minute per
 * project; saving the area forgets it at once.
 */
@Injectable()
export class AreaDetailService {
  private readonly cache = new Map<string, { until: number; main: Set<string> | null }>();

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
    const hit = this.cache.get(projectId);
    if (hit && hit.until > Date.now()) return hit.main;
    const area = await projectArea(this.db, projectId);
    const main =
      area && area.polygons.some((p) => p.detail === "main")
        ? new Set(
            areaTiles(area.polygons, 14)
              .filter((t) => t.detail === ("main" satisfies AreaDetail))
              .map((t) => `${t.x}/${t.y}`),
          )
        : null;
    if (this.cache.size > MAX_PROJECTS) this.cache.clear();
    this.cache.set(projectId, { until: Date.now() + TTL_MS, main });
    return main;
  }

  /** Purpose: forget a project's tiles after its area changed. */
  forget(projectId: string): void {
    this.cache.delete(projectId);
  }
}

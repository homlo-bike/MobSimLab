import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { MslRequest } from "../auth/session.service";
import { DATABASE, type Database } from "../db/database";
import { type ProjectSharedKind, SharedDataStore } from "../geodata/shared-data";

/** What a project's data cache holds: OpenStreetMap tiles, terrain heights, location facts. */
export type CacheKind = "osm" | "height" | "facts";

/** Where an answer came from, for the tools to say so: the project's import, its cache, or live. */
export type DataSource = "import" | "cache" | "live";

/** Most keys read or written in one statement. */
const BATCH = 500;

/** Whether a kind is held once for the instance (geodata/shared-data.ts) rather than per project. */
const isShared = (kind: CacheKind): kind is ProjectSharedKind => kind === "osm" || kind === "height";

/**
 * Data a project's tools fetched live because the project's imports did not hold it (#140 step 4): a street
 * tile outside the OpenStreetMap import, a terrain height outside the elevation import, or a location fact
 * (country, holidays, climate; step 3), served to every tool next time, so nothing is downloaded twice. Tiles and
 * heights are held once for the instance and the project points at them (large-area projects, step 4;
 * geodata/shared-data.ts), so another project in the same area takes them too; facts are kept per project
 * (`project.data_cache`, removed with the project). A failing cache never fails a tool: reads then miss and
 * writes are skipped.
 */
@Injectable()
export class ProjectDataCache {
  private readonly shared: SharedDataStore;

  constructor(
    @Optional() @Inject(DATABASE) private readonly db?: Database,
    @Optional() shared?: SharedDataStore,
  ) {
    this.shared = shared ?? new SharedDataStore(db);
  }

  /** Purpose: one cached answer, or null. */
  async get(projectId: string, kind: CacheKind, key: string): Promise<string | null> {
    return (await this.getMany(projectId, kind, [key])).get(key) ?? null;
  }

  /** Purpose: the cached answers among `keys`, by key. */
  async getMany(projectId: string, kind: CacheKind, keys: readonly string[]): Promise<Map<string, string>> {
    if (isShared(kind)) {
      const store = this.shared;
      // The copies the project used, then the copies the instance holds for the rest.
      const out = await store.used(projectId, kind, keys);
      const rest = keys.filter((k) => !out.has(k));
      for (const [k, v] of await store.adopt(projectId, kind, rest)) out.set(k, v);
      return out;
    }
    const out = new Map<string, string>();
    if (!this.db || keys.length === 0) return out;
    try {
      for (let i = 0; i < keys.length; i += BATCH) {
        const rows = await this.db
          .selectFrom("project.data_cache")
          .select(["key", "body"])
          .where("project_id", "=", projectId)
          .where("kind", "=", kind)
          .where("key", "in", keys.slice(i, i + BATCH))
          .execute();
        for (const r of rows) out.set(r.key, r.body);
      }
    } catch {
      // A cache that cannot be read is a miss.
    }
    return out;
  }

  /** Purpose: keep an answer for the project (replacing an older one). */
  async put(projectId: string, kind: CacheKind, key: string, body: string): Promise<void> {
    await this.putMany(projectId, kind, [[key, body]]);
  }

  /** Purpose: keep several answers for the project. */
  async putMany(projectId: string, kind: CacheKind, entries: readonly [string, string][]): Promise<void> {
    if (isShared(kind)) return this.shared.keep(projectId, kind, entries);
    if (!this.db || entries.length === 0) return;
    try {
      for (let i = 0; i < entries.length; i += BATCH) {
        await this.db
          .insertInto("project.data_cache")
          .values(
            entries.slice(i, i + BATCH).map(([key, body]) => ({ project_id: projectId, kind, key, body })),
          )
          .onConflict((oc) =>
            oc.columns(["project_id", "kind", "key"]).doUpdateSet((eb) => ({
              body: eb.ref("excluded.body"),
              fetched_at: new Date(),
            })),
          )
          .execute();
      }
    } catch {
      // Not kept this time; the tool fetches it again next time.
    }
  }

  /**
   * Purpose: a cached answer, else `fetch` it live and keep it for the project. Without a project, fetches.
   * Output: the answer and where it came from.
   */
  async through(
    projectId: string | undefined,
    kind: CacheKind,
    key: string,
    fetch: () => Promise<string>,
  ): Promise<{ body: string; source: DataSource }> {
    if (projectId) {
      const hit = await this.get(projectId, kind, key);
      if (hit !== null) return { body: hit, source: "cache" };
    }
    const body = await fetch();
    if (projectId) await this.put(projectId, kind, key, body);
    return { body, source: "live" };
  }
}

/** Keys of the location facts, shared by the endpoints that read them through and the area's look-up. */
export const factKey = {
  countryAt: (lon: number, lat: number) => `country-at/${lon.toFixed(4)},${lat.toFixed(4)}`,
  holidays: (country: string, year: number) => `holidays/${country.toUpperCase()}/${year}`,
  climate: (lat: number, lon: number) => `climate/${lat.toFixed(1)},${lon.toFixed(1)}`,
  /** The countries of the project area with their shares (projects/area.service.ts `AreaCountries`). */
  areaCountries: "area-countries",
  /** The countries the World Bank has data for (cost tables). */
  economyCountries: "economy-countries",
  /** A country's price level, exchange rate and currency and the US GDP deflator (cost tables). */
  economy: (code: string, base: number) => `economy/${code.toUpperCase()}/${base}`,
  /** A country's GDP per capita, employment, age shares and population (benefit tables). */
  benefitIndicators: (code: string) => `benefit-indicators/${code.toUpperCase()}`,
  /** The OpenStreetMap areas around a point (regions, project area picker). */
  osmAreas: (lon: number, lat: number, wide: boolean) =>
    `osm-areas/${lon.toFixed(6)},${lat.toFixed(6)}${wide ? "/wide" : ""}`,
  /** The shared-bike stations a GBFS feed listed when it was last read (demand runs); the feed by its hash. */
  gbfs: (url: string) => `gbfs/${createHash("sha256").update(url).digest("hex").slice(0, 32)}`,
  /** The GEBCO water depth at a point (ferry route checks), to about 10 m; the grid's cells are about 450 m. */
  depth: (lon: number, lat: number) => `depth/${lon.toFixed(4)},${lat.toFixed(4)}`,
};

/** Who may read a project's kept facts: the project gate (`?project=`) as the endpoints use it. */
interface FactGate {
  readable(req: MslRequest, project: unknown): Promise<string | undefined>;
}

/**
 * Purpose: an answer kept for the project named by `?project=` (read once from the provider, then from the
 * project), else fetched live. Without a project, the gate or the cache, fetches live.
 */
export async function keptFact<T>(
  gate: FactGate | undefined,
  kept: ProjectDataCache | undefined,
  req: MslRequest,
  project: string | undefined,
  key: string,
  live: () => Promise<T>,
): Promise<T> {
  const projectId = await gate?.readable(req, project);
  if (!projectId || !kept) return live();
  const r = await kept.through(projectId, "facts", key, async () => JSON.stringify(await live()));
  return JSON.parse(r.body) as T;
}

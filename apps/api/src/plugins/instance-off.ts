import type { Database } from "../db/database";

/** How long a tile request may use the list read for an earlier one; turning a plugin off clears it at once. */
const CACHE_MS = 5_000;
const cache = new WeakMap<Database, { off: Set<string>; at: number }>();

/**
 * Purpose: the plugins an Admin turned off for the whole instance (Administration → Plugins), by id. Cached
 * briefly per database, since every basemap tile asks.
 */
export async function pluginsOff(db: Database, fresh = false): Promise<Set<string>> {
  const hit = cache.get(db);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.off;
  const r = await db.selectFrom("iam.instance").select("plugins_off").executeTakeFirst();
  const off = new Set(r?.plugins_off ?? []);
  cache.set(db, { off, at: Date.now() });
  return off;
}

/** Purpose: forget the cached list, after an Admin turned a plugin on or off. */
export function forgetPluginsOff(db: Database): void {
  cache.delete(db);
}

export const ESRI_PLUGIN = "org.mobsimlab.esri-imagery";
export const OGC_PLUGIN = "org.mobsimlab.ogc-layers";

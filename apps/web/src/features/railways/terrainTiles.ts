/**
 * Terrain heights for the rail engine (ADR-0033 decision 18): the tiles a build needs, fetched from the
 * shared terrain source. Every place that plans trains on the drawn railway loads them all first, because
 * gradients slow trains or stall them; planning on flat ground instead would show trips that cannot run.
 */
import { fetchElevations } from "../../terrain/terrain";
import { tNow } from "../../i18n/i18n";
import type { LonLat, Network, RailEngine, RailView } from "./types";

/** Terrain tiles fetched in one request (1,089 points each; the API takes up to 20,000). */
const TERRAIN_TILES_PER_REQUEST = 18;
/** Rebuilds over new tiles at most: a profile now known can reach tiles the build did not need before. */
const MAX_PASSES = 8;

/** Ground heights at points, m (null without data). */
export type HeightsFetcher = (points: LonLat[]) => Promise<(number | null)[]>;

/** Purpose: ground heights at points from the shared terrain source (Copernicus GLO-30). */
export const fetchTerrainHeights: HeightsFetcher = (points) =>
  fetchElevations(points).then((r) => r.elevationsM);

/**
 * Purpose: fetch the heights of terrain tiles from the terrain source and add them to the engine.
 * Output: how many tiles were added, and why some did not load (null when all did).
 */
export async function loadTerrainTiles(
  e: RailEngine,
  tiles: [number, number][],
  fetchHeights: HeightsFetcher,
): Promise<{ added: number; failed: string | null }> {
  const batches: [number, number][][] = [];
  for (let i = 0; i < tiles.length; i += TERRAIN_TILES_PER_REQUEST)
    batches.push(tiles.slice(i, i + TERRAIN_TILES_PER_REQUEST));
  const res = await Promise.allSettled(
    batches.map(async (b) => {
      const pts = b.map(([x, y]) => e.terrainTilePoints!(x, y));
      const heights = await fetchHeights(pts.flat());
      let k = 0;
      return b.map(([x, y], i) => {
        const h = heights.slice(k, k + pts[i]!.length);
        k += pts[i]!.length;
        return { x, y, h };
      });
    }),
  );
  let added = 0;
  let failed: string | null = null;
  for (const r of res) {
    if (r.status === "rejected") {
      failed ??= r.reason instanceof Error ? r.reason.message : "Terrain heights did not load.";
      continue;
    }
    for (const t of r.value) {
      e.addTerrainTile!(t.x, t.y, t.h);
      added++;
    }
  }
  return { added, failed };
}

/**
 * Purpose: load every terrain tile the engine's last build needs, rebuilding after each batch, so that
 * trains planned on the next build climb the real gradients.
 * Inputs: the engine after a build; `rebuild` builds the drawing again; the height source.
 * Output: why the heights did not load (null when they all did, or the engine takes no terrain) and how
 * many tiles were added. Side effects: fetches heights; adds tiles to the engine; rebuilds.
 */
export async function loadAllTerrain(
  e: RailEngine,
  rebuild: () => void,
  fetchHeights: HeightsFetcher,
): Promise<{ failed: string | null; added: number }> {
  if (!e.missingTerrainTiles || !e.terrainTilePoints || !e.addTerrainTile) return { failed: null, added: 0 };
  let added = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const want = e.missingTerrainTiles();
    if (!want.length) break;
    const r = await loadTerrainTiles(e, want, fetchHeights);
    if (r.added) {
      added += r.added;
      rebuild();
    }
    if (r.failed || !r.added) return { failed: r.failed ?? "Terrain heights did not load.", added };
  }
  return { failed: null, added };
}

/**
 * Purpose: build a railway with every terrain height it needs, before trains are planned on it.
 * Output: the view of the build with heights. Throws, with the reason in the app language, when the heights
 * did not load, so no view plans trains as if the line were flat.
 * Side effects: builds with the engine; fetches heights.
 */
export async function buildWithTerrain(
  engine: RailEngine,
  railway: Network,
  fetchHeights: HeightsFetcher = fetchTerrainHeights,
): Promise<RailView> {
  let view = engine.build(railway, null);
  const { failed } = await loadAllTerrain(engine, () => (view = engine.build(railway, null)), fetchHeights);
  if (failed) throw new Error(tNow("rail.terrainRequired", { reason: failed }));
  return view;
}

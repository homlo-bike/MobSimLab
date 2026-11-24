import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { fetchElevations } from "../../terrain/terrain";
import type { LonLat, RailEngine, RailView, Track } from "./types";

/** Terrain tiles fetched in one request (1,089 points each; the API takes up to 20,000). */
const TERRAIN_TILES_PER_REQUEST = 18;
/** Terrain tiles fetched after one build at most; the rebuild asks for the rest. */
const TERRAIN_TILES_PER_PASS = 72;

/** Purpose: ground heights at points from the shared terrain source (Copernicus GLO-30). */
export const fetchTerrainHeights = (points: LonLat[]) => fetchElevations(points).then((r) => r.elevationsM);

/**
 * Purpose: terrain heights under the tracks and stations (ADR-0033 decision 18): after a build, the
 * tiles it still needs are fetched from the shared terrain source, and one rebuild follows each batch.
 * Output: why heights did not load (null when they did), `retry`, which asks again for the missing tiles, and
 * `loadAllTerrain`, which loads every tile still missing (before a publish).
 * Side effects: bumps `setStreets` after each batch.
 */
export function useTerrainHeights({
  engine,
  view,
  draft,
  fetchHeights,
  setStreets,
}: {
  engine: MutableRefObject<RailEngine | null>;
  view: RailView | null;
  draft: Track | null;
  fetchHeights: (points: LonLat[]) => Promise<(number | null)[]>;
  setStreets: Dispatch<SetStateAction<number>>;
}) {
  const terrainBusy = useRef(false);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const e = engine.current;
    if (!view || !e?.missingTerrainTiles || !e.terrainTilePoints || !e.addTerrainTile || draft) return;
    const timer = setTimeout(() => {
      if (terrainBusy.current || engine.current !== e) return;
      const want = e.missingTerrainTiles!().slice(0, TERRAIN_TILES_PER_PASS);
      if (!want.length) return;
      terrainBusy.current = true;
      void loadTerrainTiles(e, want, fetchHeights).then(({ added, failed }) => {
        terrainBusy.current = false;
        if (engine.current !== e) return;
        setTerrainError(failed);
        if (added) setStreets((n) => n + 1);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [view, draft, fetchHeights, attempt]);

  /**
   * Purpose: load every terrain tile the drawing needs before a timetable is planned on it, so that the
   * trains climb the real gradients (a publish made before the heights arrived ran on flat ground).
   * Input: `rebuild` builds the drawing again, which gives the tracks their profiles over the new tiles.
   * Output: why the heights did not load (null when they all did, or the engine takes no terrain).
   * Side effects: adds the tiles to the engine and rebuilds; bumps `setStreets` when tiles were added.
   */
  const loadAllTerrain = async (e: RailEngine, rebuild: () => void): Promise<string | null> => {
    if (!e.missingTerrainTiles || !e.terrainTilePoints || !e.addTerrainTile) return null;
    let addedAny = false;
    let failed: string | null = null;
    // A rebuild over new tiles can reach tiles it did not need before (a profile now known); a few passes cover it.
    for (let pass = 0; pass < 8; pass++) {
      const want = e.missingTerrainTiles();
      if (!want.length) break;
      const r = await loadTerrainTiles(e, want, fetchHeights);
      if (r.added) {
        addedAny = true;
        rebuild();
      }
      if (r.failed || !r.added) {
        failed = r.failed ?? "Terrain heights did not load.";
        break;
      }
    }
    if (engine.current === e) {
      setTerrainError(failed);
      if (addedAny) setStreets((n) => n + 1);
    }
    return failed;
  };

  return { terrainError, retryTerrain: () => setAttempt((n) => n + 1), loadAllTerrain };
}

/**
 * Purpose: fetch the heights of terrain tiles from the terrain source and add them to the engine.
 * Output: how many tiles were added, and why some did not load (null when all did).
 */
async function loadTerrainTiles(
  e: RailEngine,
  tiles: [number, number][],
  fetchHeights: (points: LonLat[]) => Promise<(number | null)[]>,
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

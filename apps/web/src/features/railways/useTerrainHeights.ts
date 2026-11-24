import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadAllTerrain as loadAll, loadTerrainTiles } from "./terrainTiles";
import type { LonLat, RailEngine, RailView, Track } from "./types";

export { fetchTerrainHeights } from "./terrainTiles";

/** Terrain tiles fetched after one build at most; the rebuild asks for the rest. */
const TERRAIN_TILES_PER_PASS = 72;

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
    const { failed, added } = await loadAll(e, rebuild, fetchHeights);
    if (engine.current === e) {
      setTerrainError(failed);
      if (added) setStreets((n) => n + 1);
    }
    return failed;
  };

  return { terrainError, retryTerrain: () => setAttempt((n) => n + 1), loadAllTerrain };
}

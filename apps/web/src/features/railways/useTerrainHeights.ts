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
 * Output: why heights did not load (null when they did) and `retry`, which asks again for the missing tiles.
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
      const batches: [number, number][][] = [];
      for (let i = 0; i < want.length; i += TERRAIN_TILES_PER_REQUEST)
        batches.push(want.slice(i, i + TERRAIN_TILES_PER_REQUEST));
      void Promise.allSettled(
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
      ).then((res) => {
        terrainBusy.current = false;
        if (engine.current !== e) return;
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
        setTerrainError(failed);
        if (added) setStreets((n) => n + 1);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [view, draft, fetchHeights, attempt]);
  return { terrainError, retryTerrain: () => setAttempt((n) => n + 1) };
}

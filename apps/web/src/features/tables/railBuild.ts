import { useEffect, useState } from "react";
import { fetchElevations } from "../../terrain/terrain";
import { loadRailEngine, nextTask } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type { Timetable } from "../journey-planner/types";
import type { LineReport, LonLat, Network, RailEngine, RailEngineLoader, RailView } from "../railways/types";
import { engineErrorText } from "../../i18n/engine";

/** Ground heights at points, m (null without data); tests inject one. */
export type HeightsFetcher = (points: LonLat[]) => Promise<(number | null)[]>;

/** The railway as the engine builds it, with its service lines as published. */
export interface RailBuild {
  view: RailView;
  reports: Record<string, LineReport>;
  /** The published weekday timetable (absent when publishing failed): running times between stations. */
  timetable?: Timetable;
  /** "ready": gradients come from the terrain; "failed": the heights did not load; "none": the engine has no terrain. */
  terrain: "ready" | "failed" | "none";
}

/** Terrain tiles asked for in one request, and the most fetched for one table (as in the railway tool). */
const TILES_PER_REQUEST = 18;
const MAX_TILES = 144;

export const defaultHeights: HeightsFetcher = (points) => fetchElevations(points).then((r) => r.elevationsM);

/**
 * Purpose: add the terrain heights the last build still needs, so the next build has gradients and heights.
 * Output: whether every request succeeded. Side effects: fetches heights; adds tiles to the engine.
 */
export async function loadTerrain(engine: RailEngine, fetchHeights: HeightsFetcher): Promise<boolean> {
  if (!engine.missingTerrainTiles || !engine.terrainTilePoints || !engine.addTerrainTile) return true;
  const want = engine.missingTerrainTiles().slice(0, MAX_TILES);
  let ok = true;
  for (let i = 0; i < want.length; i += TILES_PER_REQUEST) {
    const batch = want.slice(i, i + TILES_PER_REQUEST);
    const pts = batch.map(([x, y]) => engine.terrainTilePoints!(x, y));
    try {
      const heights = await fetchHeights(pts.flat());
      let k = 0;
      batch.forEach(([x, y], j) => {
        engine.addTerrainTile!(x, y, heights.slice(k, k + pts[j]!.length));
        k += pts[j]!.length;
      });
    } catch {
      ok = false;
    }
  }
  return ok;
}

/**
 * Purpose: build a railway design and publish its service lines on a weekday, without terrain.
 * Output: the engine's view and the report of each line it could publish. Side effects: loads the rail engine.
 */
export async function buildRailway(
  railway: Network,
  loadRail: RailEngineLoader = loadRailEngine,
): Promise<Omit<RailBuild, "terrain">> {
  const engine = await loadRail();
  try {
    // Building and publishing are a second or more each on a large railway: the page answers in between.
    await nextTask();
    const view = engine.build(railway, null);
    await nextTask();
    return { view, ...publish(engine, railway) };
  } finally {
    engine.dispose();
  }
}

/** Purpose: the reports of the lines the engine could publish and their timetable; none when publishing fails. */
function publish(
  engine: RailEngine,
  railway: Network,
): { reports: Record<string, LineReport>; timetable?: Timetable } {
  const reports: Record<string, LineReport> = {};
  const lines = engineLines(railway);
  if (lines.length)
    try {
      const pub = engine.publishLines(lines, "weekday");
      for (const r of pub.lines) reports[r.id] = r;
      return { reports, timetable: pub.timetable };
    } catch {
      // Lines that cannot be published show without service.
    }
  return { reports };
}

/**
 * Purpose: build the project's railway for the network tables: the design with terrain heights (for the
 * steepest gradients) and the service lines as published on a weekday.
 * Inputs: the railway document; the engine loader and height source (tests inject them).
 * Output: the build, null while it runs or without track, and an error message.
 * Side effects: loads the rail engine (WebAssembly) and fetches terrain heights.
 */
export function useRailBuild(
  railway: Network | null,
  loadRail: RailEngineLoader = loadRailEngine,
  fetchHeights: HeightsFetcher = defaultHeights,
): { build: RailBuild | null; error: string | null } {
  const [build, setBuild] = useState<RailBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const json = JSON.stringify(railway);
  useEffect(() => {
    let live = true;
    setError(null);
    if (!railway || !railway.tracks.length) {
      setBuild(null);
      return;
    }
    (async () => {
      const engine = await loadRail();
      try {
        let view = engine.build(railway, null);
        let terrain: RailBuild["terrain"] = engine.addTerrainTile ? "ready" : "none";
        if (engine.addTerrainTile) {
          const ok = await loadTerrain(engine, fetchHeights);
          if (!live) return;
          if (!ok) terrain = "failed";
          view = engine.build(railway, null);
        }
        const published = publish(engine, railway);
        if (live) setBuild({ view, ...published, terrain });
      } finally {
        engine.dispose();
      }
    })().catch((e: unknown) => live && setError(engineErrorText(e)));
    return () => {
      live = false;
    };
  }, [json, loadRail, fetchHeights]);
  return { build, error };
}

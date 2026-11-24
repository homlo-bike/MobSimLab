import { useEffect, useState } from "react";
import {
  buildWithTerrain,
  fetchTerrainHeights,
  type HeightsFetcher,
  loadAllTerrain,
} from "../railways/terrainTiles";
import { loadRailEngine, nextTask } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type { Timetable } from "../journey-planner/types";
import type { LineReport, Network, RailEngine, RailEngineLoader, RailView } from "../railways/types";
import { engineErrorText } from "../../i18n/engine";

export type { HeightsFetcher } from "../railways/terrainTiles";

/** The railway as the engine builds it, with its service lines as published. */
export interface RailBuild {
  view: RailView;
  reports: Record<string, LineReport>;
  /** The published weekday timetable (absent when publishing failed): running times between stations. */
  timetable?: Timetable;
  /**
   * "ready": gradients come from the terrain; "failed": the heights did not load, and no service was planned
   * (it would run as if the line were flat); "none": the engine has no terrain.
   */
  terrain: "ready" | "failed" | "none";
  /** Why the heights did not load, with "failed". */
  terrainError?: string;
}

export const defaultHeights: HeightsFetcher = fetchTerrainHeights;

/**
 * Purpose: build a railway design with its terrain heights and publish its service lines on a weekday.
 * Output: the engine's view and the report of each line it could publish. Throws when the heights did not
 * load. Side effects: loads the rail engine; fetches terrain heights.
 */
export async function buildRailway(
  railway: Network,
  loadRail: RailEngineLoader = loadRailEngine,
  fetchHeights: HeightsFetcher = defaultHeights,
): Promise<Omit<RailBuild, "terrain">> {
  const engine = await loadRail();
  try {
    // Building and publishing are a second or more each on a large railway: the page answers in between.
    await nextTask();
    const view = await buildWithTerrain(engine, railway, fetchHeights);
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
        const terrain: RailBuild["terrain"] = engine.addTerrainTile ? "ready" : "none";
        const { failed } = await loadAllTerrain(
          engine,
          () => (view = engine.build(railway, null)),
          fetchHeights,
        );
        if (!live) return;
        if (failed) {
          // Without the heights the trains would run as if the line were flat: no service is planned.
          setBuild({ view, reports: {}, terrain: "failed", terrainError: failed });
          return;
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

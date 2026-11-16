import { loadRailEngine } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type { Network, RailEngineLoader } from "../railways/types";
import { defaultHeights, loadTerrain, type HeightsFetcher } from "../tables/railBuild";

/** The drawn railway as the capacity run loads it. */
export interface DrawnNetwork {
  /** Track topology export (JSON text, contracts/rail-topology.schema.json). */
  topology: string;
  /** The service lines in the timetable planner's form: `{"service_lines": [...]}` (JSON text). */
  lines: string;
}

/** Why the drawn railway cannot be tested: nothing drawn, no service line ready, or errors in the drawing. */
export type DrawnProblem = "noTrack" | "noLines" | "errors";

/** Purpose: what keeps the drawn railway from the test before it is built, or null. */
export function drawnProblem(railway: Network | null | undefined): DrawnProblem | null {
  if (!railway || !railway.tracks.length) return "noTrack";
  if (!engineLines(railway).length) return "noLines";
  return null;
}

/**
 * Purpose: build the project's railway with its terrain heights, as the Tables tab does, and give the
 * capacity run its track topology and service lines (the lines the railway tool can publish).
 * Inputs: the railway document; the engine loader and height source (tests inject them).
 * Output: the network, or a problem when nothing can be tested.
 * Side effects: loads the rail engine (WebAssembly) and fetches terrain heights.
 */
export async function buildDrawnNetwork(
  railway: Network | null | undefined,
  loadRail: RailEngineLoader = loadRailEngine,
  fetchHeights: HeightsFetcher = defaultHeights,
): Promise<DrawnNetwork | DrawnProblem> {
  const problem = drawnProblem(railway);
  if (problem || !railway) return problem ?? "noTrack";
  const engine = await loadRail();
  try {
    let view = engine.build(railway, null);
    if (engine.addTerrainTile) {
      await loadTerrain(engine, fetchHeights);
      view = engine.build(railway, null);
    }
    if (view.counts.errors > 0) return "errors";
    return {
      topology: JSON.stringify(engine.topology()),
      lines: JSON.stringify({ service_lines: engineLines(railway) }),
    };
  } finally {
    engine.dispose();
  }
}

import { loadRailEngine } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type { Network, RailEngineLoader } from "../railways/types";
import { dayEngineLines } from "../timetables/railPublish";
import { DAY_TYPES, type DayTypeId, type ServiceCalendar } from "../../workspace/calendar";
import { defaultHeights, type HeightsFetcher } from "../tables/railBuild";
import { buildWithTerrain } from "../railways/terrainTiles";

/** The drawn railway as the capacity run loads it. */
export interface DrawnNetwork {
  /** Track topology export (JSON text, contracts/rail-topology.schema.json). */
  topology: string;
  /** The service lines in the timetable planner's form: `{"service_lines": [...]}` (JSON text). */
  lines: string;
  /**
   * With a calendar: the service lines of each other day type whose lines run other times than on a weekday
   * (JSON text, as `lines`); `lines` is then the weekday's, with the calendar's peaks.
   */
  dayLines?: Partial<Record<DayTypeId, string>>;
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
 * Inputs: the railway document; the engine loader and height source (tests inject them); the project's
 * preference values (running values of the lines); the project calendar, for the service of every day type.
 * Output: the network, or a problem when nothing can be tested. Throws when the terrain heights did not load.
 * Side effects: loads the rail engine (WebAssembly) and fetches terrain heights.
 */
export async function buildDrawnNetwork(
  railway: Network | null | undefined,
  loadRail: RailEngineLoader = loadRailEngine,
  fetchHeights: HeightsFetcher = defaultHeights,
  values?: Readonly<Record<string, number>> | null,
  cal?: ServiceCalendar,
): Promise<DrawnNetwork | DrawnProblem> {
  const problem = drawnProblem(railway);
  if (problem || !railway) return problem ?? "noTrack";
  const engine = await loadRail();
  try {
    // Throws when the heights did not load: the trains would run as if the line were flat.
    const view = await buildWithTerrain(engine, railway, fetchHeights);
    if (view.counts.errors > 0) return "errors";
    const topology = JSON.stringify(engine.topology());
    if (!cal)
      return {
        topology,
        lines: JSON.stringify({ service_lines: engineLines(railway, railway.lines ?? [], values) }),
      };
    const text = (d: DayTypeId) => JSON.stringify({ service_lines: dayEngineLines(railway, d, cal, values) });
    const lines = text("weekday");
    const dayLines: Partial<Record<DayTypeId, string>> = {};
    for (const d of DAY_TYPES) {
      const own = d === "weekday" ? lines : text(d);
      if (own !== lines) dayLines[d] = own;
    }
    return { topology, lines, dayLines };
  } finally {
    engine.dispose();
  }
}

/**
 * The noise map's sources for one design at one level of detail (ADR-0038 §4): planned (headways and sample
 * flows), timetabled (the trips of the day) or simulated (the vehicles of a saved road run, the railway on its
 * timetable), with notes for the map on what was used.
 */
import { tNow } from "../../i18n/i18n";
import type { Network, RailEngineLoader } from "../railways/types";
import { buildWithTerrain, fetchTerrainHeights, type HeightsFetcher } from "../railways/terrainTiles";
import type { Replay, RoadParams, RoadScenario } from "../road-sim/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import { simulatedStreetSources } from "./simulated";
import { RAIL_FLOWS, railSources, streetLineSources } from "./sources";
import { publishedRailSources, timetabledStreetSources } from "./timetabled";
import type { Flows, InputLevel, LonLat, NoiseLine } from "./types";

/** Evening and night buses per hour on a street line (the street line tool's defaults). */
export const STREET_OFF_PEAK: Omit<Flows, "day"> = { evening: 3, night: 1 };

/** A design the noise map can compute: the current drawing or a saved scenario. */
export interface Design {
  streetLines: StreetLinesDoc | null;
  railway: Network | null;
}

/** A road run as the simulated input needs it. */
export interface RoadRunInput {
  name: string;
  scenario: RoadScenario;
  replay: Replay;
  params: Pick<RoadParams, "from_s" | "to_s">;
}

/** Purpose: whether a design has anything to compute. */
export function hasLines(d: Design): boolean {
  return (d.streetLines?.lines ?? []).some((l) => l.view.points.length >= 2) || !!d.railway?.tracks.length;
}

/**
 * Purpose: a design's noise sources at a level of detail.
 * Inputs: the design, the level, the road run for the simulated level, the rail engine loader and the height
 * source. Output: the sources and notes saying where the flows came from. Throws at the timetabled and
 * simulated levels when the terrain heights under the railway did not load.
 * Side effects: builds the railway (and publishes its service lines) with the rail engine.
 */
export async function designSources(
  design: Design,
  level: InputLevel,
  loadRail: RailEngineLoader,
  run: RoadRunInput | null = null,
  fetchHeights: HeightsFetcher = fetchTerrainHeights,
): Promise<{ lines: NoiseLine[]; notes: string[] }> {
  const lines: NoiseLine[] = [];
  const notes: string[] = [];
  const street = design.streetLines?.lines ?? [];
  if (level === "planned") {
    for (const [i, l] of street.entries()) {
      if (l.view.points.length < 2) continue;
      const day = l.timing.headwayMin > 0 ? 60 / l.timing.headwayMin : 0;
      for (const s of streetLineSources(l.view, l.profile, { day, ...STREET_OFF_PEAK }, false))
        lines.push({ ...s, id: `street-${i}-${s.id}`, label: l.name || `Street line ${i + 1}` });
    }
  } else if (level === "timetabled") {
    lines.push(...timetabledStreetSources(street));
  } else if (run) {
    const sim = simulatedStreetSources(run, street);
    lines.push(...sim.lines);
    notes.push(
      sim.hours.length
        ? tNow("noise.runHours", { run: run.name, hours: hoursText(sim.hours) })
        : tNow("noise.runNoHours", { run: run.name }),
    );
    if (sim.noTimetable.length)
      notes.push(tNow("noise.runNoTimetable", { lines: sim.noTimetable.join(", ") }));
  }
  const railway = design.railway;
  if (railway && railway.tracks.length) {
    const engine = await loadRail();
    try {
      // Timetabled trains run on the terrain heights; without them this throws and says why.
      const view =
        level === "planned"
          ? engine.build(railway, null)
          : await buildWithTerrain(engine, railway, fetchHeights);
      if (level === "planned") {
        const flows = RAIL_FLOWS[railway.mode] ?? RAIL_FLOWS.tram!;
        lines.push(...railSources(railway, view, flows));
      } else {
        const r = publishedRailSources(engine, railway, view);
        lines.push(...r.lines);
        notes.push(...r.notes);
        if (level === "simulated" && r.lines.length) notes.push(tNow("noise.railTimetabled"));
      }
    } finally {
      engine.dispose();
    }
  }
  return { lines, notes };
}

/** Purpose: clock hours as ranges, "07:00–10:00, 16:00–18:00". */
export function hoursText(hours: readonly number[]): string {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const out: string[] = [];
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(`${hh(sorted[i]!)}–${hh(sorted[j]! + 1)}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** Spacing of the points that set a shared grid, m (the engine's source element length). */
const COVER_STEP_M = 10;

/**
 * Purpose: points every 10 m along the lines of both designs compared, so both estimates share one grid.
 */
export function coverPoints(lines: readonly NoiseLine[]): LonLat[] {
  const out: LonLat[] = [];
  for (const l of lines) {
    const p = l.points;
    if (p.length) out.push(p[0]!);
    for (let i = 1; i < p.length; i++) {
      const [a, b] = [p[i - 1]!, p[i]!];
      const kx = Math.cos((a[1] * Math.PI) / 180) * 111_320;
      const d = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 111_320);
      const n = Math.max(1, Math.ceil(d / COVER_STEP_M));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return out;
}

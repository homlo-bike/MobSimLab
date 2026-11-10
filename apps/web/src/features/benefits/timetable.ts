/**
 * The project's whole published network as one timetable for the benefit tables (ADR-0040), with route ids
 * that match the cost tables: `street:<index>` for street lines, `rail:<line id>` for rail service lines
 * and `plugin:<id>` for cable car and ferry lines.
 */
import {
  mergeTimetables,
  type PluginLineInput,
  pluginLineTimetable,
  prefixTimetable,
  streetLineTimetable,
} from "../journey-planner/network";
import type { Timetable } from "../journey-planner/types";
import { lineInput, type SavedStreetLine } from "../street-lines/saved";

/** Purpose: one timetable of every street, rail and plugin line, or null when there is none. */
export function projectTimetable(
  streetLines: SavedStreetLine[],
  rail: Timetable | null,
  plugins: PluginLineInput[],
): Timetable | null {
  const parts: Timetable[] = [];
  streetLines.forEach((l, i) => {
    const input = lineInput(l);
    const tt = input && streetLineTimetable(input);
    if (!tt) return;
    const p = prefixTimetable(tt, `s${i}:`);
    const route = `street:${i}`;
    parts.push({
      ...p,
      routes: p.routes.map((r) => ({ ...r, route_id: route })),
      trips: p.trips.map((t) => ({ ...t, route_id: route })),
      frequency_patterns: p.frequency_patterns.map((f) => ({ ...f, route_id: route })),
    });
  });
  if (rail && (rail.trips?.length || rail.frequency_patterns?.length))
    parts.push(prefixTimetable(rail, "rail:"));
  for (const l of plugins) {
    const tt = pluginLineTimetable(l);
    if (tt) parts.push(tt);
  }
  return parts.length ? mergeTimetables(parts) : null;
}

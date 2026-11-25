/**
 * Why a service line has no trips: the timetable planner's reason (a train that stalls on a gradient too steep
 * for it, a platform too short for the train), for views that run the drawn railway without the planner's
 * report, such as the capacity run, the calendar run and the noise map.
 */
import { engineTextNow } from "../../i18n/engine";
import { tNow } from "../../i18n/i18n";
import type { EngineServiceLine, LineReport, Network, RailEngine } from "./types";

/**
 * Purpose: one note per line in `reports` without trips, "<line> has no trains: <reason>", in the app language.
 * Inputs: the railway (for the line names) and the planner's line reports.
 */
export function cannotRunNotes(railway: Network, reports: readonly LineReport[]): string[] {
  const names = new Map((railway.lines ?? []).map((l) => [l.id, l.name] as const));
  return reports
    .filter((r) => r.trips === 0 && r.issues.length > 0)
    .map((r) =>
      tNow("rail.lineCannotRun", {
        line: names.get(r.id) ?? r.id,
        reason: engineTextNow({ text: r.issues[0]!, msg: r.issue_msgs?.[0] }),
      }),
    );
}

/**
 * Purpose: the notes of {@link cannotRunNotes} for lines planned on the engine's last build (a weekday).
 * Output: none when the planner cannot publish the lines at all (the run says why itself).
 * Side effects: publishes the lines with the engine.
 */
export function lineCannotRunNotes(
  engine: Pick<RailEngine, "publishLines">,
  railway: Network,
  lines: EngineServiceLine[],
): string[] {
  if (!lines.length || !engine.publishLines) return [];
  try {
    return cannotRunNotes(railway, engine.publishLines(lines, "weekday").lines);
  } catch {
    return [];
  }
}

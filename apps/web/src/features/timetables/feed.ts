/**
 * The project's own lines on every day type (weekday, Saturday, Sunday, public holiday), for the GTFS downloads
 * of the Tables tab and the journey planner and for the railway tool's report (FR-TT-03, FR-TT-05).
 */
import { loadRailEngine } from "../railways/engine";
import type { Network, PublishOptions, RailEngineLoader } from "../railways/types";
import {
  mergeTimetables,
  type PluginLineInput,
  pluginLineTimetable,
  prefixTimetable,
  type StreetLineInput,
  streetLineTimetable,
} from "../journey-planner/network";
import type { Timetable } from "../journey-planner/types";
import { lineInput, type SavedStreetLine } from "../street-lines/saved";
import { DAY_TYPES, type DayTypeId, holidaysFor, type ServiceCalendar } from "../../workspace/calendar";
import { dayServiceOf, lineDay, streetTimingFor, streetWeekday } from "./dayTypes";
import { type DayPublications, publishDays } from "./railPublish";

/**
 * Purpose: a saved street line on a day type: its input with that day's timing, and its timetable with the
 * day's first and last departure, the calendar's peaks and the day type as service id.
 */
export function streetDay(
  s: SavedStreetLine,
  day: DayTypeId,
  cal: ServiceCalendar,
): { input: StreetLineInput; timetable: Timetable | null } | null {
  const input = lineInput({ ...s, timing: streetTimingFor(s.timing, day) });
  if (!input) return null;
  const service = dayServiceOf(streetWeekday(s.timing), s.timing.days, day);
  return { input, timetable: streetLineTimetable(input, lineDay(cal, day, service), day) };
}

/**
 * Purpose: one timetable of every day type for a GTFS feed: each day's trips and patterns keep the day as their
 * service id and get it after their id (weekday ids stay as they are); stops and routes are listed once.
 */
export function mergeDays(parts: Partial<Record<DayTypeId, Timetable[]>>): Timetable | null {
  const all: Timetable[] = [];
  for (const day of DAY_TYPES) {
    const own = (id: string) => (day === "weekday" ? id : `${id}~${day}`);
    for (const tt of parts[day] ?? [])
      if (tt.trips.length || tt.frequency_patterns?.length)
        all.push({
          ...tt,
          trips: tt.trips.map((t) => ({ ...t, trip_id: own(t.trip_id), service_id: day })),
          frequency_patterns: (tt.frequency_patterns ?? []).map((p) => ({
            ...p,
            pattern_id: own(p.pattern_id),
            service_id: day,
          })),
        });
  }
  if (!all.length) return null;
  const merged = mergeTimetables(all);
  const once = <T>(xs: T[], id: (x: T) => string) => [...new Map(xs.map((x) => [id(x), x])).values()];
  return {
    ...merged,
    stops: once(merged.stops, (s) => s.stop_id),
    routes: once(merged.routes, (r) => r.route_id),
    transfers: once(merged.transfers, (t) => `${t.from_stop_id}|${t.to_stop_id}`),
  };
}

/** Purpose: the calendar's public holidays from one date to another, as GTFS dates (YYYYMMDD). */
export function feedHolidays(cal: ServiceCalendar, from: Date, to: Date): string[] {
  const years = Array.from(
    { length: to.getFullYear() - from.getFullYear() + 1 },
    (_, i) => from.getFullYear() + i,
  );
  return years.flatMap((y) => holidaysFor(cal, y)).map((d) => d.replaceAll("-", ""));
}

/**
 * Purpose: the project's own lines on every day type as one timetable for a GTFS feed: the railway's service
 * lines (published for each day type), the street lines (each day's own times) and the plugin lines (ferries,
 * cable cars: their one timing on every day type). Ids are prefixed as in the journey planner (`lines:`, `s<i>:`).
 * Side effects: loads the rail engine when the railway has lines.
 */
export async function projectFeed({
  railway,
  streetLines,
  pluginLines = [],
  cal,
  options,
  values,
  loadRail = loadRailEngine,
}: {
  railway: Network | null;
  streetLines: readonly SavedStreetLine[];
  pluginLines?: readonly PluginLineInput[];
  cal: ServiceCalendar;
  options?: PublishOptions;
  values?: Readonly<Record<string, number>> | null;
  loadRail?: RailEngineLoader;
}): Promise<Timetable | null> {
  let rail: DayPublications = {};
  if (railway?.tracks.length && railway.lines?.length) {
    const engine = await loadRail();
    try {
      engine.build(railway, null);
      rail = publishDays(engine, railway, cal, options, values);
    } finally {
      engine.dispose();
    }
  }
  const plugin = pluginLines.map((l) => pluginLineTimetable(l)).filter((t): t is Timetable => t !== null);
  const parts: Partial<Record<DayTypeId, Timetable[]>> = {};
  for (const day of DAY_TYPES) {
    const r = rail[day]?.timetable;
    parts[day] = [
      ...(r ? [prefixTimetable(r, "lines:")] : []),
      ...streetLines.flatMap((s, i) => {
        const tt = streetDay(s, day, cal)?.timetable;
        return tt ? [prefixTimetable(tt, `s${i}:`)] : [];
      }),
      ...plugin,
    ];
  }
  return mergeDays(parts);
}

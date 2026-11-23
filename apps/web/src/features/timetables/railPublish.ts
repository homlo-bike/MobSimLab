import { useEffect, useState } from "react";
import { loadRailEngine, nextTask } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type {
  EngineServiceLine,
  Network,
  PublishOptions,
  RailEngine,
  RailEngineLoader,
  RailView,
  ServicePublication,
} from "../railways/types";
import { DAY_TYPES, type DayTypeId, serviceDayFor, type ServiceCalendar } from "../../workspace/calendar";
import { railLineFor, withPeaks } from "./dayTypes";
import { engineErrorText } from "../../i18n/engine";
import { paramValue } from "../costs/params";

/**
 * Purpose: the railway's service lines in the engine's form on a day type, with the calendar's peaks and the
 * project's running values (`values`: Project preferences values by id), as the railway tool publishes them.
 */
export function dayEngineLines(
  railway: Network,
  day: DayTypeId,
  cal: ServiceCalendar,
  values?: Readonly<Record<string, number>> | null,
): EngineServiceLine[] {
  const doc = { ...railway, lines: (railway.lines ?? []).map((l) => railLineFor(l, day)) };
  return withPeaks(engineLines(doc, doc.lines, values), serviceDayFor(cal, day));
}

export type DayPublications = Partial<Record<DayTypeId, ServicePublication>>;

/**
 * Purpose: publish the railway's service lines on every day type that has lines, on an engine that has built the
 * railway (each day with its own times and headways and the calendar's peaks).
 */
export function publishDays(
  engine: Pick<RailEngine, "publishLines">,
  railway: Network,
  cal: ServiceCalendar,
  options?: PublishOptions,
  values?: Readonly<Record<string, number>> | null,
): DayPublications {
  const out: DayPublications = {};
  for (const day of DAY_TYPES) {
    const lines = dayEngineLines(railway, day, cal, values);
    if (lines.length) out[day] = engine.publishLines(lines, day, options);
  }
  return out;
}

/**
 * Purpose: the publish settings from the project's preferences: the longest wait at a terminal
 * (`timetable.max_terminal_wait_min`) and the longest wait for a faster train to pass
 * (`timetable.max_overtake_wait_min`), each the assumption library's value unless the project sets its own.
 * Inputs: the project's preference values. Output: the settings, in seconds.
 */
export function publishOptionsFrom(
  values: Readonly<Record<string, number>> | null | undefined,
): PublishOptions {
  const min = (key: string) => paramValue(key, "*", values ?? undefined)[1];
  return {
    max_idle_s: min("timetable.max_terminal_wait_min") * 60,
    max_overtake_wait_s: min("timetable.max_overtake_wait_min") * 60,
  };
}

/** No publications (one object, so memos that depend on it keep). */
const NONE: DayPublications = {};

/**
 * Purpose: publish the railway's service lines for every day type with the project's settings, for the
 * timetables in the Tables tab (the timetable planner's trips and vehicle blocks). The design is built once.
 * Inputs: the railway document, the project calendar (peak windows), the publish settings, the project's
 * preference values; the engine loader
 * (tests inject one).
 * Output: the publication per day type, empty while it runs or without lines, the built design (null until
 * then), and an error message.
 * Side effects: loads the rail engine (WebAssembly).
 */
export function useRailPublications(
  railway: Network | null,
  cal: ServiceCalendar,
  options: PublishOptions,
  values?: Readonly<Record<string, number>> | null,
  loadRail: RailEngineLoader = loadRailEngine,
): { publications: DayPublications; view: RailView | null; busy: boolean; error: string | null } {
  const [state, setState] = useState<{
    key: string;
    publications: DayPublications;
    view: RailView | null;
    error: string | null;
  } | null>(null);
  const lines = railway ? DAY_TYPES.map((d) => [d, dayEngineLines(railway, d, cal, values)] as const) : [];
  const key = JSON.stringify([railway, lines, options]);
  const none = !railway || !railway.tracks.length || !lines.some(([, l]) => l.length);
  useEffect(() => {
    if (none) return;
    let live = true;
    const fail = (err: unknown) => {
      if (live)
        setState({
          key,
          publications: {},
          view: null,
          error: engineErrorText(err),
        });
    };
    (async () => {
      const engine = await loadRail();
      try {
        await nextTask();
        if (!live) return;
        const view = engine.build(railway!, null);
        // One day type at a time, letting the page answer in between: each takes a second or more on
        // a large network (the Tables tab froze on the Damascus network, bug 21).
        const publications: DayPublications = {};
        for (const [day, dayLines] of lines) {
          if (!dayLines.length) continue;
          await nextTask();
          if (!live) return;
          publications[day] = engine.publishLines(dayLines, day, options);
        }
        if (live) setState({ key, publications, view, error: null });
      } catch (err) {
        fail(err);
      } finally {
        engine.dispose();
      }
    })().catch(fail);
    return () => {
      live = false;
    };
    // The key holds every input.
  }, [key, none, loadRail]);
  if (none) return { publications: NONE, view: null, busy: false, error: null };
  const current = state?.key === key ? state : null;
  return {
    publications: current?.publications ?? NONE,
    view: current?.view ?? null,
    busy: !current,
    error: current?.error ?? null,
  };
}

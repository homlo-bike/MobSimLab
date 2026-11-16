import { useEffect, useState } from "react";
import { loadRailEngine } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type {
  EngineServiceLine,
  Network,
  PublishOptions,
  RailEngineLoader,
  ServicePublication,
} from "../railways/types";
import { DAY_TYPES, type DayTypeId, serviceDayFor, type ServiceCalendar } from "../../workspace/calendar";
import { railLineFor, withPeaks } from "./dayTypes";

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

/** No publications (one object, so memos that depend on it keep). */
const NONE: DayPublications = {};

/**
 * Purpose: publish the railway's service lines for every day type with the project's settings, for the
 * timetables in the Tables tab (the timetable planner's trips and vehicle blocks). The design is built once.
 * Inputs: the railway document, the project calendar (peak windows), the publish settings, the project's
 * preference values; the engine loader
 * (tests inject one).
 * Output: the publication per day type, empty while it runs or without lines, and an error message.
 * Side effects: loads the rail engine (WebAssembly).
 */
export function useRailPublications(
  railway: Network | null,
  cal: ServiceCalendar,
  options: PublishOptions,
  values?: Readonly<Record<string, number>> | null,
  loadRail: RailEngineLoader = loadRailEngine,
): { publications: DayPublications; busy: boolean; error: string | null } {
  const [state, setState] = useState<{
    key: string;
    publications: DayPublications;
    error: string | null;
  } | null>(null);
  const lines = railway ? DAY_TYPES.map((d) => [d, dayEngineLines(railway, d, cal, values)] as const) : [];
  const key = JSON.stringify([railway, lines, options]);
  const none = !railway || !railway.tracks.length || !lines.some(([, l]) => l.length);
  useEffect(() => {
    if (none) return;
    let live = true;
    const fail = (err: unknown) => {
      if (live) setState({ key, publications: {}, error: err instanceof Error ? err.message : String(err) });
    };
    (async () => {
      const engine = await loadRail();
      try {
        engine.build(railway!, null);
        const publications: DayPublications = {};
        for (const [day, l] of lines) if (l.length) publications[day] = engine.publishLines(l, day, options);
        if (live) setState({ key, publications, error: null });
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
  if (none) return { publications: NONE, busy: false, error: null };
  const current = state?.key === key ? state : null;
  return { publications: current?.publications ?? NONE, busy: !current, error: current?.error ?? null };
}

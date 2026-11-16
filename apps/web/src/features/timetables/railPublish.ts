import { useEffect, useState } from "react";
import { loadRailEngine } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import { type DayTypeId, serviceDayFor, type ServiceCalendar } from "../../workspace/calendar";
import { railLineFor, withPeaks } from "./dayTypes";
import type { Network, PublishOptions, RailEngineLoader, ServicePublication } from "../railways/types";

/** Purpose: the railway's service lines in the engine's form on a day type, with the calendar's peaks. */
export function dayEngineLines(railway: Network, day: DayTypeId, cal: ServiceCalendar) {
  const doc = { ...railway, lines: (railway.lines ?? []).map((l) => railLineFor(l, day)) };
  return withPeaks(engineLines(doc), serviceDayFor(cal, day));
}

/**
 * Purpose: publish the railway's service lines for one day type with the project's settings, for the
 * timetables in the Tables tab (the timetable planner's trips and vehicle blocks).
 * Inputs: the railway document, the day type, the project calendar (peak windows), the publish settings; the
 * engine loader (tests inject one).
 * Output: the publication, null while it runs or without lines, and an error message.
 * Side effects: loads the rail engine (WebAssembly).
 */
export function useRailPublication(
  railway: Network | null,
  day: DayTypeId,
  cal: ServiceCalendar,
  options: PublishOptions,
  loadRail: RailEngineLoader = loadRailEngine,
): { publication: ServicePublication | null; busy: boolean; error: string | null } {
  const [state, setState] = useState<{
    key: string;
    publication: ServicePublication | null;
    error: string | null;
  } | null>(null);
  const lines = railway ? dayEngineLines(railway, day, cal) : [];
  const key = JSON.stringify([railway, day, lines, options]);
  const none = !railway || !railway.tracks.length || !lines.length;
  useEffect(() => {
    if (none) return;
    let live = true;
    (async () => {
      const engine = await loadRail();
      try {
        engine.build(railway!, null);
        const publication = engine.publishLines(lines, day, options);
        if (live) setState({ key, publication, error: null });
      } catch (err) {
        if (live)
          setState({ key, publication: null, error: err instanceof Error ? err.message : String(err) });
      } finally {
        engine.dispose();
      }
    })().catch((err: unknown) => {
      if (live) setState({ key, publication: null, error: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      live = false;
    };
    // The key holds every input.
  }, [key, none, loadRail]);
  if (none) return { publication: null, busy: false, error: null };
  const current = state?.key === key ? state : null;
  return { publication: current?.publication ?? null, busy: !current, error: current?.error ?? null };
}

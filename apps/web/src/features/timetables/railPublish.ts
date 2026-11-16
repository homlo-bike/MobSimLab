import { useEffect, useState } from "react";
import { loadRailEngine } from "../railways/engine";
import { engineLines } from "../railways/serviceLines";
import type { Network, PublishOptions, RailEngineLoader, ServicePublication } from "../railways/types";

/**
 * Purpose: publish the railway's service lines for one day type with the project's settings, for the
 * timetables in the Tables tab (the timetable planner's trips and vehicle blocks).
 * Inputs: the railway document, the day type id, the publish settings; the engine loader (tests inject one).
 * Output: the publication, null while it runs or without lines, and an error message.
 * Side effects: loads the rail engine (WebAssembly).
 */
export function useRailPublication(
  railway: Network | null,
  serviceId: string,
  options: PublishOptions,
  loadRail: RailEngineLoader = loadRailEngine,
): { publication: ServicePublication | null; busy: boolean; error: string | null } {
  const [state, setState] = useState<{
    key: string;
    publication: ServicePublication | null;
    error: string | null;
  } | null>(null);
  const key = JSON.stringify([railway, serviceId, options]);
  const none = !railway || !railway.tracks.length || !engineLines(railway).length;
  useEffect(() => {
    if (none) return;
    let live = true;
    (async () => {
      const engine = await loadRail();
      try {
        engine.build(railway!, null);
        const publication = engine.publishLines(engineLines(railway!), serviceId, options);
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

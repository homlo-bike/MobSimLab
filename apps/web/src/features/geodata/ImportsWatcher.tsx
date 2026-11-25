import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { usePublishJob, useRunningJobs } from "../../shell/jobs";
import type { GeodataApi, GeodataStatus, ImportRun } from "./api";
import { importBusy, importProgress } from "./MapDataPanel";

/** How often a running import is followed, and how often the project looks for one started elsewhere. */
const BUSY_MS = 2_000;
const IDLE_MS = 30_000;

/** One running import in the bottom bar. */
function ImportJob({ run }: { run: ImportRun }) {
  const { t, language } = useI18n();
  const p = importProgress(run, t, language);
  const overall = Math.min(1, Math.max(0, (p.index - 1 + (p.fraction ?? 0.5)) / Math.max(p.steps, 1)));
  usePublishJob(
    { label: p.label, step: p.step, overall: p.fraction === null && p.steps <= 1 ? null : overall },
    `import:${run.id}`,
  );
  return null;
}

/**
 * Purpose: keep the project's OpenStreetMap and elevation imports in the bar at the bottom of the page while they
 * run, on every tab, also after the Map data panel is closed. Renders nothing itself.
 * Side effects: reads the import status now and then (every few seconds while one runs).
 */
export function ImportsWatcher({ api }: { api: GeodataApi }) {
  const [status, setStatus] = useState<GeodataStatus | null>(null);
  // An import the Map data panel shows, so it is followed at once when that panel closes.
  const panelImport = useRunningJobs().some((j) => j.key.startsWith("import:"));
  const runs = status
    ? [status.osm?.latest, status.dem?.latest, status.demUpload?.latest].filter(importBusy)
    : [];
  const busy = runs.length > 0 || panelImport;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        void api.status().then(
          (s) => live && setStatus(s),
          () => {},
        ),
      status === null ? 0 : busy ? BUSY_MS : IDLE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, status, busy]);
  return (
    <>
      {runs.map((r) => (
        <ImportJob key={r!.id} run={r!} />
      ))}
    </>
  );
}

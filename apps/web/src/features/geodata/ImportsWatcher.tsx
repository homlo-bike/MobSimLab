import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { usePublishJob, useRunningJobs } from "../../shell/jobs";
import type { PopulationApi, PopulationLayer } from "../population/api";
import { layerFraction, layerJobKey, layerStepIndex, layerStepText } from "../population/progress";
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

/** One population layer being imported, in the bottom bar. */
function PopulationJob({ layer: l }: { layer: PopulationLayer }) {
  const { t } = useI18n();
  const fraction = layerFraction(l);
  usePublishJob(
    { label: l.name, step: layerStepText(l, t), overall: (layerStepIndex(l) - 1 + (fraction ?? 0.5)) / 2 },
    layerJobKey(l.id),
  );
  return null;
}

interface Watched {
  geo: GeodataStatus | null;
  population: PopulationLayer[];
}

/**
 * Purpose: keep the project's OpenStreetMap, elevation and population imports in the bar at the bottom of the page while they
 * run, on every tab, also after the Map data panel is closed. Renders nothing itself.
 * Side effects: reads the import status and the population layers now and then (every few seconds while one runs).
 */
export function ImportsWatcher({ api, population }: { api: GeodataApi; population?: PopulationApi | null }) {
  const [status, setStatus] = useState<Watched | null>(null);
  // An import the Map data or Population panel shows, so it is followed at once when that panel closes.
  const panelImport = useRunningJobs().some(
    (j) => j.key.startsWith("import:") || j.key.startsWith("population:"),
  );
  const runs = status?.geo
    ? [status.geo.osm?.latest, status.geo.dem?.latest, status.geo.demUpload?.latest].filter(importBusy)
    : [];
  const layers = status?.population.filter((l) => l.status === "importing") ?? [];
  const busy = runs.length > 0 || layers.length > 0 || panelImport;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        void Promise.all([
          api.status().catch(() => status?.geo ?? null),
          population
            ? population.overview().then(
                (o) => o?.layers ?? [],
                () => status?.population ?? [],
              )
            : Promise.resolve([]),
        ]).then(([geo, pop]) => live && setStatus({ geo, population: pop })),
      status === null ? 0 : busy ? BUSY_MS : IDLE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, population, status, busy]);
  return (
    <>
      {runs.map((r) => (
        <ImportJob key={r!.id} run={r!} />
      ))}
      {layers.map((l) => (
        <PopulationJob key={l.id} layer={l} />
      ))}
    </>
  );
}

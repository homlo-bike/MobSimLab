import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { JobProgress } from "../../shell/JobProgress";
import { formatInt, tNow, useI18n } from "../../i18n/i18n";
import { loadRailEngine } from "../railways/engine";
import type { Network, RailEngineLoader } from "../railways/types";
import type { RoadRun, RoadRunsApi } from "../road-sim/api";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { ScenariosDoc } from "../tables/scenarioModel";
import {
  type BuildingTileFetcher,
  buildingTiles,
  drawBuildings,
  fetchBuildingTile,
  loadBuildings,
  MAX_BUILDING_TILES,
  removeBuildings,
} from "./buildings";
import { differenceLevels, differencePixels } from "./difference";
import { type NoiseLevels, type NoiseRunner, workerRunner } from "./engine";
import { coverPoints, type Design, designSources, hasLines, type RoadRunInput } from "./inputs";
import { drawNoise, removeNoise } from "./mapLayer";
import { NoiseResult } from "./NoiseResult";
import { type Computed, type Difference, type Done, FROM_DB } from "./result";
import type { SavedPluginLine } from "../../kits/saved";
import { pluginSources } from "./sources";
import { buildingsBbox, fetchPopulation, type PopulationFetcher, type PopulationSource } from "./population";
import { fetchHeights, type HeightsFetcher, loadTerrain, terrainPlan } from "./terrain";
import type {
  Indicator,
  InputLevel,
  NoiseBuilding,
  NoiseInput,
  NoiseLine,
  NoisePopulation,
  NoiseTerrain,
  NoiseView,
} from "./types";
import { paramNumber } from "../../workspace/preferences";

export { STREET_OFF_PEAK } from "./inputs";
export { FROM_DB } from "./result";

/** How far the noise map reaches from the lines, m: the library's `noise.map_reach_m`. */
export const MAP_REACH_M = paramNumber("noise.map_reach_m", undefined);

/** The current drawing in the scenario pickers. */
const CURRENT = "current";

interface Props {
  map: MapLibreMap | null;
  streetLines: StreetLinesDoc | null;
  railway: Network | null;
  /** Cable car and ferry lines saved with the project, by plugin tool. */
  pluginLines?: Record<string, SavedPluginLine>;
  /** Project preferences: `noise.*` values replace the plugin's assumptions. */
  preferences?: Record<string, number>;
  /** Scenarios saved in the Tables tab, to compute or compare with. */
  scenarios?: ScenariosDoc | null;
  /** The project's saved road runs, for the simulated input. */
  roadRuns?: RoadRunsApi | null;
  /** Tests inject these. */
  runNoise?: NoiseRunner;
  loadRail?: RailEngineLoader;
  fetchTile?: BuildingTileFetcher;
  fetchTerrain?: HeightsFetcher;
  fetchPeople?: PopulationFetcher;
  /** How long to wait for a first-time WorldPop download before using the building size, ms. */
  popWaitMs?: number;
  /** How often to ask whether the WorldPop download is done, ms. */
  popPollMs?: number;
  /**
   * Whether "Screen with OpenStreetMap buildings" starts ticked. Off by default: the map is computed from the lines
   * and the terrain alone, and buildings (their screening and the residents per band) are an option.
   */
  screenBuildings?: boolean;
}

/** Purpose: `p`, or a rejection with the signal's reason as soon as it aborts (the request itself runs on). */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

const NO_PLUGIN_LINES: Record<string, SavedPluginLine> = {};

/** Wait for a first-time WorldPop download for up to this long by default (a large country takes minutes). */
const POP_WAIT_MS = 15 * 60_000;
const POP_POLL_MS = 3_000;

/**
 * Purpose: the project's noise lines as planned: every saved street line (buses per hour from the headway in
 * the day, the tool's evening and night defaults) and every railway track (the sample trains per hour of the
 * design's mode).
 * Side effects: builds the railway design with the rail engine when there is one.
 */
export async function projectSources(
  streetLines: StreetLinesDoc | null,
  railway: Network | null,
  loadRail: RailEngineLoader,
): Promise<NoiseLine[]> {
  return (await designSources({ streetLines, railway }, "planned", loadRail)).lines;
}

/** A step of the computation under way: its text, its number of `steps`, and how far it is when known. */
interface Busy {
  kind: "busy";
  step: string;
  index: number;
  steps: number;
  fraction: number | null;
  /** While waiting for WorldPop, the planner may go on with the building size. */
  canSkip?: boolean;
}

type Status = { kind: "idle" } | Busy | Done | { kind: "error"; text: string } | { kind: "cancelled" };

/**
 * Purpose: the Noise map in the GIS tab (ADR-0038 steps N2 and N3): L_den or L_night from the street lines and
 * railway of the current design or a saved scenario, from planned, timetabled or simulated flows, screened by
 * the OSM buildings round them (over the roofs and round the ends), with first-order facade reflections and the
 * terrain, the buildings and their residents (WorldPop, else the building size) counted by the Directive's
 * reporting bands; compared to another scenario, the difference map in dB; contours and the table for export.
 * Side effects: loads buildings, terrain heights, the population grid and road runs from the API and the noise
 * and rail engines on demand; draws the noise picture and the buildings on the map while shown.
 */
export function NoiseMap({
  map,
  streetLines,
  railway,
  pluginLines = NO_PLUGIN_LINES,
  preferences,
  scenarios,
  roadRuns,
  runNoise = workerRunner,
  loadRail = loadRailEngine,
  fetchTile = fetchBuildingTile,
  fetchTerrain = fetchHeights,
  fetchPeople = fetchPopulation,
  popWaitMs = POP_WAIT_MS,
  popPollMs = POP_POLL_MS,
  screenBuildings = false,
}: Props) {
  const { t } = useI18n();
  const [indicator, setIndicator] = useState<Indicator>("lden");
  const [level, setLevel] = useState<InputLevel>("planned");
  const [mainId, setMainId] = useState(CURRENT);
  const [otherId, setOtherId] = useState("");
  const [runIds, setRunIds] = useState<[string, string]>(["", ""]);
  const [runs, setRuns] = useState<RoadRun[] | null>(null);
  const [withBuildings, setWithBuildings] = useState(screenBuildings);
  const [withTerrain, setWithTerrain] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // The run under way: aborting it cancels the run; `skip` ends the wait for WorldPop.
  const run = useRef<{ abort: AbortController; skip: AbortController } | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const saved = scenarios?.scenarios ?? [];
  const design = (id: string): { name: string; design: Design } | null => {
    if (id === CURRENT) return { name: t("noise.currentDesign"), design: { streetLines, railway } };
    const s = saved.find((x) => x.id === id);
    return s ? { name: s.name, design: { streetLines: s.streetLines, railway: s.railway } } : null;
  };
  const main = design(mainId) ?? design(CURRENT)!;
  const other = otherId ? design(otherId) : null;
  // Cable car and ferry lines are saved with the project, not with a scenario: they belong to the current design.
  const pointsOf = (id: string | null) => (id === CURRENT ? pluginSources(pluginLines) : []);
  const mainPoints = pointsOf(design(mainId) ? mainId : CURRENT);
  const otherPoints = other ? pointsOf(otherId) : [];
  const ready =
    hasLines(main.design) ||
    mainPoints.length > 0 ||
    (!!other && (hasLines(other.design) || otherPoints.length > 0));
  const missingRun = level === "simulated" && (!runIds[0] || (!!other && !runIds[1]));

  useEffect(
    () => () => {
      run.current?.abort.abort();
      if (map) {
        removeNoise(map);
        removeBuildings(map);
      }
    },
    [map],
  );

  // The finished road runs, once the simulated input is chosen.
  useEffect(() => {
    if (level !== "simulated" || runs || !roadRuns) return;
    let live = true;
    roadRuns
      .list()
      .then((list) => live && setRuns(list.filter((r) => r.status === "done")))
      .catch(() => live && setRuns([]));
    return () => {
      live = false;
    };
  }, [level, runs, roadRuns]);

  // Draw the result for the indicator shown: the difference when comparing, else the noise bands.
  useEffect(() => {
    if (!map) return;
    if (status.kind !== "done" || !status.main.view.image) {
      if (status.kind !== "busy") {
        removeNoise(map);
        removeBuildings(map);
      }
      return;
    }
    const img = status.main.view.image;
    const pixels = status.difference ? status.difference.pixels[indicator] : status.main.images?.[indicator];
    if (!pixels) return;
    drawNoise(map, { pixels, width: img.width, height: img.height, coordinates: img.coordinates });
    if (status.difference) removeBuildings(map);
    else
      drawBuildings(map, status.buildings, status.main.view.building_levels, indicator, FROM_DB[indicator]);
  }, [map, status, indicator]);

  // Bring the progress bar, then the result, into view: they appear below the fold of a long panel.
  useEffect(() => {
    if (status.kind === "busy" || status.kind === "done")
      progressRef.current?.nextElementSibling?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [status.kind]);

  async function compute() {
    const abort = new AbortController();
    const skip = new AbortController();
    run.current?.abort.abort();
    run.current = { abort, skip };
    const signal = abort.signal;
    const steps = 2 + (withBuildings ? 2 : 0) + (withTerrain ? 1 : 0) + (other ? 1 : 0);
    let index = 0;
    const step = (text: string, extra: Partial<Busy> = {}) => {
      signal.throwIfAborted();
      setStatus({ kind: "busy", step: text, index, steps, fraction: null, ...extra });
    };
    const progress = (done: number, total: number) =>
      setStatus((s) =>
        s.kind === "busy" && !signal.aborted ? { ...s, fraction: total ? done / total : null } : s,
      );
    try {
      index++;
      step(tNow("noise.collecting"));
      const notes: string[] = [];
      const collect = async (d: { name: string; design: Design }, runId: string) => {
        let roadRun: RoadRunInput | null = null;
        if (level === "simulated" && roadRuns && runId) {
          const r = runs?.find((x) => x.id === runId);
          const [scenario, replay] = await Promise.all([roadRuns.scenario(runId), roadRuns.replay(runId)]);
          roadRun = {
            name: r ? runLabel(r) : runId,
            scenario,
            replay,
            params: r?.params ?? replaySpan(replay),
          };
        }
        const got = await designSources(d.design, level, loadRail, roadRun);
        notes.push(...got.notes.map((n) => (other ? `${d.name}: ${n}` : n)));
        return got.lines;
      };
      const linesA = await abortable(collect(main, runIds[0]), signal);
      const linesB = other ? await abortable(collect(other, runIds[1]), signal) : null;
      signal.throwIfAborted();
      if (!linesA.length && !linesB?.length && !mainPoints.length && !otherPoints.length) {
        setStatus({ kind: "error", text: tNow("noise.drawFirst") });
        return;
      }
      let buildings: NoiseBuilding[] | null = null;
      const points = [
        ...[...linesA, ...(linesB ?? [])].flatMap((l) => l.points),
        ...[...mainPoints, ...otherPoints].map((x) => x.p),
      ];
      const reach = paramNumber("noise.map_reach_m", preferences);
      if (withBuildings) {
        index++;
        const tiles = buildingTiles(points, reach);
        if (tiles.length > MAX_BUILDING_TILES) {
          notes.push(tNow("noise.tooLarge", { tiles: tiles.length, max: MAX_BUILDING_TILES }));
        } else {
          step(tNow("noise.loadingBuildings"), { fraction: 0 });
          buildings = await abortable(loadBuildings(tiles, fetchTile, progress, signal), signal);
        }
      }
      let terrain: NoiseTerrain | null = null;
      if (withTerrain) {
        index++;
        const plan = terrainPlan(points, reach);
        if (!plan) {
          notes.push(tNow("noise.terrainTooLarge"));
        } else {
          step(tNow("noise.loadingTerrain"), { fraction: 0 });
          try {
            terrain = await abortable(loadTerrain(plan, fetchTerrain, progress, signal), signal);
          } catch (err) {
            if (signal.aborted) throw err;
            notes.push(
              tNow("noise.terrainDown", { error: err instanceof Error ? err.message : String(err) }),
            );
          }
        }
      }
      let population: NoisePopulation | null = null;
      let people: PopulationSource | null = null;
      if (withBuildings) index++;
      const bbox = buildings?.length ? buildingsBbox(buildings) : null;
      if (bbox) {
        step(tNow("noise.loadingPopulation"));
        try {
          const a = await waitForPeople(bbox);
          if (a.status === "ready") [population, people] = [a.grid, a.source];
          else if (a.status === "loading")
            notes.push(tNow("noise.popDownloading", { countries: a.countries.join(", ") }));
          else notes.push(tNow("noise.popUnavailable", { reason: a.reason }));
        } catch (err) {
          if (signal.aborted) throw err;
          notes.push(
            tNow("noise.popUnavailable", { reason: err instanceof Error ? err.message : String(err) }),
          );
        }
      }
      const common: Omit<NoiseInput, "lines"> = {
        grid: true,
        grid_reach_m: reach,
        buildings: buildings ?? [],
        terrain,
        population,
        input_level: level,
        overrides: Object.fromEntries(
          Object.entries(preferences ?? {}).filter(([k, v]) => k.startsWith("noise.") && Number.isFinite(v)),
        ),
      };
      // Compared scenarios share one grid: the same cover points and projection origin.
      if (linesB) {
        const cover = [
          ...coverPoints([...linesA, ...linesB]),
          ...[...mainPoints, ...otherPoints].map((x) => x.p),
        ];
        Object.assign(common, { grid_cover: cover, origin: cover[0] });
      }
      index++;
      step(tNow(linesB ? "noise.computingOf" : "noise.computing", { name: main.name }));
      const a = await runNoise({ ...common, lines: linesA, point_sources: mainPoints }, FROM_DB, signal);
      signal.throwIfAborted();
      let b: Computed | null = null;
      let difference: Difference | null = null;
      if (linesB && other) {
        index++;
        step(tNow("noise.computingOf", { name: other.name }));
        const r = await runNoise({ ...common, lines: linesB, point_sources: otherPoints }, FROM_DB, signal);
        signal.throwIfAborted();
        b = { name: other.name, view: r.view, images: r.images, levels: r.levels ?? null };
        difference = differenceOf(a.view, a.levels ?? null, r.levels ?? null);
        if (!difference) notes.push(tNow("noise.noDifference"));
      }
      setStatus({
        kind: "done",
        level,
        main: { name: main.name, view: a.view, images: a.images, levels: a.levels ?? null },
        other: b,
        difference,
        buildings,
        notes,
        people,
      });
    } catch (err) {
      if (signal.aborted) setStatus({ kind: "cancelled" });
      else setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (run.current?.abort === abort) run.current = null;
    }

    /**
     * WorldPop's grid; while the server downloads a country for the first time, ask again until it is
     * there, showing how far the download is, until `popWaitMs` passes or the planner skips the wait.
     */
    async function waitForPeople(box: [number, number, number, number]) {
      const until = Date.now() + popWaitMs;
      for (;;) {
        const a = await abortable(fetchPeople(box), signal);
        signal.throwIfAborted();
        if (a.status !== "loading" || skip.signal.aborted || Date.now() >= until) return a;
        const p = a.progress;
        const mb = (b: number) => formatInt(Math.round(b / 1e6));
        step(
          p?.totalBytes
            ? tNow("noise.popWaiting", {
                countries: a.countries.join(", "),
                received: mb(p.receivedBytes),
                total: mb(p.totalBytes),
              })
            : tNow("noise.popWaitingUnknown", {
                countries: a.countries.join(", "),
                received: mb(p?.receivedBytes ?? 0),
              }),
          { fraction: p?.totalBytes ? p.receivedBytes / p.totalBytes : null, canSkip: true },
        );
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, popPollMs);
          const go = () => {
            clearTimeout(t);
            resolve();
          };
          signal.addEventListener("abort", go, { once: true });
          skip.signal.addEventListener("abort", go, { once: true });
        });
        signal.throwIfAborted();
        if (skip.signal.aborted) return a;
      }
    }
  }

  const select = "min-h-10 w-full rounded border border-slate-300 bg-white px-2 text-xs";
  const runPicker = (side: 0 | 1, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <select
        className={select}
        value={runIds[side]}
        onChange={(e) =>
          setRunIds((ids) => (side === 0 ? [e.target.value, ids[1]] : [ids[0], e.target.value]))
        }
      >
        <option value="">{t("noise.chooseRun")}</option>
        {(runs ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {runLabel(r)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="flex flex-col gap-2" aria-label={t("noise.map")}>
      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t("noise.map")}</h3>
      <p className="text-xs text-slate-600">{t("noise.mapIntro")}</p>
      <div
        role="radiogroup"
        aria-label={t("noise.mapIndicator")}
        className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
      >
        {(
          [
            ["lden", t("noise.lden")],
            ["lnight", "L_night"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={indicator === id}
            onClick={() => setIndicator(id)}
            className={`flex-1 rounded px-1 py-1 text-xs ${indicator === id ? "bg-white font-semibold shadow" : "text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {t("noise.scenario")}
        <select className={select} value={mainId} onChange={(e) => setMainId(e.target.value)}>
          <option value={CURRENT}>{t("noise.currentDesign")}</option>
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        {t("noise.compareTo")}
        <select className={select} value={otherId} onChange={(e) => setOtherId(e.target.value)}>
          <option value="">{t("noise.noComparison")}</option>
          {[{ id: CURRENT, name: t("noise.currentDesign") }, ...saved]
            .filter((s) => s.id !== mainId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="pb-1 text-xs text-slate-600">{t("noise.inputLevel")}</legend>
        {(["planned", "timetabled", "simulated"] as const).map((l) => (
          <label key={l} className="flex items-center gap-2 text-xs">
            <input type="radio" name="noise-input-level" checked={level === l} onChange={() => setLevel(l)} />
            {t(`noise.level.${l}`)}
          </label>
        ))}
      </fieldset>
      {level === "simulated" && (
        <div className="flex flex-col gap-2 rounded border border-slate-200 p-2">
          <p className="text-xs text-slate-600">{t("noise.simulatedIntro")}</p>
          {!roadRuns || (runs && !runs.length) ? (
            <p className="text-xs text-slate-500">{t("noise.noRuns")}</p>
          ) : (
            <>
              {runPicker(0, other ? t("noise.runFor", { name: main.name }) : t("noise.run"))}
              {other && runPicker(1, t("noise.runFor", { name: other.name }))}
            </>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={withBuildings} onChange={(e) => setWithBuildings(e.target.checked)} />
        {t("noise.screen")}
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={withTerrain} onChange={(e) => setWithTerrain(e.target.checked)} />
        {t("noise.terrain")}
      </label>
      <button
        type="button"
        className="btn min-h-10"
        disabled={!ready || missingRun || status.kind === "busy"}
        onClick={() => void compute()}
      >
        {t(status.kind === "done" ? "noise.computeAgain" : "noise.compute")}
      </button>
      {!ready && <p className="text-xs text-slate-500">{t("noise.drawFirst")}</p>}
      {/* The bar and then the result sit below the options: keep them in view when a run starts and ends. */}
      <div ref={progressRef} className="contents" />
      {status.kind === "busy" && (
        <JobProgress
          label={t("noise.map")}
          step={status.step}
          index={status.index}
          steps={status.steps}
          fraction={status.fraction}
          onCancel={() => run.current?.abort.abort()}
          skipLabel={status.canSkip ? t("noise.popSkip") : undefined}
          onSkip={() => run.current?.skip.abort()}
        />
      )}
      {status.kind === "cancelled" && <p className="text-xs text-slate-600">{t("noise.cancelled")}</p>}
      {status.kind === "error" && (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{status.text}</p>
      )}
      {status.kind === "done" && <NoiseResult result={status} indicator={indicator} />}
    </section>
  );
}

/** Purpose: a road run in the picker: when it ran and its period. */
function runLabel(r: RoadRun): string {
  const hh = (s: number) =>
    `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  const when = new Date(r.finishedAt ?? r.createdAt).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
  return tNow("noise.runLabel", { when, from: hh(r.params.from_s), to: hh(r.params.to_s) });
}

/** Purpose: the period a replay covers, for a run whose settings are not in the list. */
function replaySpan(r: { begin: number; frames: number; frame_s: number }) {
  return { from_s: r.begin, to_s: r.begin + Math.max(0, r.frames - 1) * r.frame_s };
}

/** Purpose: the difference map of two estimates on one grid, or null when either has no grid levels. */
function differenceOf(view: NoiseView, a: NoiseLevels | null, b: NoiseLevels | null): Difference | null {
  const img = view.image;
  if (!img || !a || !b || a.lden.length !== b.lden.length || a.lden.length !== img.width * img.height)
    return null;
  const levels = {
    lden: differenceLevels(a.lden, b.lden, FROM_DB.lden),
    lnight: differenceLevels(a.lnight, b.lnight, FROM_DB.lnight),
  };
  return {
    levels,
    pixels: {
      lden: differencePixels(levels.lden, img.width, img.height),
      lnight: differencePixels(levels.lnight, img.width, img.height),
    },
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JobProgress } from "../../shell/JobProgress";
import { parseClock } from "../journey-planner/format";
import { useI18n } from "../../i18n/i18n";
import { paramValue } from "../benefits/params";
import type { SavedStreetLine } from "../street-lines/saved";
import type { Network } from "../railways/types";
import { RunSettings } from "./CapacityForm";
import { type LineState, RunResults, StreetResults } from "./CapacityResults";
import { projectRunSettings } from "./projectSettings";
import { every, serverStatus, VERDICTS } from "./capacityText";
import { buildDrawnNetwork, type DrawnProblem, drawnProblem } from "./drawn";
import { loadWorkerEngine } from "./engine";
import { PERIODS, pickStreetParams, railLoadPlans, streetLoadPlans } from "./loadPlans";
import { type LineLoad, type LoadLine, lineLoad } from "./loads";
import { dwellModel, stopDwells, type StopDwells, trainsPerHour, withStopDwells } from "./dwells";
import { engineLines } from "../railways/serviceLines";
import { paramNumber } from "../../workspace/preferences";
import {
  type Boardings,
  estimatedBoardings,
  lineBoardings,
  loadZones,
  type RidershipInput,
  type RidershipZones,
} from "./ridership";
import { type DemandRidership, demandStopBoardings } from "../demand/ridership";
import { SavedRunBar, SavedRunsList } from "./SavedRuns";
import { hashText, inputKey } from "../../projects/inputKey";
import { type ResultsApi, useSavedResult } from "../../projects/results";
import { SavedResultNotice } from "../../projects/SavedResultNotice";
import {
  circuit,
  runStreetLine,
  STREET_RUN_DEFAULTS,
  type StreetLineResult,
  type StreetRunParams,
} from "./streetRun";
import { isOpen, type RunsApi, type SavedRun, type SavedRunDetail, type ServerNetwork } from "./server";
import type {
  CapacityEngine,
  CapacityParams,
  CapacityRun as Run,
  EngineLoader,
  LineInfo,
  NetworkSource,
} from "./types";
import { engineErrorText, type EngineMsg, type EngineNote, useEngineText } from "../../i18n/engine";
import { FindingsList } from "../advice/Findings";
import { capacityFindings } from "./advice";
import { crowdLinks, drawCrowding, removeCrowding, stopPlaces } from "./crowdMap";
import { topologyLocator } from "./place";
import type { Map as MapLibreMap } from "maplibre-gl";
import { ReplayPlayer } from "../road-sim/ReplayPlayer";
import type { Replay } from "../road-sim/types";
import { streetLineColor } from "../street-lines/saved";
import { type PreferencesDoc, vehicleVisualsFrom } from "../../workspace/preferences";
import { REPLAY_FRAME_S, systemReplay } from "./systemReplay";

export { explain, practicalMaximum, VERDICTS, verdictText } from "./capacityText";

const NO_STREETS: readonly SavedStreetLine[] = [];

/** The last test run in this browser, as the project keeps it, with the choices it was run with. */
interface SavedTest {
  run: Run;
  lines: LineState[];
  notes: EngineNote[];
  streetResults: StreetLineResult[];
  loads: Record<string, LineLoad>;
  choices: {
    period: string;
    from: string;
    to: string;
    sweep: boolean;
    withLoads: boolean;
  };
}
const NO_BOARDINGS: Boardings = {};
const DRAWN_PROBLEMS: Record<DrawnProblem, true> = { noTrack: true, noLines: true, errors: true };

interface Props {
  /** Where the panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: EngineLoader;
  /** The railway drawn in the project, with its service lines. */
  railway?: Network | null;
  /** Builds the drawn railway for the test; tests inject a fake. */
  buildDrawn?: typeof buildDrawnNetwork;
  /** The project's street lines, run along their routes with traffic delays. */
  streetLines?: readonly SavedStreetLine[];
  /** What the Tables tab's ridership estimate needs; passenger loads are left out without it. */
  ridership?: RidershipInput | null;
  /** The demand model run the planner picked for ridership: its boardings by stop replace the estimate. */
  demandRidership?: DemandRidership | null;
  /** The planner's own weekday boardings per station or stop. */
  ownBoardings?: Boardings;
  /** Saves them; absent when the project is read-only. */
  onOwnBoardings?: (b: Boardings) => void;
  /** Loads the estimate's zones; tests inject a fake. */
  loadRidership?: (input: RidershipInput) => Promise<RidershipZones>;
  /** The project's values (Project preferences), for vehicle places and the load shares. */
  prefs?: Record<string, number>;
  /** The project's saved runs on the server; without it the panel only runs in the browser. */
  runs?: RunsApi | null;
  /** Whether the reader may start and stop runs on the server (Owners and Editors). */
  canRun?: boolean;
  /** Milliseconds between checks of runs that are still going (tests make it short). */
  pollMs?: number;
  /** The project's saved results: the last test run in this browser shows again on opening. */
  results?: ResultsApi | null;
  /** The map, for the crowding by link and the findings' places; none in tests. */
  map?: MapLibreMap | null;
  /** The vehicle colours of the replay (Project preferences → Visuals). */
  visuals?: PreferencesDoc["visuals"];
}

/**
 * The simulator tab's "Test the system" panel. It always tests what is drawn in the project: the railway and
 * its service lines, and the street lines. The planner picks a period. Rail lines are
 * planned with the timetable planner, measured for UIC 406 capacity, run through the interlocking, repeated
 * with random delays, and tried at other frequencies to find the most each line can carry. Street lines run
 * their timetables along their routes with traffic delays that vary from trip to trip. Passenger loads come
 * from the Tables tab's ridership estimate or the planner's own boardings. Plain verdicts first, numbers
 * behind them.
 */
export function CapacityRun({
  panel = null,
  loadEngine = loadWorkerEngine,
  railway = null,
  buildDrawn = buildDrawnNetwork,
  streetLines = NO_STREETS,
  ridership = null,
  demandRidership = null,
  ownBoardings = NO_BOARDINGS,
  onOwnBoardings,
  loadRidership = loadZones,
  prefs,
  runs = null,
  canRun = false,
  pollMs = 2000,
  results = null,
  map = null,
  visuals,
}: Props) {
  const { t, language } = useI18n();
  const tx = useEngineText();
  // The topology of the network last run in this browser, to place the advice's signals on the map.
  const [runTopology, setRunTopology] = useState<string | null>(null);
  const locate = useMemo(() => topologyLocator(runTopology), [runTopology]);
  const [crowdOnMap, setCrowdOnMap] = useState(true);
  const vehicleVisuals = useMemo(() => vehicleVisualsFrom({ values: {}, visuals }), [visuals]);
  // The period of the last run that finished in this browser, for its replay on the map.
  const [replayFor, setReplayFor] = useState<{
    id: number;
    w: { from_s: number; to_s: number };
    rail: boolean;
  } | null>(null);
  // Why the replay's trains stop early (a deadlock), if they do.
  const [replayStopped, setReplayStopped] = useState<{ text: string; msg?: EngineMsg | null } | null>(null);
  const drawn = drawnProblem(railway);
  const streets = useMemo(
    () => streetLines.map((line, index) => ({ line, index })).filter(({ line }) => circuit(line) !== null),
    [streetLines],
  );
  const drawnReady = drawn === null || streets.length > 0;
  const [period, setPeriod] = useState<string>("am");
  const [from, setFrom] = useState("07:00");
  const [to, setTo] = useState("09:00");
  const [sweep, setSweep] = useState(true);
  const [withLoads, setWithLoads] = useState(true);
  const [advanced, setAdvanced] = useState<Partial<CapacityParams>>({});
  // The project's values (All parameters) under the settings changed for this run.
  const settings = useMemo(() => ({ ...projectRunSettings(prefs), ...advanced }), [prefs, advanced]);
  const [status, setStatus] = useState<string | null>(null);
  // How far the run in this browser is: the step (from 1) of the steps it will take, and how far into it.
  type Phase = "build" | "load" | "plan" | "sweep" | "loads";
  const [progress, setProgress] = useState<{ index: number; steps: number; fraction: number | null } | null>(
    null,
  );
  const phases = useRef<Phase[]>([]);
  const phase = (p: Phase, fraction: number | null = null) => {
    const i = phases.current.indexOf(p);
    if (i >= 0) setProgress({ index: i + 1, steps: phases.current.length, fraction });
  };
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [notes, setNotes] = useState<EngineNote[]>([]);
  const [streetResults, setStreetResults] = useState<StreetLineResult[]>([]);
  const [loads, setLoads] = useState<Record<string, LineLoad>>({});
  const [zones, setZones] = useState<RidershipZones | null>(null);
  const engine = useRef<{ key: string; engine: CapacityEngine } | null>(null);
  const zonesRun = useRef<{ key: string; zones: Promise<RidershipZones> } | null>(null);
  const generation = useRef(0);
  // Runs saved on the server: the project's list, and the one open in the panel (null: the browser's run).
  const [saved, setSaved] = useState<SavedRun[]>([]);
  const [viewing, setViewing] = useState<SavedRunDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!runs) return;
    let live = true;
    void runs.list().then(
      (l) => live && setSaved(l),
      (e: unknown) => live && setServerError(engineErrorText(e)),
    );
    return () => {
      live = false;
    };
  }, [runs]);

  // While a run is still going, check on it (and on the list) until it is settled.
  const viewingId = viewing?.id ?? null;
  const viewingOpen = viewing !== null && isOpen(viewing);
  const listOpen = saved.some(isOpen);
  useEffect(() => {
    if (!runs || (!viewingOpen && !listOpen)) return;
    let live = true;
    const timer = setInterval(() => {
      void runs.list().then(
        (l) => live && setSaved(l),
        () => undefined,
      );
      if (viewingId && viewingOpen)
        void runs.get(viewingId).then(
          (r) => live && setViewing((v) => (v?.id === r.id ? r : v)),
          () => undefined,
        );
    }, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [runs, viewingId, viewingOpen, listOpen, pollMs]);

  useEffect(
    () => () => {
      generation.current++;
      engine.current?.engine.dispose();
    },
    [],
  );

  const periodWindow = (): { from_s: number; to_s: number } | null => {
    const preset = PERIODS.find((p) => p.id === period);
    if (preset) return { from_s: preset.from, to_s: preset.to };
    const a = parseClock(from);
    const b = parseClock(to);
    if (a === null || b === null || b <= a) return null;
    return { from_s: a, to_s: b };
  };

  const ready = drawnReady;
  const busy = status !== null;

  // The drawn lines without their service bands (for the boardings editor before a run).
  const plans = useMemo(
    () => [
      ...(drawn === null && railway ? railLoadPlans(railway, []) : []),
      ...streetLoadPlans(streets, prefs),
    ],
    [drawn, railway, streets, prefs],
  );
  const stopNames = useMemo(() => [...new Set(plans.flatMap((p) => p.sequences.flat()))], [plans]);
  const linesAt = (n: string) => plans.filter((p) => p.sequences.some((s) => s.includes(n))).length;
  const estimates = useMemo(() => {
    if (!zones && !demandRidership) return null;
    const out: Record<string, number> = {};
    for (const p of zones ? plans : []) {
      const e = estimatedBoardings(
        zones!.zones,
        p.mode,
        [...new Set(p.sequences.flat())],
        prefs,
        ridership?.doc ?? null,
      );
      for (const [n, v] of Object.entries(e)) out[n] = (out[n] ?? 0) + v;
    }
    if (demandRidership)
      Object.assign(
        out,
        demandStopBoardings(stopNames, demandRidership, () => 1),
      );
    return out;
  }, [zones, plans, prefs, ridership?.doc, demandRidership, stopNames]);

  /** Loads the estimate's zones once per published network. */
  const ensureZones = (): Promise<RidershipZones> | null => {
    if (!ridership) return null;
    const key = JSON.stringify([ridership.timetable, ridership.regions, ridership.prefs, ridership.country]);
    if (zonesRun.current?.key !== key) {
      const z = loadRidership(ridership);
      zonesRun.current = { key, zones: z };
      void z.then(
        (v) => zonesRun.current?.key === key && setZones(v),
        () => undefined,
      );
    }
    return zonesRun.current.zones;
  };

  const loadShares = () => ({
    peakHour: paramValue("benefit.ridership.peak_hour_share", "*", prefs)[1],
    peakDirection: paramValue("benefit.ridership.peak_direction_share", "*", prefs)[1],
  });

  /** Purpose: the weekday boardings at a line's stops: the estimate, the demand run's, the planner's own. */
  const boardingsOf = (p: { mode: string; sequences: string[][] }, z: RidershipZones) => {
    const names = [...new Set(p.sequences.flat())];
    const est = {
      ...estimatedBoardings(z.zones, p.mode, names, prefs, ridership?.doc ?? null),
      ...(demandRidership ? demandStopBoardings(names, demandRidership, linesAt) : {}),
    };
    return lineBoardings(names, est, ownBoardings, linesAt);
  };

  /** The estimate's zones; an estimate that fails leaves the loads without boardings. */
  const zonesNow = () => ensureZones()!.catch(() => ({ zones: [], notes: [] }) as RidershipZones);

  /**
   * Purpose: with passenger loads on, how long the drawn trains stand at each stop: longer where many people
   * board and alight (dwells.ts). Null when the run has no loads or no drawn trains.
   */
  const trainDwells = async (
    w: { from_s: number; to_s: number },
    alive: () => boolean,
    show = true,
  ): Promise<{ zones: RidershipZones; byLine: Record<string, StopDwells> } | null> => {
    if (drawn !== null || !railway || !withLoads || !ridership) return null;
    if (show) {
      phase("loads");
      setStatus(t("capacity.loads.estimating"));
    }
    const z = await zonesNow();
    if (!alive()) return null;
    const shares = loadShares();
    const plans = new Map(railLoadPlans(railway, []).map((p) => [p.id, p]));
    const byLine: Record<string, StopDwells> = {};
    for (const l of engineLines(railway, railway.lines ?? [], prefs)) {
      const p = plans.get(l.id);
      if (!p) continue;
      const line: LoadLine = { ...p, perHour: (h) => trainsPerHour(l, h), boardings: boardingsOf(p, z) };
      const usual = l.dwell_s ?? paramNumber("mode.dwell_s", prefs, l.mode);
      byLine[l.id] = stopDwells(
        line,
        l.vehicle.length_m * l.units,
        usual,
        dwellModel(prefs, l.mode),
        w.from_s,
        w.to_s,
        shares,
      );
    }
    return { zones: z, byLine };
  };

  /** Runs the street lines and works out the passenger loads of the drawn lines. */
  const drawnExtras = async (
    w: { from_s: number; to_s: number },
    infos: LineInfo[],
    alive: () => boolean,
    dwells: { zones: RidershipZones; byLine: Record<string, StopDwells> } | null = null,
  ) => {
    const params: StreetRunParams = { ...STREET_RUN_DEFAULTS, ...pickStreetParams(settings), ...w };
    setStreetResults(
      streets.flatMap(({ line, index }) => {
        const r = runStreetLine(line, index, params);
        return r ? [r] : [];
      }),
    );
    if (!withLoads || !ridership) return;
    let z = dwells?.zones;
    if (!z) {
      phase("loads");
      setStatus(t("capacity.loads.estimating"));
      z = await zonesNow();
      if (!alive()) return;
    }
    const shares = loadShares();
    const all = [
      ...(drawn === null && railway ? railLoadPlans(railway, infos) : []),
      ...streetLoadPlans(streets, prefs),
    ];
    const out: Record<string, LineLoad> = {};
    for (const p of all) {
      const line: LoadLine = { ...p, boardings: boardingsOf(p, z) };
      out[p.key] = lineLoad(line, w.from_s, w.to_s, shares);
      const longest = p.key.startsWith("rail:") ? dwells?.byLine[p.id]?.longest : null;
      if (longest) out[p.key]!.dwell = longest;
    }
    setLoads(out);
  };

  // What a test run works from: the drawn network, the period and the settings. The last run in this browser is
  // saved with the project and shows again on opening; it is out of date once any of these change.
  const capInputs = inputKey({
    // Kept in the key so runs saved before the test always used the drawn network still match.
    source: "drawn",
    network: hashText(JSON.stringify([railway, streetLines])),
    period,
    from,
    to,
    sweep,
    withLoads,
    settings,
    loads: withLoads
      ? hashText(JSON.stringify([ridership?.doc ?? null, demandRidership, ownBoardings]))
      : null,
  });
  const kept = useSavedResult<SavedTest>(results, "capacity-test", capInputs, canRun);
  const [finished, setFinished] = useState<string | null>(null);
  useEffect(() => {
    if (!finished || !run) return;
    kept.save(
      {
        run,
        lines,
        notes,
        streetResults,
        loads,
        choices: { period, from, to, sweep, withLoads },
      },
      finished,
    );
    setFinished(null);
    // Saved once, with the state the finished run left.
  }, [finished]);
  const restored = useRef(false);
  useEffect(() => {
    const s = kept.saved;
    if (!s || restored.current) return;
    restored.current = true;
    if (run || busy) return;
    const c = s.value.choices;
    setPeriod(c.period);
    setFrom(c.from);
    setTo(c.to);
    setSweep(c.sweep);
    setWithLoads(c.withLoads);
    setRun(s.value.run);
    setLines(s.value.lines);
    setNotes(s.value.notes);
    setStreetResults(s.value.streetResults);
    setLoads(s.value.loads);
    // Restored once, when the saved run has loaded.
  }, [kept.saved]);

  /** What the engine is loaded from, before the stops' dwells. */
  const baseKey = () => `drawn|${JSON.stringify(railway)}`;

  const start = async () => {
    const runKey = capInputs;
    let failed = false;
    setReplayFor(null);
    const w = periodWindow();
    if (!w) {
      setError(t("capacity.badPeriod"));
      return;
    }
    const gen = ++generation.current;
    const alive = () => gen === generation.current;
    setViewing(null);
    setError(null);
    setRun(null);
    setLines([]);
    setStreetResults([]);
    setLoads({});
    const railOn = drawn === null;
    // With loads, the drawn trains' dwells come from them first: they are part of the network the engine loads.
    const loadsFirst = railOn && withLoads && ridership !== null;
    const withLoadsStep = withLoads && ridership !== null;
    const rest = (fresh: boolean): Phase[] => [
      ...(fresh ? (["build", "load"] as const) : []),
      ...(railOn ? (["plan"] as const) : []),
      ...(railOn && sweep ? (["sweep"] as const) : []),
    ];
    // The steps this run will take, so the bar can say how far along it is.
    phases.current = loadsFirst
      ? ["loads", ...rest(true)]
      : [
          ...rest(railOn && engine.current?.key !== baseKey()),
          ...(withLoadsStep ? (["loads"] as const) : []),
        ];
    setProgress(null);
    try {
      const dwells = loadsFirst ? await trainDwells(w, alive) : null;
      if (loadsFirst && !alive()) return;
      const dwellsBy = Object.fromEntries(
        Object.entries(dwells?.byLine ?? {}).map(([id, d]) => [id, d.dwells]),
      );
      const key = dwells ? `${baseKey()}|${JSON.stringify(dwellsBy)}` : baseKey();
      if (loadsFirst) phases.current = ["loads", ...rest(engine.current?.key !== key)];
      if (!railOn) {
        await drawnExtras(w, [], alive);
        return;
      }
      if (engine.current?.key !== key) {
        engine.current?.engine.dispose();
        engine.current = null;
        phase("build");
        setStatus(t("capacity.building"));
        const built = await buildDrawn(railway, undefined, undefined, prefs);
        if (!alive()) return;
        if (typeof built === "string") {
          setError(t(`capacity.drawn.${built}`));
          return;
        }
        const src: NetworkSource = { ...built, lines: withStopDwells(built.lines, dwellsBy) };
        setRunTopology(src.topology);
        phase("load");
        setStatus(t("capacity.loading"));
        const e = await loadEngine(src);
        if (!alive()) return e.dispose();
        engine.current = { key, engine: e };
      }
      const e = engine.current.engine;
      const params = { ...settings, ...w };
      setNotes(await e.notes());
      const infos = await e.lines();
      phase("plan");
      setStatus(t("capacity.planning"));
      const r = await e.run(params);
      if (!alive()) return;
      setRun(r);
      const states: LineState[] = r.lines.map((l) => ({
        info: infos.find((i) => i.id === l.line) ?? { id: l.line, name: l.name, bands: [] },
        planned: l.planned,
        sweep: [],
        sweeping: sweep,
      }));
      setLines(states);
      await drawnExtras(w, infos, alive, dwells);
      if (!alive()) return;
      if (sweep) {
        for (let k = 0; k < states.length; k++) {
          const li = infos.findIndex((i) => i.id === states[k]!.info.id);
          const works = VERDICTS[states[k]!.planned.verdict].rank <= 1;
          const hs = await e.sweepHeadways(params, li, works);
          for (let j = 0; j < hs.length; j++) {
            if (!alive()) return;
            // Each line is an equal share of the sweep; within it, the headways tried so far.
            phase("sweep", (k + j / hs.length) / states.length);
            setStatus(
              t("capacity.trying", {
                line: states[k]!.info.name,
                every: every(hs[j]!, t),
                n: j + 1,
                total: hs.length,
              }),
            );
            const pt = await e.sweepPoint(params, li, hs[j]!);
            if (!alive()) return;
            states[k] = { ...states[k]!, sweep: [...states[k]!.sweep, pt] };
            setLines([...states]);
            // Shorter headways only get harder: stop after two in a row that do not fit.
            const last = states[k]!.sweep.slice(-2);
            if (works && last.length === 2 && last.every((x) => x.verdict === "not_enough_capacity")) break;
          }
          states[k] = { ...states[k]!, sweeping: false };
          setLines([...states]);
        }
      }
    } catch (err) {
      failed = true;
      if (alive()) setError(engineErrorText(err));
    } finally {
      if (alive()) {
        setStatus(null);
        setProgress(null);
        if (!failed && runKey) setFinished(runKey);
        if (!failed) setReplayFor({ id: gen, w, rail: railOn });
      }
    }
  };

  /** Purpose: start the same run on the server, saved to the project, and open it in the panel. */
  const startOnServer = async () => {
    if (!runs) return;
    const w = periodWindow();
    if (!w) {
      setServerError(t("capacity.badPeriod"));
      return;
    }
    // The server runs the rail test only: the drawn railway and its service lines.
    if (drawn !== null) {
      setServerError(t(`capacity.drawn.${drawn}`));
      return;
    }
    setSending(true);
    const built = await buildDrawn(railway, undefined, undefined, prefs).catch((e: unknown) =>
      engineErrorText(e),
    );
    setSending(false);
    if (typeof built === "string") {
      setServerError(built in DRAWN_PROBLEMS ? t(`capacity.drawn.${built as DrawnProblem}`) : built);
      return;
    }
    setSending(true);
    const dwells = await trainDwells(w, () => true, false).catch(() => null);
    setSending(false);
    const dwellsBy = Object.fromEntries(
      Object.entries(dwells?.byLine ?? {}).map(([id, d]) => [id, d.dwells]),
    );
    const network: ServerNetwork = {
      kind: "files",
      topology: built.topology,
      topologyName: t("capacity.drawn"),
      lines: withStopDwells(built.lines, dwellsBy),
      linesName: t("capacity.drawn"),
    };
    const params = Object.fromEntries(
      Object.entries({ ...settings, ...w }).filter(([, v]) => v !== undefined),
    ) as SavedRun["params"];
    setSending(true);
    setServerError(null);
    try {
      const r = await runs.start(network, params, sweep);
      generation.current++;
      setStatus(null);
      setViewing(r);
      setSaved((l) => [r, ...l.filter((x) => x.id !== r.id)]);
    } catch (e) {
      setServerError(engineErrorText(e));
    } finally {
      setSending(false);
    }
  };

  /** Purpose: open a saved run in the panel. */
  const open = async (id: string) => {
    if (!runs) return;
    setServerError(null);
    try {
      const r = await runs.get(id);
      generation.current++;
      setStatus(null);
      setConfirmDelete(false);
      setViewing(r);
    } catch (e) {
      setServerError(engineErrorText(e));
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);

  /** Purpose: run the open saved run again with its own settings; its old result is replaced. */
  const rerunSaved = async () => {
    if (!runs || !viewing) return;
    setServerError(null);
    try {
      const r = await runs.rerun(viewing.id);
      setViewing(r);
      setSaved((l) => [r, ...l.filter((x) => x.id !== r.id)]);
    } catch (e) {
      setServerError(engineErrorText(e));
    }
  };

  /** Purpose: delete the open saved run for everyone. */
  const deleteSaved = async () => {
    if (!runs || !viewing) return;
    const id = viewing.id;
    setServerError(null);
    try {
      await runs.remove(id);
      setConfirmDelete(false);
      setViewing(null);
      setSaved((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      setServerError(engineErrorText(e));
    }
  };

  /** Purpose: stop the open saved run; the server keeps what it found so far. */
  const cancelSaved = async () => {
    if (!runs || !viewing) return;
    try {
      const r = await runs.cancel(viewing.id);
      setViewing(r);
      setSaved((l) => l.map((x) => (x.id === r.id ? r : x)));
    } catch (e) {
      setServerError(engineErrorText(e));
    }
  };

  const stop = () => {
    // The worker finishes its current step; later results are ignored and the sweep ends.
    generation.current++;
    setStatus(null);
    setProgress(null);
    setLines((ls) => ls.map((l) => ({ ...l, sweeping: false })));
  };

  // What the panel shows: the open saved run, or the run in this browser.
  const places = useMemo(
    () =>
      stopPlaces(
        railway,
        Object.keys(loads).filter((k) => k.startsWith("rail:")),
        streets,
      ),
    [railway, loads, streets],
  );
  const crowd = useMemo(() => crowdLinks(loads, places), [loads, places]);
  useEffect(() => {
    if (!map) return;
    if (crowdOnMap && crowd.length > 0) drawCrowding(map, crowd);
    else removeCrowding(map);
  }, [map, crowd, crowdOnMap]);
  useEffect(() => () => void (map && removeCrowding(map)), [map]);
  const shownRun: Run | null = viewing ? (viewing.result?.run ?? null) : run;
  const shownLines: LineState[] = viewing ? (viewing.result?.lines ?? []) : lines;
  const shownNotes: EngineNote[] = viewing ? (viewing.result?.notes ?? []) : notes;
  const shownStatus = viewing ? (isOpen(viewing) ? serverStatus(viewing, t) : null) : status;
  const shownError = viewing ? (viewing.status === "failed" ? viewing.error : null) : error;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });

  /** Purpose: the replay of the last run in this browser: the trains and the street line vehicles together. */
  const loadReplay = useCallback(async (): Promise<Replay> => {
    if (!replayFor) throw new Error("no run to replay");
    const w = replayFor.w;
    const e = replayFor.rail ? engine.current?.engine : undefined;
    const railReplay = e && locate ? await e.replay({ ...settings, ...w }, REPLAY_FRAME_S) : null;
    setReplayStopped(railReplay?.stopped ? { text: railReplay.stopped, msg: railReplay.stopped_msg } : null);
    const colors = Object.fromEntries((railway?.lines ?? []).map((l) => [l.id, l.color]));
    const r = systemReplay(
      railReplay && locate ? { replay: railReplay, locate, colors } : null,
      streets.map(({ line, index }) => ({ line, index, color: streetLineColor(line) })),
      { ...STREET_RUN_DEFAULTS, ...pickStreetParams(settings), ...w },
    );
    if (!r) throw new Error(t("capacity.replay.none"));
    return r;
    // Made once per finished run: later edits to the settings do not change the run it replays.
  }, [replayFor]);

  const body = (
    <section aria-label={t("capacity.title")} className="space-y-4 px-4 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("capacity.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("capacity.intro")}</p>
      </div>

      <RunSettings
        period={period}
        setPeriod={setPeriod}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
        sweep={sweep}
        setSweep={setSweep}
        showLoads={!!ridership}
        withLoads={withLoads}
        setWithLoads={setWithLoads}
        stopNames={stopNames}
        estimates={estimates}
        ownBoardings={ownBoardings}
        onOwnBoardings={onOwnBoardings}
        ensureZones={ensureZones}
        advanced={settings}
        setAdvanced={setAdvanced}
      />

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-pri flex-1"
          disabled={!ready || busy}
          onClick={() => void start()}
        >
          {run && !viewing ? t("capacity.runAgain") : t("capacity.run")}
        </button>
        {/* With a progress bar, its Cancel stops the run. */}
        {busy && !progress && (
          <button type="button" className="btn" onClick={stop}>
            {t("capacity.stop")}
          </button>
        )}
      </div>
      {run && !viewing && kept.saved?.value.run === run && kept.state && (
        <SavedResultNotice
          state={kept.state}
          computedAt={kept.saved.computedAt}
          onRecalculate={ready && !busy ? () => void start() : null}
          error={kept.error}
        />
      )}
      {runs && canRun && (
        <div className="space-y-1">
          <button
            type="button"
            className="btn w-full"
            disabled={!ready || sending}
            onClick={() => void startOnServer()}
          >
            {t("capacity.runServer")}
          </button>
          <p className="text-xs text-slate-600">{t("capacity.serverHint")}</p>
        </div>
      )}
      {!ready && drawn !== null && <p className="text-xs text-slate-600">{t(`capacity.drawn.${drawn}`)}</p>}
      {serverError && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {serverError}
        </p>
      )}

      {runs && <SavedRunsList saved={saved} viewing={viewing} open={open} when={when} />}

      {viewing && (
        <SavedRunBar
          viewing={viewing}
          canRun={canRun}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          close={() => {
            setConfirmDelete(false);
            setViewing(null);
          }}
          cancelSaved={cancelSaved}
          rerunSaved={rerunSaved}
          deleteSaved={deleteSaved}
          when={when}
        />
      )}
      {!viewing && status && progress ? (
        <JobProgress
          label={t("capacity.title")}
          step={status}
          index={progress.index}
          steps={progress.steps}
          fraction={progress.fraction}
          onCancel={stop}
        />
      ) : (
        shownStatus && (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-700">
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-blue-700 border-t-transparent"
              aria-hidden
            />
            {shownStatus}
          </p>
        )
      )}
      {shownError && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {shownError}
        </p>
      )}

      {!shownStatus && (shownRun || streetResults.length > 0) && (
        <>
          <FindingsList
            findings={capacityFindings(
              shownLines,
              shownRun?.params.occupancy_limit_share ?? 0.85,
              loads,
              streetResults,
              t,
              tx,
              viewing ? null : locate,
              places,
            )}
            onShow={map ? (at) => map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 15.5) }) : undefined}
          />
          {map && crowd.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={crowdOnMap} onChange={(e) => setCrowdOnMap(e.target.checked)} />
              {t("advice.crowdMap")}
            </label>
          )}
        </>
      )}
      {shownRun && <RunResults run={shownRun} lines={shownLines} notes={shownNotes} loads={loads} />}

      <StreetResults results={streetResults} loads={loads} advanced={settings} prefs={prefs} />

      {replayFor && !viewing && !status && (
        <ReplayPlayer
          key={replayFor.id}
          load={loadReplay}
          map={map}
          visuals={vehicleVisuals}
          title={t("capacity.replay.title")}
        >
          <p className="text-xs text-slate-600">{t("capacity.replay.note")}</p>
          {replayStopped && (
            <p className="text-xs text-amber-900">
              {t("capacity.replay.stopped", { why: tx(replayStopped) })}
            </p>
          )}
        </ReplayPlayer>
      )}
    </section>
  );
  return panel ? createPortal(body, panel) : body;
}

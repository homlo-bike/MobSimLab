import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseClock } from "../journey-planner/format";
import { useI18n } from "../../i18n/i18n";
import { paramValue } from "../benefits/params";
import type { SavedStreetLine } from "../street-lines/saved";
import type { Network } from "../railways/types";
import { NetworkPicker, RunSettings } from "./CapacityForm";
import { type LineState, RunResults, StreetResults } from "./CapacityResults";
import { every, serverStatus, VERDICTS } from "./capacityText";
import { buildDrawnNetwork, type DrawnProblem, drawnProblem } from "./drawn";
import { loadWorkerEngine } from "./engine";
import { PERIODS, pickStreetParams, railLoadPlans, streetLoadPlans } from "./loadPlans";
import { type LineLoad, type LoadLine, lineLoad } from "./loads";
import {
  type Boardings,
  estimatedBoardings,
  lineBoardings,
  loadZones,
  type RidershipInput,
  type RidershipZones,
} from "./ridership";
import { SavedRunBar, SavedRunsList } from "./SavedRuns";
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

export { explain, practicalMaximum, VERDICTS, verdictText } from "./capacityText";

const NO_STREETS: readonly SavedStreetLine[] = [];
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
}

/**
 * The simulator tab's "Test the system" panel. The planner picks a network (the lines drawn in the project,
 * the example metro, or the railway editor's track topology with a lines file) and a period. Rail lines are
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
  ownBoardings = NO_BOARDINGS,
  onOwnBoardings,
  loadRidership = loadZones,
  prefs,
  runs = null,
  canRun = false,
  pollMs = 2000,
}: Props) {
  const { t, language } = useI18n();
  const drawn = drawnProblem(railway);
  const streets = useMemo(
    () => streetLines.map((line, index) => ({ line, index })).filter(({ line }) => circuit(line) !== null),
    [streetLines],
  );
  const drawnReady = drawn === null || streets.length > 0;
  // Until the planner picks one: the lines drawn in the project when there are any, else the example.
  const [picked, setSource] = useState<"example" | "drawn" | "files" | null>(null);
  const source = picked ?? (drawnReady ? "drawn" : "example");
  const [topology, setTopology] = useState<{ name: string; text: string } | null>(null);
  const [linesFile, setLinesFile] = useState<{ name: string; text: string } | null>(null);
  const [period, setPeriod] = useState<string>("am");
  const [from, setFrom] = useState("07:00");
  const [to, setTo] = useState("09:00");
  const [sweep, setSweep] = useState(true);
  const [withLoads, setWithLoads] = useState(true);
  const [advanced, setAdvanced] = useState<Partial<CapacityParams>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
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
      (e: unknown) => live && setServerError(e instanceof Error ? e.message : String(e)),
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

  const ready =
    source === "example" || (source === "drawn" ? drawnReady : topology !== null && linesFile !== null);
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
    if (!zones) return null;
    const out: Record<string, number> = {};
    for (const p of plans) {
      const e = estimatedBoardings(
        zones.zones,
        p.mode,
        [...new Set(p.sequences.flat())],
        prefs,
        ridership?.doc ?? null,
      );
      for (const [n, v] of Object.entries(e)) out[n] = (out[n] ?? 0) + v;
    }
    return out;
  }, [zones, plans, prefs, ridership?.doc]);

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

  /** Runs the street lines and works out the passenger loads of the drawn lines. */
  const drawnExtras = async (
    w: { from_s: number; to_s: number },
    infos: LineInfo[],
    alive: () => boolean,
  ) => {
    const params: StreetRunParams = { ...STREET_RUN_DEFAULTS, ...pickStreetParams(advanced), ...w };
    setStreetResults(
      streets.flatMap(({ line, index }) => {
        const r = runStreetLine(line, index, params);
        return r ? [r] : [];
      }),
    );
    if (!withLoads || !ridership) return;
    setStatus(t("capacity.loads.estimating"));
    const z = await ensureZones()!.catch(() => ({ zones: [], notes: [] }) as RidershipZones);
    if (!alive()) return;
    const shares = {
      peakHour: paramValue("benefit.ridership.peak_hour_share", "*", prefs)[1],
      peakDirection: paramValue("benefit.ridership.peak_direction_share", "*", prefs)[1],
    };
    const all = [
      ...(drawn === null && railway ? railLoadPlans(railway, infos) : []),
      ...streetLoadPlans(streets, prefs),
    ];
    const out: Record<string, LineLoad> = {};
    for (const p of all) {
      const names = [...new Set(p.sequences.flat())];
      const est = estimatedBoardings(z.zones, p.mode, names, prefs, ridership.doc);
      const line: LoadLine = { ...p, boardings: lineBoardings(names, est, ownBoardings, linesAt) };
      out[p.key] = lineLoad(line, w.from_s, w.to_s, shares);
    }
    setLoads(out);
  };

  const start = async () => {
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
    const railOn = source !== "drawn" || drawn === null;
    const key =
      source === "example"
        ? "example"
        : source === "drawn"
          ? `drawn|${JSON.stringify(railway)}`
          : `${topology!.name}|${topology!.text.length}|${linesFile!.text}`;
    try {
      if (!railOn) {
        await drawnExtras(w, [], alive);
        return;
      }
      if (engine.current?.key !== key) {
        engine.current?.engine.dispose();
        engine.current = null;
        let src: NetworkSource;
        if (source === "example") src = { kind: "example" };
        else if (source === "files")
          src = { kind: "files", topology: topology!.text, lines: linesFile!.text };
        else {
          setStatus(t("capacity.building"));
          const built = await buildDrawn(railway);
          if (!alive()) return;
          if (typeof built === "string") {
            setError(t(`capacity.drawn.${built}`));
            return;
          }
          src = { kind: "files", ...built };
        }
        setStatus(t("capacity.loading"));
        const e = await loadEngine(src);
        if (!alive()) return e.dispose();
        engine.current = { key, engine: e };
      }
      const e = engine.current.engine;
      const params = { ...advanced, ...w };
      setNotes(await e.notes());
      const infos = await e.lines();
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
      if (source === "drawn") await drawnExtras(w, infos, alive);
      if (!alive()) return;
      if (sweep) {
        for (let k = 0; k < states.length; k++) {
          const li = infos.findIndex((i) => i.id === states[k]!.info.id);
          const works = VERDICTS[states[k]!.planned.verdict].rank <= 1;
          const hs = await e.sweepHeadways(params, li, works);
          for (let j = 0; j < hs.length; j++) {
            if (!alive()) return;
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
      if (alive()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive()) setStatus(null);
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
    let network: ServerNetwork;
    if (source === "drawn") {
      // The server runs the rail test only: the drawn railway and its service lines.
      if (drawn !== null) {
        setServerError(t(`capacity.drawn.${drawn}`));
        return;
      }
      setSending(true);
      const built = await buildDrawn(railway).catch((e: unknown) =>
        e instanceof Error ? e.message : String(e),
      );
      setSending(false);
      if (typeof built === "string") {
        setServerError(built in DRAWN_PROBLEMS ? t(`capacity.drawn.${built as DrawnProblem}`) : built);
        return;
      }
      network = {
        kind: "files",
        topology: built.topology,
        topologyName: t("capacity.drawn"),
        lines: built.lines,
        linesName: t("capacity.drawn"),
      };
    } else
      network =
        source === "example"
          ? { kind: "example" }
          : {
              kind: "files",
              topology: topology!.text,
              topologyName: topology!.name,
              lines: linesFile!.text,
              linesName: linesFile!.name,
            };
    const params = Object.fromEntries(
      Object.entries({ ...advanced, ...w }).filter(([, v]) => v !== undefined),
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
      setServerError(e instanceof Error ? e.message : String(e));
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
      setServerError(e instanceof Error ? e.message : String(e));
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
      setServerError(e instanceof Error ? e.message : String(e));
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
      setServerError(e instanceof Error ? e.message : String(e));
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
      setServerError(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = () => {
    // The worker finishes its current step; later results are ignored and the sweep ends.
    generation.current++;
    setStatus(null);
    setLines((ls) => ls.map((l) => ({ ...l, sweeping: false })));
  };

  // What the panel shows: the open saved run, or the run in this browser.
  const shownRun: Run | null = viewing ? (viewing.result?.run ?? null) : run;
  const shownLines: LineState[] = viewing ? (viewing.result?.lines ?? []) : lines;
  const shownNotes: string[] = viewing ? (viewing.result?.notes ?? []) : notes;
  const shownStatus = viewing ? (isOpen(viewing) ? serverStatus(viewing, t) : null) : status;
  const shownError = viewing ? (viewing.status === "failed" ? viewing.error : null) : error;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });

  const body = (
    <section aria-label={t("capacity.title")} className="space-y-4 px-4 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("capacity.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("capacity.intro")}</p>
      </div>

      <NetworkPicker
        source={source}
        setSource={setSource}
        drawn={drawn}
        railway={railway}
        streets={streets}
        topology={topology}
        setTopology={setTopology}
        linesFile={linesFile}
        setLinesFile={setLinesFile}
      />

      <RunSettings
        period={period}
        setPeriod={setPeriod}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
        sweep={sweep}
        setSweep={setSweep}
        showLoads={source === "drawn" && !!ridership}
        withLoads={withLoads}
        setWithLoads={setWithLoads}
        stopNames={stopNames}
        estimates={estimates}
        ownBoardings={ownBoardings}
        onOwnBoardings={onOwnBoardings}
        ensureZones={ensureZones}
        advanced={advanced}
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
        {busy && (
          <button type="button" className="btn" onClick={stop}>
            {t("capacity.stop")}
          </button>
        )}
      </div>
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
      {!ready && source === "files" && <p className="text-xs text-slate-600">{t("capacity.chooseBoth")}</p>}
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
      {shownStatus && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-700">
          <span
            className="h-3 w-3 animate-spin rounded-full border-2 border-blue-700 border-t-transparent"
            aria-hidden
          />
          {shownStatus}
        </p>
      )}
      {shownError && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {shownError}
        </p>
      )}

      {shownRun && <RunResults run={shownRun} lines={shownLines} notes={shownNotes} loads={loads} />}

      <StreetResults results={streetResults} loads={loads} advanced={advanced} prefs={prefs} />
    </section>
  );
  return panel ? createPortal(body, panel) : body;
}

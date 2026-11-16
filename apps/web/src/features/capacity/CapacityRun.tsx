import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clock, parseClock } from "../journey-planner/format";
import {
  type Translate,
  type TranslatePlural,
  translate,
  translatePlural,
  useI18n,
  withNodes,
} from "../../i18n/i18n";
import { loadWorkerEngine } from "./engine";
import {
  isOpen,
  type RunsApi,
  type RunStatus,
  type SavedRun,
  type SavedRunDetail,
  type ServerNetwork,
} from "./server";
import type {
  CapacityEngine,
  CapacityParams,
  CapacityRun as Run,
  EngineLoader,
  LineInfo,
  NetworkSource,
  Point,
  Verdict,
} from "./types";

const H = 3600;

/** Periods to pick from; "custom" lets the planner type the times. */
const PERIODS = [
  { id: "am", from: 7 * H, to: 9 * H },
  { id: "midday", from: 11 * H, to: 13 * H },
  { id: "pm", from: 16 * H, to: 18 * H },
  { id: "evening", from: 20 * H, to: 22 * H },
] as const;

/** English, for the helpers when no translator is given (tests, logs). */
const EN: Translate = (key, vars) => translate("en", key, vars);
const EN_N: TranslatePlural = (key, count, vars) => translatePlural("en", key, count, vars);

/** Verdict wording and colours, best first. */
export const VERDICTS: Record<Verdict, { tone: string; rank: number }> = {
  works: { tone: "bg-emerald-100 text-emerald-900 border-emerald-300", rank: 0 },
  near_limit: { tone: "bg-lime-100 text-lime-900 border-lime-300", rank: 1 },
  over_limit: { tone: "bg-amber-100 text-amber-900 border-amber-300", rank: 2 },
  delays_pile_up: { tone: "bg-orange-100 text-orange-900 border-orange-300", rank: 3 },
  not_enough_capacity: { tone: "bg-red-100 text-red-900 border-red-300", rank: 4 },
};

/** Purpose: a verdict's title and one-sentence explanation in the reader's language. */
export function verdictText(v: Verdict, t: Translate = EN): { title: string; text: string } {
  return { title: t(`capacity.verdict.${v}.title`), text: t(`capacity.verdict.${v}.text`) };
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const perHour = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? `${Math.round(x)}` : x.toFixed(1));
const secs = (s: number, t: Translate = EN) =>
  s < 90 ? t("capacity.seconds", { n: Math.round(s) }) : t("capacity.minutes", { n: (s / 60).toFixed(1) });
const every = (h: number, t: Translate = EN) => {
  const m = h / 60;
  return t("capacity.every", { n: Number.isInteger(m) ? m : m.toFixed(1) });
};

/** Purpose: the practical maximum: the highest frequency that works (placed, under the limit, stable). */
export function practicalMaximum(points: Point[]): number | null {
  const ok = points.filter((p) => VERDICTS[p.verdict].rank <= 1).map((p) => p.per_hour);
  return ok.length ? Math.max(...ok) : null;
}

/** Purpose: one sentence that says why a point got its verdict. */
export function explain(p: Point, limit: number, t: Translate = EN, tn: TranslatePlural = EN_N): string {
  if (p.unplaced > 0) return tn("capacity.unplaced", p.unplaced);
  if (p.problems.length && p.verdict === "not_enough_capacity")
    return t("capacity.stopped", { problem: p.problems[0]! });
  const part =
    p.terminal_share > p.consumption
      ? t("capacity.partTerminal", { name: p.terminal })
      : t("capacity.partLine", { name: p.bottleneck });
  const use = t("capacity.busiest", {
    part,
    share: pct(Math.max(p.consumption, p.terminal_share)),
    limit: pct(limit),
  });
  if (!p.stable) return `${use} ${t("capacity.stillLate", { late: secs(p.residual_delay_s, t) })}`;
  return use;
}

interface Props {
  /** Where the panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Engine loader; tests inject a fake. */
  loadEngine?: EngineLoader;
  /** The project's saved runs on the server; without it the panel only runs in the browser. */
  runs?: RunsApi | null;
  /** Whether the reader may start and stop runs on the server (Owners and Editors). */
  canRun?: boolean;
  /** Milliseconds between checks of runs that are still going (tests make it short). */
  pollMs?: number;
}

/** Tag colours of a saved run's status. */
const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  cancelled: "bg-amber-50 text-amber-900 border-amber-200",
};

const isVerdict = (v: string | null): v is Verdict => v !== null && Object.hasOwn(VERDICTS, v);

type LineState = { info: LineInfo; planned: Point; sweep: Point[]; sweeping: boolean };

/**
 * The simulator tab's "Test the system" panel: the rail capacity run. The planner picks a network (the example
 * metro, or the railway editor's track topology with a lines file) and a period; the run plans the period with the
 * timetable planner, measures UIC 406 capacity, runs it through the interlocking, repeats it with random delays,
 * and tries other frequencies to find the most each line can carry. Plain verdicts first, numbers behind them.
 */
export function CapacityRun({
  panel = null,
  loadEngine = loadWorkerEngine,
  runs = null,
  canRun = false,
  pollMs = 2000,
}: Props) {
  const { t, language } = useI18n();
  const [source, setSource] = useState<"example" | "files">("example");
  const [topology, setTopology] = useState<{ name: string; text: string } | null>(null);
  const [linesFile, setLinesFile] = useState<{ name: string; text: string } | null>(null);
  const [period, setPeriod] = useState<string>("am");
  const [from, setFrom] = useState("07:00");
  const [to, setTo] = useState("09:00");
  const [sweep, setSweep] = useState(true);
  const [advanced, setAdvanced] = useState<Partial<CapacityParams>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const engine = useRef<{ key: string; engine: CapacityEngine } | null>(null);
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

  const ready = source === "example" || (topology !== null && linesFile !== null);
  const busy = status !== null;

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
    const src: NetworkSource =
      source === "example"
        ? { kind: "example" }
        : { kind: "files", topology: topology!.text, lines: linesFile!.text };
    const key =
      source === "example" ? "example" : `${topology!.name}|${topology!.text.length}|${linesFile!.text}`;
    try {
      if (engine.current?.key !== key) {
        setStatus(t("capacity.loading"));
        engine.current?.engine.dispose();
        engine.current = null;
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
    const network: ServerNetwork =
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
  const limit = shownRun?.params.occupancy_limit_share ?? 0.85;
  const file = (
    label: string,
    value: { name: string } | null,
    set: (v: { name: string; text: string }) => void,
  ) => (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block truncate text-xs text-slate-500">
          {value ? value.name : t("capacity.noFile")}
        </span>
      </span>
      <span className="text-sm text-blue-700">{value ? t("capacity.replace") : t("capacity.choose")}</span>
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void f.text().then((text) => set({ name: f.name, text }));
        }}
      />
    </label>
  );

  const num = (
    key: keyof CapacityParams,
    label: string,
    scale: number,
    unit: string,
    step: number,
    def: number,
  ) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right"
          value={advanced[key] !== undefined ? Number(advanced[key]) / scale : def}
          onChange={(e) => {
            const v = Number(e.target.value);
            setAdvanced((a) => ({ ...a, [key]: Number.isFinite(v) ? v * scale : undefined }));
          }}
        />
        <span className="w-6 text-slate-500">{unit}</span>
      </span>
    </label>
  );

  const body = (
    <section aria-label={t("capacity.title")} className="space-y-4 px-4 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("capacity.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("capacity.intro")}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="caps mb-1.5">{t("capacity.network")}</legend>
        <div className="seg" role="radiogroup" aria-label={t("capacity.network")}>
          <button
            type="button"
            role="radio"
            aria-checked={source === "example"}
            aria-pressed={source === "example"}
            onClick={() => setSource("example")}
          >
            {t("capacity.example")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={source === "files"}
            aria-pressed={source === "files"}
            onClick={() => setSource("files")}
          >
            {t("capacity.mine")}
          </button>
        </div>
        {source === "example" ? (
          <p className="text-xs text-slate-600">{t("capacity.exampleText")}</p>
        ) : (
          <div className="space-y-2">
            {file(t("capacity.topologyFile"), topology, setTopology)}
            {file(t("capacity.linesFile"), linesFile, setLinesFile)}
            <p className="text-xs text-slate-600">
              {withNodes(t("capacity.filesHelp"), { download: <em>{t("capacity.download")}</em> })}
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="caps mb-1.5">{t("capacity.period")}</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("capacity.period")}>
          {[...PERIODS, { id: "custom", from: 0, to: 0 } as const].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={period === p.id}
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
            >
              {t(`capacity.period.${p.id}`)}
              {p.id !== "custom" && (
                <span className="text-xs font-normal text-slate-500">
                  {clock(p.from)}–{clock(p.to)}
                </span>
              )}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <label className="field w-28">
              <span className="sr-only">{t("capacity.from")}</span>
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label={t("capacity.from")}
                inputMode="numeric"
              />
            </label>
            <span>{t("capacity.toWord")}</span>
            <label className="field w-28">
              <span className="sr-only">{t("capacity.to")}</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label={t("capacity.to")}
                inputMode="numeric"
              />
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sweep} onChange={(e) => setSweep(e.target.checked)} />
          {t("capacity.sweep")}
        </label>
        <details className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">{t("capacity.settings")}</summary>
          <div className="mt-2 space-y-1.5">
            {num("stability_runs", t("capacity.set.runs"), 1, "", 1, 8)}
            {num("delayed_share", t("capacity.set.delayed"), 0.01, "%", 5, 20)}
            {num("primary_delay_mean_s", t("capacity.set.mean"), 1, "s", 5, 45)}
            {num("primary_delay_max_s", t("capacity.set.max"), 1, "s", 30, 180)}
            {num("occupancy_limit_share", t("capacity.set.limit"), 0.01, "%", 5, 85)}
            {num("min_buffer_s", t("capacity.set.buffer"), 1, "s", 5, 20)}
            {num("late_threshold_s", t("capacity.set.lateFrom"), 1, "s", 30, 120)}
            {num("seed", t("capacity.set.seed"), 1, "", 1, 1)}
            <p className="pt-1 text-xs text-slate-500">{t("capacity.settingsNote")}</p>
          </div>
        </details>
      </fieldset>

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

      {runs && (
        <section aria-label={t("capacity.saved")} className="space-y-1.5">
          <h3 className="caps">{t("capacity.saved")}</h3>
          {saved.length === 0 ? (
            <p className="text-xs text-slate-600">{t("capacity.savedNone")}</p>
          ) : (
            <ul className="space-y-1.5">
              {saved.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={viewing?.id === r.id ? "true" : undefined}
                    className={`w-full rounded-[10px] border px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      viewing?.id === r.id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
                    }`}
                    onClick={() => void open(r.id)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {clock(r.params.from_s)}–{clock(r.params.to_s)} ·{" "}
                        {r.network.kind === "example" ? t("capacity.example") : r.network.topologyName}
                      </span>
                      <span className={`tag border ${STATUS_TONE[r.status]}`}>
                        {r.status === "done" && isVerdict(r.verdict)
                          ? verdictText(r.verdict, t).title
                          : t(`capacity.status.${r.status}`)}
                      </span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t("capacity.savedBy", {
                        who: r.createdBy?.displayName ?? t("capacity.someone"),
                        when: when(r.createdAt),
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {viewing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span>
            {t("capacity.viewing", { when: when(viewing.createdAt) })}{" "}
            <span className={`tag border ${STATUS_TONE[viewing.status]}`}>
              {t(`capacity.status.${viewing.status}`)}
            </span>
          </span>
          <span className="flex gap-2">
            {isOpen(viewing) && canRun && !viewing.cancelRequested && (
              <button type="button" className="btn" onClick={() => void cancelSaved()}>
                {t("capacity.stop")}
              </button>
            )}
            {!isOpen(viewing) && canRun && (
              <button type="button" className="btn" onClick={() => void rerunSaved()}>
                {t("capacity.runAgain")}
              </button>
            )}
            {canRun && (
              <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
                {t("capacity.delete")}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setConfirmDelete(false);
                setViewing(null);
              }}
            >
              {t("capacity.close")}
            </button>
          </span>
        </div>
      )}
      {viewing && confirmDelete && (
        <div
          role="alertdialog"
          aria-label={t("capacity.deleteAsk")}
          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <span>{t("capacity.deleteAsk")}</span>
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              {t("capacity.keep")}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void deleteSaved()}>
              {t("capacity.delete")}
            </button>
          </span>
        </div>
      )}
      {viewing?.status === "cancelled" && viewing.result && (
        <p className="text-xs text-slate-600">{t("capacity.stoppedEarly")}</p>
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

      {shownRun && (
        <div className="space-y-3" data-testid="capacity-result">
          <div className={`rounded-xl border px-3.5 py-3 ${VERDICTS[shownRun.verdict].tone}`}>
            <p className="text-base font-semibold">{verdictText(shownRun.verdict, t).title}</p>
            <p className="mt-0.5 text-sm">{verdictText(shownRun.verdict, t).text}</p>
            <p className="mt-1.5 text-xs opacity-80">
              {t("capacity.summary", {
                period: `${clock(shownRun.params.from_s)}–${clock(shownRun.params.to_s)}`,
                trips: shownRun.fleet.trips,
                out: shownRun.fleet.peak_out,
                reserve: shownRun.fleet.reserve,
              })}
            </p>
          </div>
          {shownLines.map((l) => (
            <LineCard key={l.info.id} line={l} limit={limit} />
          ))}
          {shownNotes.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">
                {t("capacity.importNotes", { n: shownNotes.length })}
              </summary>
              <ul className="mt-1 list-disc pl-4">
                {shownNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          {shownRun.issues.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">
                {t("capacity.plannerNotes", { n: shownRun.issues.length })}
              </summary>
              <ul className="mt-1 list-disc pl-4 break-all">
                {shownRun.issues.slice(0, 20).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-slate-500">
            {t("capacity.method", {
              runs: shownRun.params.stability_runs,
              share: pct(shownRun.params.delayed_share),
              late: secs(shownRun.params.primary_delay_max_s, t),
            })}
          </p>
        </div>
      )}
    </section>
  );
  return panel ? createPortal(body, panel) : body;
}

/** Purpose: what a saved run that is still going is doing now, in the reader's language. */
function serverStatus(r: SavedRunDetail, t: Translate): string {
  if (r.status === "queued") return t("capacity.waiting");
  if (r.cancelRequested) return t("capacity.stopping");
  const p = r.progress;
  if (p?.step === "sweeping" && p.headway_s !== undefined && p.n !== undefined && p.total !== undefined)
    return t("capacity.trying", { line: p.line, every: every(p.headway_s, t), n: p.n, total: p.total });
  if (p?.step === "sweeping") return t("capacity.tryingOthers");
  return t("capacity.planning");
}

function LineCard({ line, limit }: { line: LineState; limit: number }) {
  const { t, tn } = useI18n();
  const p = line.planned;
  const all = [p, ...line.sweep].sort((a, b) => b.headway_s - a.headway_s);
  const max = practicalMaximum(all);
  const v = { ...VERDICTS[p.verdict], ...verdictText(p.verdict, t) };
  const metric = (label: string, value: string, hint?: string) => (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
  return (
    <article
      aria-label={t("capacity.line", { name: line.info.name })}
      className="rounded-xl border border-slate-200 bg-white p-3.5"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {line.info.name}{" "}
          <span className="text-sm font-normal text-slate-500">
            {every(p.headway_s, t)} · {t("capacity.eachWay", { n: perHour(p.per_hour) })}
          </span>
        </h3>
        <span className={`tag border ${v.tone}`}>{v.title}</span>
      </header>
      <p className="mt-1.5 text-sm text-slate-700">{explain(p, limit, t, tn)}</p>
      <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
        {metric(
          t("capacity.used"),
          pct(Math.max(p.consumption, p.terminal_share)),
          t("capacity.usedHint", {
            line: pct(p.consumption),
            terminal: p.terminal || t("capacity.terminal"),
            share: pct(p.terminal_share),
          }),
        )}
        {metric(
          t("capacity.room"),
          t("capacity.roomValue", { n: perHour(p.theoretical_per_hour) }),
          t("capacity.roomHint", { n: perHour(p.limit_per_hour) }),
        )}
        {metric(
          t("capacity.onTime"),
          pct(p.punctuality),
          t("capacity.onTimeHint", { share: pct(p.disturbed_punctuality) }),
        )}
        {metric(
          t("capacity.delays"),
          p.stable ? t("capacity.dieOut") : t("capacity.pileUp"),
          t("capacity.delaysHint", { passed: secs(p.knock_on_s, t), left: secs(p.residual_delay_s, t) }),
        )}
      </dl>
      {(line.sweep.length > 0 || line.sweeping) && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            {max !== null
              ? t("capacity.worksUpTo", { n: perHour(max) })
              : line.sweeping
                ? t("capacity.tryingOthers")
                : t("capacity.noneWorks")}
          </p>
          <table className="mt-1.5 w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.service")}</th>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.used")}</th>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.delays")}</th>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.result")}</th>
              </tr>
            </thead>
            <tbody>
              {all.map((x) => (
                <tr
                  key={x.headway_s}
                  className={`border-t border-slate-100 ${x === p ? "font-semibold" : ""}`}
                >
                  <td className="py-1 pr-2">
                    {t(x === p ? "capacity.ratePlanned" : "capacity.rate", { n: perHour(x.per_hour) })}
                  </td>
                  <td className="py-1 pr-2">
                    {x.unplaced > 0
                      ? tn("capacity.notFit", x.unplaced)
                      : pct(Math.max(x.consumption, x.terminal_share))}
                  </td>
                  <td className="py-1 pr-2">
                    {x.unplaced > 0 ? "–" : x.stable ? t("capacity.dieOutRow") : t("capacity.pileUpRow")}
                  </td>
                  <td className="py-1 pr-2">{verdictText(x.verdict, t).title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.problems.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">{t("capacity.kernelNotes", { n: p.problems.length })}</summary>
          <ul className="mt-1 list-disc pl-4">
            {p.problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

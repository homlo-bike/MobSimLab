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
}

type LineState = { info: LineInfo; planned: Point; sweep: Point[]; sweeping: boolean };

/**
 * The simulator tab's "Test the system" panel: the rail capacity run. The planner picks a network (the example
 * metro, or the railway editor's track topology with a lines file) and a period; the run plans the period with the
 * timetable planner, measures UIC 406 capacity, runs it through the interlocking, repeats it with random delays,
 * and tries other frequencies to find the most each line can carry. Plain verdicts first, numbers behind them.
 */
export function CapacityRun({ panel = null, loadEngine = loadWorkerEngine }: Props) {
  const { t } = useI18n();
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

  const stop = () => {
    // The worker finishes its current step; later results are ignored and the sweep ends.
    generation.current++;
    setStatus(null);
    setLines((ls) => ls.map((l) => ({ ...l, sweeping: false })));
  };

  const limit = run?.params.occupancy_limit_share ?? 0.85;
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
          {run ? t("capacity.runAgain") : t("capacity.run")}
        </button>
        {busy && (
          <button type="button" className="btn" onClick={stop}>
            {t("capacity.stop")}
          </button>
        )}
      </div>
      {!ready && source === "files" && <p className="text-xs text-slate-600">{t("capacity.chooseBoth")}</p>}
      {status && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-700">
          <span
            className="h-3 w-3 animate-spin rounded-full border-2 border-blue-700 border-t-transparent"
            aria-hidden
          />
          {status}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {run && (
        <div className="space-y-3" data-testid="capacity-result">
          <div className={`rounded-xl border px-3.5 py-3 ${VERDICTS[run.verdict].tone}`}>
            <p className="text-base font-semibold">{verdictText(run.verdict, t).title}</p>
            <p className="mt-0.5 text-sm">{verdictText(run.verdict, t).text}</p>
            <p className="mt-1.5 text-xs opacity-80">
              {t("capacity.summary", {
                period: `${clock(run.params.from_s)}–${clock(run.params.to_s)}`,
                trips: run.fleet.trips,
                out: run.fleet.peak_out,
                reserve: run.fleet.reserve,
              })}
            </p>
          </div>
          {lines.map((l) => (
            <LineCard key={l.info.id} line={l} limit={limit} />
          ))}
          {notes.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">{t("capacity.importNotes", { n: notes.length })}</summary>
              <ul className="mt-1 list-disc pl-4">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          {run.issues.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">
                {t("capacity.plannerNotes", { n: run.issues.length })}
              </summary>
              <ul className="mt-1 list-disc pl-4 break-all">
                {run.issues.slice(0, 20).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-slate-500">
            {t("capacity.method", {
              runs: run.params.stability_runs,
              share: pct(run.params.delayed_share),
              late: secs(run.params.primary_delay_max_s, t),
            })}
          </p>
        </div>
      )}
    </section>
  );
  return panel ? createPortal(body, panel) : body;
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

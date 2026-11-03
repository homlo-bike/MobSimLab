import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clock, parseClock } from "../journey-planner/format";
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
  { id: "am", label: "Morning peak", from: 7 * H, to: 9 * H },
  { id: "midday", label: "Midday", from: 11 * H, to: 13 * H },
  { id: "pm", label: "Evening peak", from: 16 * H, to: 18 * H },
  { id: "evening", label: "Evening", from: 20 * H, to: 22 * H },
] as const;

/** Verdict wording and colours, best first. */
export const VERDICTS: Record<Verdict, { title: string; text: string; tone: string; rank: number }> = {
  works: {
    title: "Works as intended",
    text: "The plan fits the infrastructure with margin, runs on time and recovers from small delays.",
    tone: "bg-emerald-100 text-emerald-900 border-emerald-300",
    rank: 0,
  },
  near_limit: {
    title: "Works, close to the limit",
    text: "Everything runs, but the busiest part is within 10 % of the recommended limit. There is little room to add trains.",
    tone: "bg-lime-100 text-lime-900 border-lime-300",
    rank: 1,
  },
  over_limit: {
    title: "Runs, above the recommended limit",
    text: "Trains fit and delays die out in the test, but the infrastructure is busier than UIC 406 recommends. Expect delays on a bad day.",
    tone: "bg-amber-100 text-amber-900 border-amber-300",
    rank: 2,
  },
  delays_pile_up: {
    title: "Delays pile up",
    text: "The plan fits, but small delays spread from train to train and do not die out before the period ends.",
    tone: "bg-orange-100 text-orange-900 border-orange-300",
    rank: 3,
  },
  not_enough_capacity: {
    title: "Not enough capacity",
    text: "Some trains cannot be given a conflict-free path, or the plan does not run through the interlocking.",
    tone: "bg-red-100 text-red-900 border-red-300",
    rank: 4,
  },
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const perHour = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? `${Math.round(x)}` : x.toFixed(1));
const secs = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const every = (h: number) => {
  const m = h / 60;
  return `every ${Number.isInteger(m) ? m : m.toFixed(1)} min`;
};

/** Purpose: the practical maximum: the highest frequency that works (placed, under the limit, stable). */
export function practicalMaximum(points: Point[]): number | null {
  const ok = points.filter((p) => VERDICTS[p.verdict].rank <= 1).map((p) => p.per_hour);
  return ok.length ? Math.max(...ok) : null;
}

/** Purpose: one sentence that says why a point got its verdict. */
export function explain(p: Point, limit: number): string {
  if (p.unplaced > 0)
    return `${p.unplaced} trip${p.unplaced === 1 ? "" : "s"} could not be given a conflict-free path.`;
  if (p.problems.length && p.verdict === "not_enough_capacity") return `The run stopped: ${p.problems[0]}.`;
  const busy =
    p.terminal_share > p.consumption ? `${p.terminal} terminal platforms` : `the line (${p.bottleneck})`;
  const use = `The busiest part is ${busy}, in use ${pct(Math.max(p.consumption, p.terminal_share))} of the busiest hour (limit ${pct(limit)}).`;
  if (!p.stable)
    return `${use} After delays, trains are still ${secs(p.residual_delay_s)} late on average when the period is over.`;
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
      setError("Give the period as two times, the end after the start (for example 07:00 and 09:00).");
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
        setStatus("Loading the network…");
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
      setStatus("Planning the period and running it through the interlocking…");
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
            setStatus(`Trying ${states[k]!.info.name} ${every(hs[j]!)} (${j + 1} of ${hs.length})…`);
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
        <span className="block truncate text-xs text-slate-500">{value ? value.name : "No file chosen"}</span>
      </span>
      <span className="text-sm text-blue-700">{value ? "Replace" : "Choose"}</span>
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
    <section aria-label="Test the system" className="space-y-4 px-4 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">Test the system</h2>
        <p className="mt-1 text-sm text-slate-600">
          Run a period of the day through the timetable planner and the interlocking. See whether every rail
          line fits the tracks, runs on time and recovers from delays, and how many trains it could carry.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="caps mb-1.5">Network</legend>
        <div className="seg" role="radiogroup" aria-label="Network">
          <button
            type="button"
            role="radio"
            aria-checked={source === "example"}
            aria-pressed={source === "example"}
            onClick={() => setSource("example")}
          >
            Example metro
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={source === "files"}
            aria-pressed={source === "files"}
            onClick={() => setSource("files")}
          >
            My railway
          </button>
        </div>
        {source === "example" ? (
          <p className="text-xs text-slate-600">
            Line M1 Westpark – Eastgate: five stations, a depot at each end, every 5 min in the peaks and
            every 10 min otherwise.
          </p>
        ) : (
          <div className="space-y-2">
            {file("Track topology (JSON)", topology, setTopology)}
            {file("Lines (JSON)", linesFile, setLinesFile)}
            <p className="text-xs text-slate-600">
              The track topology is the railway editor’s <em>Download track topology (JSON)</em>. The lines
              file lists each line’s stations, train and service, as the timetable planner reads it
              (docs/user/simulator.md).
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="caps mb-1.5">Period</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Period">
          {[...PERIODS, { id: "custom", label: "Other", from: 0, to: 0 }].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={period === p.id}
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
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
              <span className="sr-only">From</span>
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From"
                inputMode="numeric"
              />
            </label>
            <span>to</span>
            <label className="field w-28">
              <span className="sr-only">To</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" inputMode="numeric" />
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sweep} onChange={(e) => setSweep(e.target.checked)} />
          Also find the most trains each line can carry (takes longer)
        </label>
        <details className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Test settings</summary>
          <div className="mt-2 space-y-1.5">
            {num("stability_runs", "Runs with random delays", 1, "", 1, 8)}
            {num("delayed_share", "Trips that start late", 0.01, "%", 5, 20)}
            {num("primary_delay_mean_s", "Average late start", 1, "s", 5, 45)}
            {num("primary_delay_max_s", "Latest start", 1, "s", 30, 180)}
            {num("occupancy_limit_share", "Recommended limit (UIC 406)", 0.01, "%", 5, 85)}
            {num("min_buffer_s", "Buffer between trains", 1, "s", 5, 20)}
            {num("late_threshold_s", "Late from", 1, "s", 30, 120)}
            {num("seed", "Random seed", 1, "", 1, 1)}
            <p className="pt-1 text-xs text-slate-500">
              Defaults are the metro values of the assumption library. The same seed gives the same result.
            </p>
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
          {run ? "Run again" : "Run the test"}
        </button>
        {busy && (
          <button type="button" className="btn" onClick={stop}>
            Stop
          </button>
        )}
      </div>
      {!ready && source === "files" && (
        <p className="text-xs text-slate-600">Choose both files to run your railway.</p>
      )}
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
            <p className="text-base font-semibold">{VERDICTS[run.verdict].title}</p>
            <p className="mt-0.5 text-sm">{VERDICTS[run.verdict].text}</p>
            <p className="mt-1.5 text-xs opacity-80">
              {clock(run.params.from_s)}–{clock(run.params.to_s)} · {run.fleet.trips} trips planned with
              margins · {run.fleet.peak_out} trains in service, {run.fleet.reserve} in reserve
            </p>
          </div>
          {lines.map((l) => (
            <LineCard key={l.info.id} line={l} limit={limit} />
          ))}
          {notes.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Import notes ({notes.length})</summary>
              <ul className="mt-1 list-disc pl-4">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          {run.issues.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Planner notes ({run.issues.length})</summary>
              <ul className="mt-1 list-disc pl-4 break-all">
                {run.issues.slice(0, 20).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-slate-500">
            Capacity by the UIC 406 compression method; delays from {run.params.stability_runs} runs in which{" "}
            {pct(run.params.delayed_share)} of trips start up to {secs(run.params.primary_delay_max_s)} late.
            Passenger loads are not part of this test yet.
          </p>
        </div>
      )}
    </section>
  );
  return panel ? createPortal(body, panel) : body;
}

function LineCard({ line, limit }: { line: LineState; limit: number }) {
  const p = line.planned;
  const all = [p, ...line.sweep].sort((a, b) => b.headway_s - a.headway_s);
  const max = practicalMaximum(all);
  const v = VERDICTS[p.verdict];
  const metric = (label: string, value: string, hint?: string) => (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
  return (
    <article
      aria-label={`Line ${line.info.name}`}
      className="rounded-xl border border-slate-200 bg-white p-3.5"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {line.info.name}{" "}
          <span className="text-sm font-normal text-slate-500">
            {every(p.headway_s)} · {perHour(p.per_hour)} trains/h each way
          </span>
        </h3>
        <span className={`tag border ${v.tone}`}>{v.title}</span>
      </header>
      <p className="mt-1.5 text-sm text-slate-700">{explain(p, limit)}</p>
      <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
        {metric(
          "Capacity used",
          pct(Math.max(p.consumption, p.terminal_share)),
          `line ${pct(p.consumption)}, ${p.terminal || "terminal"} ${pct(p.terminal_share)}`,
        )}
        {metric(
          "Room for (estimate)",
          `${perHour(p.theoretical_per_hour)} trains/h`,
          `${perHour(p.limit_per_hour)} at the limit, scaled from this hour`,
        )}
        {metric("On time", pct(p.punctuality), `${pct(p.disturbed_punctuality)} with random delays`)}
        {metric(
          "Delays",
          p.stable ? "Die out" : "Pile up",
          `${secs(p.knock_on_s)} passed on per trip, ${secs(p.residual_delay_s)} left at the end`,
        )}
      </dl>
      {(line.sweep.length > 0 || line.sweeping) && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            {max !== null
              ? `Works up to ${perHour(max)} trains an hour each way`
              : line.sweeping
                ? "Trying other frequencies…"
                : "No frequency tried works"}
          </p>
          <table className="mt-1.5 w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Service</th>
                <th className="py-1 pr-2 font-medium">Used</th>
                <th className="py-1 pr-2 font-medium">Delays</th>
                <th className="py-1 pr-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {all.map((x) => (
                <tr
                  key={x.headway_s}
                  className={`border-t border-slate-100 ${x === p ? "font-semibold" : ""}`}
                >
                  <td className="py-1 pr-2">
                    {perHour(x.per_hour)}/h{x === p ? " (planned)" : ""}
                  </td>
                  <td className="py-1 pr-2">
                    {x.unplaced > 0
                      ? `${x.unplaced} trip${x.unplaced === 1 ? " does" : "s do"} not fit`
                      : pct(Math.max(x.consumption, x.terminal_share))}
                  </td>
                  <td className="py-1 pr-2">{x.unplaced > 0 ? "–" : x.stable ? "die out" : "pile up"}</td>
                  <td className="py-1 pr-2">{VERDICTS[x.verdict].title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.problems.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">What the kernel reported ({p.problems.length})</summary>
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

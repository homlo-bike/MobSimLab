/**
 * The Simulator tab's road simulation view (Phase 5): run the project's street lines, their depots and the
 * background traffic of the GIS tab in SUMO on the server, follow the run, read each line's measures and
 * replay the vehicles on the map (play, pause, reset, speed; FR-SIM-06).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { isOpen, type RunStatus } from "../capacity/server";
import { loadDepotEngine } from "../depots/engine";
import type { DepotEngineLoader, SavedDepot } from "../depots/types";
import { clock, parseClock } from "../journey-planner/format";
import type { SavedStreetLine } from "../street-lines/saved";
import type { StreetSetup } from "../street-setup/types";
import {
  type PreferencesDoc,
  VEHICLE_STATES,
  type VehicleState,
  type VehicleVisuals,
  vehicleVisualsFrom,
} from "../../workspace/preferences";
import type { RoadRun, RoadRunDetail, RoadRunsApi } from "./api";
import { ensureReplayLayers, hasServiceTimes, removeReplayLayers, replaySpan, setReplayTime } from "./replay";
import { buildScenario } from "./scenario";
import type { Replay, RoadEvent, RoadLineResult, RoadResult, RoadStep } from "./types";
import { engineErrorText } from "../../i18n/engine";
import { withUnit } from "../../i18n/units";

const H = 3600;
const PERIODS = [
  { id: "am", from: 7 * H, to: 9 * H },
  { id: "midday", from: 11 * H, to: 13 * H },
  { id: "pm", from: 16 * H, to: 18 * H },
  { id: "evening", from: 20 * H, to: 22 * H },
] as const;
const SPEEDS = [1, 10, 30, 60, 120, 300] as const;
const NO_LINES: readonly SavedStreetLine[] = [];
const NO_DEPOTS: readonly SavedDepot[] = [];
const NO_SETUPS: readonly StreetSetup[] = [];

const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  cancelled: "bg-amber-50 text-amber-900 border-amber-200",
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const mins = (s: number) => (s < 90 ? withUnit(Math.round(s), "s") : withUnit((s / 60).toFixed(1), "min"));
const message = (e: unknown) => engineErrorText(e);

interface Props {
  api: RoadRunsApi | null;
  canRun: boolean;
  map?: MapLibreMap | null;
  streetLines?: readonly SavedStreetLine[];
  depots?: readonly SavedDepot[];
  setups?: readonly StreetSetup[];
  prefs?: PreferencesDoc["values"];
  /** The project's vehicle colours and delays (Project preferences → Visuals); absent: the defaults. */
  visuals?: PreferencesDoc["visuals"];
  /** Depot layout engine; tests inject a fake. */
  loadEngine?: DepotEngineLoader;
  pollMs?: number;
}

/** Purpose: the road simulation panel. */
export function RoadSimulation({
  api,
  canRun,
  map = null,
  streetLines = NO_LINES,
  depots = NO_DEPOTS,
  setups = NO_SETUPS,
  prefs,
  visuals,
  loadEngine = loadDepotEngine,
  pollMs = 2000,
}: Props) {
  const { t, language } = useI18n();
  const vehicleVisuals = useMemo(() => vehicleVisualsFrom({ values: {}, visuals }), [visuals]);
  const [period, setPeriod] = useState<string>("am");
  const [from, setFrom] = useState("07:00");
  const [to, setTo] = useState("09:00");
  const [warmupMin, setWarmupMin] = useState("30");
  const [seed, setSeed] = useState("1");
  const [saved, setSaved] = useState<RoadRun[]>([]);
  const [viewing, setViewing] = useState<RoadRunDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const window = useMemo(() => {
    const p = PERIODS.find((x) => x.id === period);
    if (p) return { from: p.from, to: p.to };
    const a = parseClock(from);
    const b = parseClock(to);
    return a !== null && b !== null && b > a ? { from: a, to: b } : null;
  }, [period, from, to]);
  const warmup = Math.max(0, Math.min(120, Number(warmupMin) || 0)) * 60;

  // A preview of what would run: which lines and which depots, without the depot engine.
  const preview = useMemo(
    () =>
      window
        ? buildScenario({
            lines: streetLines,
            depots,
            setups,
            prefs,
            from: window.from,
            to: window.to,
            warmup,
            engine: null,
          })
        : null,
    [window, streetLines, depots, setups, prefs, warmup],
  );

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.list().then(
      (l) => live && setSaved(l),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const viewingId = viewing?.id ?? null;
  const viewingOpen = viewing !== null && isOpen(viewing);
  const listOpen = saved.some(isOpen);
  useEffect(() => {
    if (!api || (!viewingOpen && !listOpen)) return;
    let live = true;
    const timer = setInterval(() => {
      void api.list().then(
        (l) => live && setSaved(l),
        () => undefined,
      );
      if (viewingId && viewingOpen)
        void api.get(viewingId).then(
          (r) => live && setViewing((v) => (v?.id === r.id ? r : v)),
          () => undefined,
        );
    }, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, viewingId, viewingOpen, listOpen, pollMs]);

  const start = async () => {
    if (!api || !window) return;
    setSending(true);
    setError(null);
    try {
      const engine = await loadEngine();
      const built = buildScenario({
        lines: streetLines,
        depots,
        setups,
        prefs,
        from: window.from,
        to: window.to,
        warmup,
        engine,
      });
      const s = Math.round(Number(seed));
      const r = await api.start(
        {
          from_s: window.from,
          to_s: window.to,
          warmup_s: warmup,
          seed: Number.isFinite(s) && s >= 0 ? s : 1,
        },
        built.scenario,
      );
      setViewing(r);
      setSaved((l) => [r, ...l.filter((x) => x.id !== r.id)]);
    } catch (e) {
      setError(message(e));
    } finally {
      setSending(false);
    }
  };

  const act = async (f: () => Promise<RoadRunDetail | void>, after?: (r: RoadRunDetail | void) => void) => {
    setError(null);
    try {
      after?.(await f());
    } catch (e) {
      setError(message(e));
    }
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
  const runnable = preview?.scenario.lines.length ?? 0;
  const result = viewing?.result ?? null;

  return (
    <div className="space-y-4 px-4 py-5 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("sim.road")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("road.intro")}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="caps mb-1.5">{t("road.period")}</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("road.period")}>
          {[...PERIODS, { id: "custom", from: 0, to: 0 } as const].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={period === p.id}
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
              <input value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("capacity.from")} />
            </label>
            <span>{t("capacity.toWord")}</span>
            <label className="field w-28">
              <input value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("capacity.to")} />
            </label>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            {t("road.warmup")}
            <span className="field w-20">
              <input value={warmupMin} onChange={(e) => setWarmupMin(e.target.value)} inputMode="numeric" />
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            {t("road.seed")}
            <span className="field w-20">
              <input value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
            </span>
          </label>
        </div>
      </fieldset>

      {preview && (
        <div className="space-y-1 text-sm text-slate-700">
          {runnable === 0 ? (
            <p>{t("road.nothing")}</p>
          ) : (
            <p>
              {t("road.lines", { n: runnable })} ·{" "}
              {t("road.depots", {
                n: new Set(preview.scenario.lines.map((l) => l.depot).filter(Boolean)).size,
              })}
            </p>
          )}
          {preview.skipped.map((s) => (
            <p key={`s${s.index}`} className="text-xs text-slate-600">
              {t(`road.skipped.${s.problem}`, { name: s.name })}
            </p>
          ))}
          {preview.noDepot.map((s) => (
            <p key={`d${s.index}`} className="text-xs text-amber-800">
              {t("road.noDepot", { name: s.name })}
            </p>
          ))}
        </div>
      )}

      {api &&
        (canRun ? (
          <button
            type="button"
            className="btn btn-pri w-full"
            disabled={sending || runnable === 0 || !window}
            onClick={() => void start()}
          >
            {sending ? t("road.preparing") : t("road.run")}
          </button>
        ) : (
          <p className="text-xs text-slate-600">{t("road.viewer")}</p>
        ))}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {api && (
        <section className="space-y-2">
          <h3 className="caps">{t("road.saved")}</h3>
          {saved.length === 0 ? (
            <p className="text-xs text-slate-600">{t("road.none")}</p>
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
                    onClick={() =>
                      void act(
                        () => api.get(r.id),
                        (x) => {
                          setConfirmDelete(false);
                          if (x) setViewing(x);
                        },
                      )
                    }
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {clock(r.params.from_s)}–{clock(r.params.to_s)} ·{" "}
                        {r.network.lines.map((l) => l.name).join(", ")}
                      </span>
                      <span className={`tag border ${STATUS_TONE[r.status]}`}>
                        {t(`road.status.${r.status}`)}
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

      {api && viewing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className={`tag border ${STATUS_TONE[viewing.status]}`}>
            {t(`road.status.${viewing.status}`)}
          </span>
          <span className="flex flex-wrap gap-2">
            {isOpen(viewing) && canRun && !viewing.cancelRequested && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void act(
                    () => api.cancel(viewing.id),
                    (x) => x && setViewing(x),
                  )
                }
              >
                {t("road.stop")}
              </button>
            )}
            {!isOpen(viewing) && canRun && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void act(
                    () => api.rerun(viewing.id),
                    (x) => {
                      if (!x) return;
                      setViewing(x);
                      setSaved((l) => [x, ...l.filter((y) => y.id !== x.id)]);
                    },
                  )
                }
              >
                {t("road.again")}
              </button>
            )}
            {canRun && (
              <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
                {t("road.delete")}
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
              {t("road.close")}
            </button>
          </span>
        </div>
      )}
      {api && viewing && confirmDelete && (
        <div
          role="alertdialog"
          aria-label={t("road.confirmDelete")}
          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <span>{t("road.confirmDelete")}</span>
          <span className="flex gap-2">
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() =>
                void act(
                  () => api.remove(viewing.id),
                  () => {
                    const id = viewing.id;
                    setConfirmDelete(false);
                    setViewing(null);
                    setSaved((l) => l.filter((x) => x.id !== id));
                  },
                )
              }
            >
              {t("road.delete")}
            </button>
          </span>
        </div>
      )}

      {viewing && isOpen(viewing) && <Progress step={viewing.progress} />}
      {viewing?.status === "failed" && viewing.error && (
        <p role="alert" className="text-sm text-red-700">
          {t("road.failed", { error: viewing.error })}
        </p>
      )}
      {viewing?.status === "cancelled" && result?.run && (
        <p className="text-xs text-slate-600">{t("road.stoppedEarly")}</p>
      )}
      {result && <Results result={result} />}
      {api && viewing?.status === "done" && (
        <ReplayPlayer
          key={viewing.id}
          load={() => api.replay(viewing.id)}
          map={map}
          visuals={vehicleVisuals}
        />
      )}
    </div>
  );
}

/** Purpose: what the worker is doing now. */
function Progress({ step }: { step: RoadStep | null }) {
  const { t } = useI18n();
  let text = t("road.status.queued");
  if (step?.step === "simulating") {
    const share = step.end > step.begin ? (step.t - step.begin) / (step.end - step.begin) : 0;
    text = t("road.step.simulating", { time: clock(step.t), share: pct(Math.min(1, share)) });
  } else if (step) text = t(`road.step.${step.step}`);
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-700">
      <span
        className="h-3 w-3 animate-spin rounded-full border-2 border-blue-700 border-t-transparent"
        aria-hidden
      />
      {text}
    </p>
  );
}

/** Purpose: the run's summary, each line's measures and the events. */
function Results({ result }: { result: RoadResult }) {
  const { t } = useI18n();
  const r = result.run;
  const names = new Map(result.lines.map((l) => [l.index, l.name]));
  return (
    <div className="space-y-3">
      {r && (
        <section className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
          <h3 className="caps mb-1">{t("road.summary")}</h3>
          <ul className="space-y-0.5">
            <li>{t("road.back", { n: r.back_in_depot, total: r.vehicles })}</li>
            <li>{t("road.teleports", { n: r.teleports })}</li>
            <li>{t("road.gridlocks", { n: r.gridlocks })}</li>
            <li>{t("road.cars", { n: r.background_inserted })}</li>
            {result.network && (
              <li>
                {t("road.network", { km: result.network.km.toFixed(0), signals: result.network.signals })}
              </li>
            )}
            <li className="text-xs text-slate-500">{t("road.speedup", { x: Math.round(r.speedup) })}</li>
          </ul>
        </section>
      )}
      {result.notes.map((n) => (
        <p key={n} className="text-xs text-amber-800">
          {n}
        </p>
      ))}
      {result.lines.map((l) => (
        <LineCard key={l.index} line={l} />
      ))}
      {result.events.length > 0 && (
        <section className="text-sm">
          <h3 className="caps mb-1">{t("road.events")}</h3>
          <ul className="space-y-0.5 text-xs text-slate-700">
            {result.events.slice(0, 30).map((e: RoadEvent, k) => (
              <li key={k}>
                {t(`road.event.${e.kind}`, {
                  line: names.get(e.line) ?? "",
                  n: Number(e.vehicle.split("v").at(-1) ?? 0) + 1,
                  time: clock(e.t),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Purpose: one line's measures. */
function LineCard({ line }: { line: RoadLineResult }) {
  const { t } = useI18n();
  const rows: [string, string][] = [];
  if (!line.problem) {
    rows.push([t("road.kpi.trips"), `${line.trips_run ?? 0} / ${line.trips ?? 0}`]);
    rows.push([t("road.kpi.cycle"), `${mins(line.planned_run_s ?? 0)} → ${mins(line.run_cycle_s ?? 0)}`]);
    rows.push([t("road.kpi.speed"), withUnit((line.speed_kmh ?? 0).toFixed(1), "km/h")]);
    rows.push([t("road.kpi.punctuality"), pct(line.punctuality ?? 1)]);
    rows.push([t("road.kpi.delay"), `${mins(line.mean_delay_s ?? 0)} / ${mins(line.p95_delay_s ?? 0)}`]);
    rows.push([t("road.kpi.bunching"), pct(line.bunched_share ?? 0)]);
    rows.push([t("road.kpi.lostTraffic"), mins(line.lost_traffic_s ?? 0)]);
    rows.push([t("road.kpi.lostSignals"), mins(line.lost_signals_s ?? 0)]);
    const e = line.energy_use;
    if (e) {
      rows.push([t("road.kpi.energy"), `${e.kwh_per_km.toFixed(2)} kWh/km · ${e.kwh.toFixed(0)} kWh`]);
      if (e.min_charge_share !== null) rows.push([t("road.kpi.lowest"), pct(e.min_charge_share)]);
      rows.push([t("road.kpi.ranOut"), String(e.ran_out)]);
    }
  }
  return (
    <section className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
      <h3 className="flex items-center gap-2 font-semibold">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: line.color }} aria-hidden />
        {line.name}
      </h3>
      {line.problem ? (
        <p className="mt-1 text-xs text-red-700">{t("road.cannotRun", { problem: line.problem })}</p>
      ) : (
        <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-600">{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {line.notes.map((n) => (
        <p key={n} className="mt-1 text-xs text-amber-800">
          {n}
        </p>
      ))}
    </section>
  );
}

/** Purpose: the replay of a finished run on the map, with play, pause, reset, speed and a time slider. */
function ReplayPlayer({
  load,
  map,
  visuals,
}: {
  load: () => Promise<Replay>;
  map: MapLibreMap | null;
  visuals: VehicleVisuals;
}) {
  const { t } = useI18n();
  const [replay, setReplay] = useState<Replay | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(60);
  const last = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (r) => {
        if (!live) return;
        setReplay(r);
        setTime(replaySpan(r)[0]);
      },
      (e: unknown) => live && setFailed(message(e)),
    );
    return () => {
      live = false;
    };
  }, [load]);

  useEffect(() => {
    if (!map || !replay) return;
    ensureReplayLayers(map);
    return () => removeReplayLayers(map);
  }, [map, replay]);

  useEffect(() => {
    if (map && replay && map.getSource("road-replay")) setReplayTime(map, replay, time, visuals);
  }, [map, replay, time, visuals]);

  useEffect(() => {
    if (!playing || !replay) return;
    const end = replaySpan(replay)[1];
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      let stop = false;
      setTime((x) => {
        const next = Math.min(end, x + dt * speed);
        if (next >= end) stop = true;
        return next;
      });
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, replay, speed]);

  if (failed)
    return (
      <p role="alert" className="text-sm text-red-700">
        {t("road.replay.failed", { error: failed })}
      </p>
    );
  if (!replay) return <p className="text-sm text-slate-600">{t("road.replay.loading")}</p>;
  const [a, b] = replaySpan(replay);
  return (
    <section className="space-y-2 rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm">
      <h3 className="caps">{t("road.replay")}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? t("road.pause") : t("road.play")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPlaying(false);
            setTime(a);
          }}
        >
          {t("road.reset")}
        </button>
        <label className="flex items-center gap-1">
          {t("road.speed")}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="field">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <span className="ms-auto tabular-nums" aria-live="off">
          {clock(time)}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={a}
        max={b}
        step={replay.frame_s}
        value={time}
        aria-label={t("road.time")}
        onChange={(e) => setTime(Number(e.target.value))}
      />
      <VehicleLegend visuals={visuals} />
      {!hasServiceTimes(replay) && <p className="text-xs text-slate-600">{t("road.replay.noService")}</p>}
    </section>
  );
}

const STATE_LABEL = {
  on_time: "visuals.onTime",
  late: "visuals.late",
  very_late: "visuals.veryLate",
  out_of_service: "visuals.outOfService",
  parked: "visuals.parked",
} as const satisfies Record<VehicleState, MessageKey>;

/** Purpose: what each vehicle colour of the replay means, with the project's delays. */
function VehicleLegend({ visuals }: { visuals: VehicleVisuals }) {
  const { t } = useI18n();
  const text = (k: VehicleState) =>
    k === "on_time"
      ? t("visuals.legend.onTime", { min: visuals.on_time_min })
      : k === "late"
        ? t("visuals.legend.late", { from: visuals.on_time_min, to: visuals.late_min })
        : k === "very_late"
          ? t("visuals.legend.veryLate", { min: visuals.late_min })
          : t(STATE_LABEL[k]);
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-slate-700">
      {VEHICLE_STATES.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border border-white shadow-[0_0_0_1px_rgba(15,23,42,.25)]"
            style={{ background: visuals.colors[k] }}
          />
          {text(k)}
        </li>
      ))}
    </ul>
  );
}

import { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { type DrawnNetwork, type DrawnProblem, buildDrawnNetwork, drawnProblem } from "../capacity/drawn";
import { paramValue } from "../costs/params";
import type { SavedStreetLine } from "../street-lines/saved";
import { weekdayServiceHours } from "../costs/model";
import { dayShares } from "../timetables/feed";
import { useRailPublications } from "../timetables/railPublish";
import { verdictText } from "../capacity/CapacityRun";
import { isOpen, type RunStatus, type ServerNetwork } from "../capacity/server";
import type { Verdict } from "../capacity/types";
import type { Network, RailEngineLoader } from "../railways/types";
import { libraryValue as benefitLibrary } from "../benefits/params";
import { useDayTypeLabel } from "../../workspace/dayTypeLabel";
import { calendarFrom, DAY_TYPES, simulationYearsFrom } from "../../workspace/calendar";
import { climateFrom, monthsOf } from "../../workspace/climate";
import { projectRunSettings } from "../capacity/projectSettings";
import { type PreferencesDoc, prefValue, withPref } from "../../workspace/preferences";
import type { CalendarRunDetail, CalendarRun as SavedCalendarRun, CalendarRunsApi, RailDay } from "./api";
import {
  buildPlan,
  dayFigures,
  FIGURES,
  type Figure,
  MAX_DAYS,
  periodsFor,
  RIDER_SHARE,
  type RunMode,
  type TableFigures,
  weatherPeriods,
} from "./model";
import {
  hvacFullKwhFromService,
  hvacFullKwhPerDay,
  libValue,
  switchKwhPerFrostDay,
  VARIANTS,
  type Variant,
  weatherPlan,
  weatherSettings,
} from "./weather";

const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  cancelled: "bg-amber-50 text-amber-900 border-amber-200",
};

const FIGURE_LABEL = {
  vehicle_km: "calrun.fig.vehicle_km",
  vehicle_hours: "calrun.fig.vehicle_hours",
  passengers: "calrun.fig.passengers",
  energy_kwh: "calrun.fig.energy_kwh",
  operating_cost: "calrun.fig.operating_cost",
} as const satisfies Record<Figure, string>;

const VARIANT_LABEL = {
  hot: "calrun.variant.hot",
  very_hot: "calrun.variant.very_hot",
  cold: "calrun.variant.cold",
} as const satisfies Record<Variant, string>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Purpose: the number of switches in the railway editor's topology export (0 when it cannot be read). */
function switchesIn(topology: string): number {
  try {
    const doc = JSON.parse(topology) as { switches?: unknown[] };
    return Array.isArray(doc.switches) ? doc.switches.length : 0;
  } catch {
    return 0;
  }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** No street lines (one array, so memos that depend on it keep). */
const NO_STREET_LINES: readonly SavedStreetLine[] = [];

/**
 * Purpose: the Simulator's calendar runs (ADR-0020): many years (the simulation years of Project preferences),
 * one date, or every date from a first to a last one. Each day type's rail service is run on the worker over
 * its service day; the day figures from the Tables tab are multiplied by the day counts of the project calendar.
 * Lists the project's saved calendar runs and shows a run's figures per year or date and per day type.
 */
export function CalendarRun({
  api,
  canRun,
  railway,
  preferences,
  onPreferences,
  tables,
  currency,
  onOpenTables,
  onOpenPreferences,
  buildDrawn = buildDrawnNetwork,
  loadRail,
  streetLines = NO_STREET_LINES,
  today = new Date(),
  pollMs = 2000,
}: {
  api: CalendarRunsApi | null;
  canRun: boolean;
  railway: Network | null;
  /** The project's street lines, for how much each runs on each day type. */
  streetLines?: readonly SavedStreetLine[];
  preferences: PreferencesDoc | null;
  /** Saves the project's own rider shares; absent for viewers. */
  onPreferences?: (doc: PreferencesDoc) => void;
  /** What the Tables tab has worked out (cost estimate, riders, energy). */
  tables: TableFigures;
  /** The currency the money is in, or null when each country's own is shown. */
  currency: string | null;
  onOpenTables?: () => void;
  onOpenPreferences?: () => void;
  buildDrawn?: typeof buildDrawnNetwork;
  /** Rail engine loader for the day types' publications; tests inject one. */
  loadRail?: RailEngineLoader;
  today?: Date;
  pollMs?: number;
}) {
  const { t, language } = useI18n();
  const dayLabel = useDayTypeLabel();
  const id = useId();
  const prefs = preferences?.values;
  const cal = calendarFrom(preferences);
  const years = simulationYearsFrom(preferences, today);
  const [mode, setMode] = useState<RunMode>("years");
  const [date, setDate] = useState(iso(today));
  const [from, setFrom] = useState(iso(today));
  const [to, setTo] = useState(iso(new Date(today.getTime() + 6 * 86_400_000)));
  const [saved, setSaved] = useState<SavedCalendarRun[]>([]);
  const [viewing, setViewing] = useState<CalendarRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const months = useMemo(() => monthsOf(climateFrom(preferences)), [preferences]);
  const weather = useMemo(() => weatherSettings(preferences), [preferences]);

  // How much each line runs on each day type (its own Saturday, Sunday and holiday times), for the day figures.
  const calKey = JSON.stringify(cal);
  const waitMin = paramValue("timetable.max_terminal_wait_min", "*", prefs)[1];
  const publishOptions = useMemo(() => ({ max_idle_s: waitMin * 60 }), [waitMin]);
  const { publications } = useRailPublications(railway, cal, publishOptions, prefs, loadRail);
  const shares = useMemo(
    () => dayShares(railway, streetLines, cal, publications),
    // The calendar is compared by its content.
    [railway, streetLines, calKey, publications],
  );
  const figures = useMemo(() => dayFigures(tables, prefs, shares), [tables, prefs, shares]);
  // Heating and air conditioning from the Tables tab's estimate, or else from the weekday timetables, so it is
  // counted even when Tables has not been opened (it came out as 0 MWh in the Damascus multi-year run).
  const weekdayReports = publications.weekday?.lines;
  const hvacFull = useMemo(
    () =>
      hvacFullKwhPerDay(tables.estimate, prefs) ??
      hvacFullKwhFromService(weekdayServiceHours(railway, weekdayReports ?? [], streetLines, prefs), prefs),
    [tables, prefs, railway, weekdayReports, streetLines],
  );
  // The periods, split by the weather when the project has a climate; `switches` gives the switch heating.
  const periodsWith = (switches: number) => {
    const span = { years: simulationYearsFrom(preferences, today), date, from, to };
    const c = calendarFrom(preferences);
    return months
      ? weatherPeriods(mode, c, span, {
          months,
          settings: weather,
          hvacFullKwhPerDay: hvacFull,
          switchKwhPerFrostDay: switchKwhPerFrostDay(switches, weather),
        })
      : periodsFor(mode, c, span);
  };
  const periods = useMemo(
    () => periodsWith(0),
    [mode, preferences, today, date, from, to, months, weather, hvacFull],
  );
  const tooMany = mode === "days" && periods.length > MAX_DAYS;
  const missing = FIGURES.filter((f) => figures.days.weekday[f] === null);
  const rail: DrawnProblem | null = drawnProblem(railway);

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

  const act = async <T,>(f: () => Promise<T>, after?: (r: T) => void) => {
    setError(null);
    try {
      after?.(await f());
    } catch (e) {
      setError(message(e));
    }
  };

  const start = async () => {
    if (!api || !periods.length || tooMany) return;
    setError(null);
    let network: ServerNetwork | null = null;
    let dayLines: DrawnNetwork["dayLines"];
    let switches = 0;
    try {
      if (rail === null) {
        setStatus(t("calrun.building"));
        const built = await buildDrawn(railway, undefined, undefined, prefs, cal);
        if (typeof built === "string") {
          if (built === "errors") {
            setError(t("capacity.drawn.errors"));
            return;
          }
        } else {
          switches = switchesIn(built.topology);
          network = {
            kind: "files",
            topology: built.topology,
            topologyName: "railway.json",
            lines: built.lines,
            linesName: "service-lines.json",
          };
          dayLines = built.dayLines;
        }
      }
      setStatus(t("calrun.sending"));
      // The stability test's delays as the project sets them, which a cold day without switch heating adds to.
      const base = {
        delayed_share: libValue("stability.delayed_share", "*", prefs),
        primary_delay_mean_s: libValue("stability.primary_delay_mean_s", "*", prefs),
        primary_delay_max_s: libValue("stability.primary_delay_max_s", "*", prefs),
      };
      const plan = buildPlan(
        mode,
        cal,
        periodsWith(switches),
        figures,
        currency,
        months ? weatherPlan(weather, base) : undefined,
        dayLines,
      );
      const run = await api.start(network, plan, { ...projectRunSettings(prefs), ...base });
      setViewing(run);
      setSaved((l) => [run, ...l.filter((x) => x.id !== run.id)]);
    } catch (e) {
      setError(message(e));
    } finally {
      setStatus(null);
    }
  };

  const when = (s: string) =>
    new Date(s).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
  const label = (r: SavedCalendarRun) => {
    const ps = r.plan.periods;
    const span = ps.length > 1 ? `${ps[0]!.label} – ${ps[ps.length - 1]!.label}` : (ps[0]?.label ?? "");
    return `${t(`calrun.mode.${r.plan.mode}`)} · ${span}`;
  };

  return (
    <div className="space-y-4 px-4 py-5 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("calrun.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("calrun.intro")}</p>
      </div>

      <div className="seg" role="radiogroup" aria-label={t("calrun.what")}>
        {(["years", "date", "days"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
            {t(`calrun.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === "years" && (
        <p className="text-sm">
          {t("calrun.years", { first: years.first, last: years.last })}{" "}
          {onOpenPreferences && (
            <button type="button" className="min-h-10 text-blue-700 underline" onClick={onOpenPreferences}>
              {t("calrun.change")}
            </button>
          )}
        </p>
      )}
      {mode === "date" && (
        <div>
          <label htmlFor={`${id}-date`} className="mb-1 block text-sm font-semibold">
            {t("calrun.date")}
          </label>
          <div className="field">
            <input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      )}
      {mode === "days" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${id}-from`} className="mb-1 block text-sm font-semibold">
              {t("calrun.from")}
            </label>
            <div className="field">
              <input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-to`} className="mb-1 block text-sm font-semibold">
              {t("calrun.to")}
            </label>
            <div className="field">
              <input
                id={`${id}-to`}
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <p className="col-span-2 text-xs text-slate-500">{t("calrun.daysNote")}</p>
        </div>
      )}
      {tooMany && (
        <p role="alert" className="text-sm text-red-800">
          {t("calrun.tooMany", { max: MAX_DAYS })}
        </p>
      )}

      {periods.length > 0 && !tooMany && <DayCountSummary periods={periods} />}
      <p className="text-xs text-slate-600">
        {months ? t("calrun.weatherOn") : t("calrun.weatherOff")}{" "}
        {!months && onOpenPreferences && (
          <button type="button" className="min-h-10 text-blue-700 underline" onClick={onOpenPreferences}>
            {t("calrun.openClimate")}
          </button>
        )}
      </p>

      <section aria-labelledby={`${id}-shares`}>
        <h3 id={`${id}-shares`} className="caps">
          {t("calrun.shares")}
        </h3>
        <p className="text-xs text-slate-600">{t("calrun.sharesIntro")}</p>
        {(Object.keys(RIDER_SHARE) as (keyof typeof RIDER_SHARE)[]).map((dt) => (
          <ShareField
            key={dt}
            label={dayLabel(dt)}
            library={benefitLibrary(RIDER_SHARE[dt])[1]}
            value={prefValue(preferences, RIDER_SHARE[dt])}
            editable={canRun && !!onPreferences}
            onChange={(v) => onPreferences?.(withPref(preferences, RIDER_SHARE[dt], v))}
          />
        ))}
      </section>

      {missing.length > 0 && (
        <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("calrun.missing", { figures: missing.map((f) => t(FIGURE_LABEL[f])).join(", ") })}{" "}
          {onOpenTables && (
            <button type="button" className="min-h-10 text-blue-700 underline" onClick={onOpenTables}>
              {t("calrun.openTables")}
            </button>
          )}
        </p>
      )}
      <p className="text-xs text-slate-600">
        {rail === null ? t("calrun.railYes") : t("calrun.railNo")} {t("calrun.serviceSame")}
      </p>

      {api && canRun && (
        <button
          type="button"
          className="btn btn-pri min-h-10 w-full"
          disabled={!periods.length || tooMany || status !== null}
          onClick={() => void start()}
        >
          {t("calrun.run")}
        </button>
      )}
      {api && !canRun && <p className="text-sm text-slate-600">{t("calrun.viewer")}</p>}
      {status && (
        <p role="status" className="text-sm text-slate-600">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}

      {api && (
        <section aria-labelledby={`${id}-saved`}>
          <h3 id={`${id}-saved`} className="caps">
            {t("calrun.saved")}
          </h3>
          {saved.length === 0 ? (
            <p className="text-xs text-slate-600">{t("calrun.none")}</p>
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
                          setViewing(x);
                        },
                      )
                    }
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{label(r)}</span>
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
          {canRun && (
            <span className="flex flex-wrap gap-2">
              {isOpen(viewing) && !viewing.cancelRequested && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void act(() => api.cancel(viewing.id), setViewing)}
                >
                  {t("road.stop")}
                </button>
              )}
              {!isOpen(viewing) && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void act(() => api.rerun(viewing.id), setViewing)}
                >
                  {t("calrun.again")}
                </button>
              )}
              {confirmDelete ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void act(
                      () => api.remove(viewing.id),
                      () => {
                        setSaved((l) => l.filter((x) => x.id !== viewing.id));
                        setViewing(null);
                        setConfirmDelete(false);
                      },
                    )
                  }
                >
                  {t("calrun.confirmDelete")}
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
                  {t("calrun.delete")}
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {viewing && <RunView run={viewing} />}
    </div>
  );
}

/** Purpose: how many days of each day type the chosen periods have, and the expected weather days, as lines. */
function DayCountSummary({ periods }: { periods: ReturnType<typeof periodsFor> }) {
  const { t, language } = useI18n();
  const dayLabel = useDayTypeLabel();
  const sum = (match: (key: string) => boolean) =>
    periods.reduce(
      (s, p) => s + Object.entries(p.counts).reduce((a, [k, n]) => a + (match(k) ? n : 0), 0),
      0,
    );
  const fmt = (x: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(x);
  const total = Object.fromEntries(
    DAY_TYPES.map((dt) => [dt, sum((k) => k === dt || k.startsWith(`${dt}.`))]),
  ) as Record<(typeof DAY_TYPES)[number], number>;
  const weather = Object.fromEntries(VARIANTS.map((v) => [v, sum((k) => k.endsWith(`.${v}`))])) as Record<
    Variant,
    number
  >;
  return (
    <div className="text-sm text-slate-700">
      <p>
        {DAY_TYPES.filter((dt) => total[dt] > 0)
          .map((dt) => `${dayLabel(dt)}: ${fmt(total[dt])}`)
          .join(" · ")}
      </p>
      {VARIANTS.some((v) => weather[v] > 0) && (
        <p>
          {t("calrun.weatherDays", {
            hot: fmt(weather.hot),
            veryHot: fmt(weather.very_hot),
            cold: fmt(weather.cold),
          })}
        </p>
      )}
    </div>
  );
}

/** Purpose: a saved run: progress, then each day type's day and each period's figures. */
function RunView({ run }: { run: CalendarRunDetail }) {
  const { t, language } = useI18n();
  const dayLabel = useDayTypeLabel();
  const num = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined
      ? "–"
      : new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(v);
  const money = (v: number | null | undefined) =>
    v === null || v === undefined
      ? "–"
      : run.plan.currency
        ? new Intl.NumberFormat(language, {
            style: "currency",
            currency: run.plan.currency,
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(v)
        : new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const show = (f: Figure, v: number | null | undefined) =>
    f === "operating_cost"
      ? money(v)
      : f === "energy_kwh"
        ? num(v === null || v === undefined ? v : v / 1000)
        : num(v);
  const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
  const r = run.result;
  const p = run.progress;
  const stepText = (x: Extract<NonNullable<typeof p>, { step: "day" }>) =>
    x.variant
      ? t("calrun.step.variant", {
          day: dayLabel(x.day_type),
          variant: t(VARIANT_LABEL[x.variant]),
          n: x.n,
          total: x.total,
        })
      : t("calrun.step.day", { day: dayLabel(x.day_type), n: x.n, total: x.total });
  const hhmm = (sec: number) =>
    `${String(Math.floor(sec / 3600) % 24).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  const punctOf = (rail: RailDay | undefined) =>
    rail?.lines.length
      ? Math.min(...rail.lines.map((l) => l.disturbed_punctuality ?? l.punctuality ?? 1))
      : null;
  if (run.error)
    return (
      <p role="alert" className="text-sm text-red-800">
        {run.error}
      </p>
    );
  if (!r)
    return (
      <p role="status" className="text-sm text-slate-600">
        {p && p.step === "day" ? stepText(p) : t("road.status.queued")}
      </p>
    );
  const totals = Object.fromEntries(
    FIGURES.map((f) => [
      f,
      r.periods.some((x) => x[f] === null) ? null : r.periods.reduce((s, x) => s + (x[f] ?? 0), 0),
    ]),
  ) as Record<Figure, number | null>;
  const verdict = r.run.verdict as Verdict | null;
  const withWeather = r.periods.some((x) => x.weather);
  const extraTotal = (k: "hvac_kwh" | "switch_heating_kwh") =>
    r.periods.reduce((s, x) => s + (x.extra?.[k] ?? 0), 0);
  return (
    <div className="space-y-4">
      {isOpen(run) && p && (
        <p role="status" className="text-sm text-slate-600">
          {p.step === "day" ? stepText(p) : t("calrun.step.expanding")}
        </p>
      )}
      {verdict && (
        <p className="text-sm">
          <span className="font-semibold">{verdictText(verdict, t).title}</span>{" "}
          {verdictText(verdict, t).text}
        </p>
      )}
      <section>
        <h3 className="caps">{t("calrun.dayTypes")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <thead>
              <tr className="text-slate-500">
                <th scope="col" className="py-1 text-start font-medium">
                  {t("calrun.dayType")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("calrun.days")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("calrun.trains")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("calrun.punctuality")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("calrun.fig.passengers")}
                </th>
              </tr>
            </thead>
            <tbody>
              {DAY_TYPES.filter((dt) => r.day_types[dt]).flatMap((dt) => {
                const d = r.day_types[dt]!;
                const rows = [
                  <tr key={dt} className="border-t border-slate-100">
                    <th scope="row" className="py-1 text-start font-semibold">
                      {dayLabel(dt)}
                      {d.rail?.verdict && (
                        <span className="block text-xs font-normal text-slate-600">
                          {verdictText(d.rail.verdict as Verdict, t).title}
                        </span>
                      )}
                    </th>
                    <td className="py-1 text-end tabular-nums">{num(d.days, 1)}</td>
                    <td className="py-1 text-end tabular-nums">{num(d.rail?.vehicles)}</td>
                    <td className="py-1 text-end tabular-nums">{pct(punctOf(d.rail))}</td>
                    <td className="py-1 text-end tabular-nums">{num(d.per_day.passengers)}</td>
                  </tr>,
                ];
                for (const v of VARIANTS) {
                  const x = d.weather?.[v];
                  if (!x) continue;
                  const heat = v !== "cold" && x.rail?.from_s !== undefined && x.rail.to_s !== undefined;
                  rows.push(
                    <tr key={`${dt}.${v}`} className="text-slate-700">
                      <th scope="row" className="py-1 ps-4 text-start font-normal">
                        {t(VARIANT_LABEL[v])}
                        {heat && (
                          <span className="ms-1 text-xs text-slate-500">
                            {t("calrun.restricted", { from: hhmm(x.rail!.from_s!), to: hhmm(x.rail!.to_s!) })}
                          </span>
                        )}
                        {x.rail?.verdict && (
                          <span className="block text-xs text-slate-600">
                            {verdictText(x.rail.verdict as Verdict, t).title}
                          </span>
                        )}
                      </th>
                      <td className="py-1 text-end tabular-nums">{num(x.days, 1)}</td>
                      <td className="py-1 text-end tabular-nums">{num(x.rail?.vehicles)}</td>
                      <td className="py-1 text-end tabular-nums">{pct(punctOf(x.rail))}</td>
                      <td className="py-1 text-end tabular-nums" />
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="caps">{t(r.mode === "years" ? "calrun.perYear" : "calrun.perDate")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-slate-500">
                <th scope="col" className="py-1 text-start font-medium">
                  {t(r.mode === "years" ? "cal.year" : "calrun.date")}
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  {t("calrun.days")}
                </th>
                {withWeather && (
                  <>
                    <th scope="col" className="py-1 text-end font-medium">
                      {t("calrun.hotAll")}
                    </th>
                    <th scope="col" className="py-1 text-end font-medium">
                      {t("calrun.variant.cold")}
                    </th>
                  </>
                )}
                {FIGURES.map((f) => (
                  <th key={f} scope="col" className="py-1 text-end font-medium">
                    {t(FIGURE_LABEL[f])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.periods.map((x) => (
                <tr key={x.label} className="border-t border-slate-100">
                  <th scope="row" className="py-1 text-start font-semibold tabular-nums">
                    {x.label}
                    {r.mode !== "years" && (
                      <span className="block text-xs font-normal text-slate-500">
                        {DAY_TYPES.filter((dt) => x.counts[dt] > 0)
                          .map((dt) => dayLabel(dt))
                          .join(", ")}
                      </span>
                    )}
                  </th>
                  <td className="py-1 text-end tabular-nums">{num(x.days, 1)}</td>
                  {withWeather && (
                    <>
                      <td className="py-1 text-end tabular-nums">
                        {num(x.weather ? x.weather.hot + x.weather.very_hot : null, 1)}
                      </td>
                      <td className="py-1 text-end tabular-nums">{num(x.weather?.cold, 1)}</td>
                    </>
                  )}
                  {FIGURES.map((f) => (
                    <td key={f} className="py-1 text-end tabular-nums">
                      {show(f, x[f])}
                    </td>
                  ))}
                </tr>
              ))}
              {r.periods.length > 1 && (
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <th scope="row" className="py-1 text-start">
                    {t("cal.total")}
                  </th>
                  <td className="py-1 text-end tabular-nums">
                    {num(
                      r.periods.reduce((s, x) => s + x.days, 0),
                      1,
                    )}
                  </td>
                  {withWeather && (
                    <>
                      <td className="py-1 text-end tabular-nums">
                        {num(
                          r.periods.reduce(
                            (s, x) => s + (x.weather ? x.weather.hot + x.weather.very_hot : 0),
                            0,
                          ),
                          1,
                        )}
                      </td>
                      <td className="py-1 text-end tabular-nums">
                        {num(
                          r.periods.reduce((s, x) => s + (x.weather?.cold ?? 0), 0),
                          1,
                        )}
                      </td>
                    </>
                  )}
                  {FIGURES.map((f) => (
                    <td key={f} className="py-1 text-end tabular-nums">
                      {show(f, totals[f])}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-600">{t("calrun.method")}</p>
        {withWeather && (
          <p className="mt-1 text-xs text-slate-600">
            {t("calrun.extraEnergy", {
              hvac: num(extraTotal("hvac_kwh") / 1000),
              switches: num(extraTotal("switch_heating_kwh") / 1000),
            })}{" "}
            {t("calrun.weatherMethod")}
          </p>
        )}
      </section>
      {r.notes.length > 0 && (
        <ul className="list-disc ps-5 text-xs text-slate-600">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Purpose: a share in percent with the library's value beside it and a way back to it. */
function ShareField({
  label,
  library,
  value,
  editable,
  onChange,
}: {
  label: string;
  library: number;
  value: number | undefined;
  editable: boolean;
  onChange: (v: number | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = String(Math.round((value ?? library) * 1000) / 10);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <label htmlFor={id} className="min-w-32 flex-1 text-sm">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <div className="field w-20">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            max={200}
            step={1}
            disabled={!editable}
            value={text ?? shown}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value.replace(",", "."));
              if (e.target.value.trim() === "" || !Number.isFinite(n) || n < 0 || n > 200) return;
              const share = Math.round(n * 10) / 1000;
              onChange(Math.abs(share - library) < 1e-9 ? null : share);
            }}
            onBlur={() => setText(null)}
            className="text-end"
          />
        </div>
        <span aria-hidden="true">%</span>
      </div>
      <span className="w-full text-xs text-slate-500">
        {t("prefs.delayDefault", { value: String(Math.round(library * 1000) / 10) })}
        {editable && value !== undefined && (
          <button
            type="button"
            className="ms-2 min-h-10 text-blue-700 underline"
            onClick={() => {
              setText(null);
              onChange(null);
            }}
          >
            {t("prefs.delayReset")}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Calendar runs (ADR-0020): many years, one date or a row of dates, from representative day types. This module
 * works out what the run needs from the project: each day type's day figures (vehicle-km, vehicle-hours,
 * passengers, energy, operating cost) from the same models as the Tables tab, and the periods with their day
 * counts from the project calendar. The worker (worker/src/mobsim_worker/jobs/calendar.py) runs each day type's
 * rail service and multiplies the day figures by the day counts.
 */
import { paramValue as benefitParam } from "../benefits/params";
import { type Category, type Estimate, OPERATING } from "../costs/model";
import { paramValue as costParam } from "../costs/params";
import type { EnergyEstimate } from "../energy/types";
import type { DayShares } from "../timetables/feed";
import type { MonthClimate } from "../../workspace/climate";
import {
  DAY_TYPES,
  datesOf,
  dayCounts,
  type DayTypeId,
  dayTypeOf,
  holidaysFor,
  type ServiceCalendar,
  serviceDayFor,
  type SimulationYears,
  yearList,
} from "../../workspace/calendar";
import type { PreferencesDoc } from "../../workspace/preferences";
import { hvacLoad, VARIANTS, variantShares, type WeatherPlan, type WeatherSettings } from "./weather";

/** Figures of one day (or summed over a period). Null when the project cannot tell yet. */
export interface DayFigures {
  vehicle_km: number | null;
  vehicle_hours: number | null;
  passengers: number | null;
  energy_kwh: number | null;
  operating_cost: number | null;
}
export const FIGURES = ["vehicle_km", "vehicle_hours", "passengers", "energy_kwh", "operating_cost"] as const;
export type Figure = (typeof FIGURES)[number];

/** Riders of a day type as a share of a weekday's (assumption library, project values on top). */
export const RIDER_SHARE: Record<Exclude<DayTypeId, "weekday">, string> = {
  saturday: "benefit.ridership.saturday_share",
  sunday: "benefit.ridership.sunday_share",
  holiday: "benefit.ridership.holiday_share",
};

/** Purpose: a day type's riders as a share of a weekday's (1 for weekdays). */
export function riderShare(dayType: DayTypeId, prefs: PreferencesDoc["values"] | undefined): number {
  return dayType === "weekday" ? 1 : benefitParam(RIDER_SHARE[dayType], "*", prefs)[1];
}

/** What the Tables tab knows about the project, a year at the weekday equivalents of `cost.days_per_year`. */
export interface TableFigures {
  /** The cost estimate (lines' vehicle-km and hours a year, operating cost items), or null before it is ready. */
  estimate: Estimate | null;
  /** Projected riders a weekday per line (low, medium, high), or null before the benefit estimate is ready. */
  riders: Record<string, [number, number, number]> | null;
  /** The energy estimate, or null without the energy plugin or before it is ready. */
  energy: EnergyEstimate | null;
}

/** The operating cost split into what each day of service costs and what a year costs whatever runs. */
export interface OperatingSplit {
  perDay: number;
  fixedPerYear: number;
}

/**
 * Purpose: split the estimate's operating cost into a cost per day of service and a fixed cost a year.
 * Service items (crew, energy and upkeep per km) are a year of weekday equivalents (`cost.days_per_year`);
 * upkeep of the infrastructure is fixed; the overheads, a share of service and upkeep per mode, are split in the
 * same proportion.
 */
export function operatingSplit(
  estimate: Estimate,
  prefs: PreferencesDoc["values"] | undefined,
): OperatingSplit {
  const days = costParam("cost.days_per_year", "*", prefs)[1];
  const byMode = new Map<string, Record<Category, number>>();
  for (const it of estimate.items) {
    if (!OPERATING.includes(it.category)) continue;
    const m = byMode.get(it.mode) ?? ({} as Record<Category, number>);
    m[it.category] = (m[it.category] ?? 0) + it.amount[1];
    byMode.set(it.mode, m);
  }
  let perYearService = 0;
  let fixed = 0;
  for (const m of byMode.values()) {
    const service = m.service ?? 0;
    const upkeep = m.maintenance ?? 0;
    const over = m.overheads ?? 0;
    const base = service + upkeep;
    perYearService += service + (base > 0 ? (over * service) / base : 0);
    fixed += upkeep + (base > 0 ? (over * upkeep) / base : over);
  }
  return { perDay: days > 0 ? perYearService / days : 0, fixedPerYear: fixed };
}

/**
 * Purpose: each day type's day figures. Every day type runs the lines' own service (the timetables have one
 * service for every day so far), so vehicle-km, vehicle-hours, energy and service cost are the same each day;
 * passengers are a weekday's riders times the day type's share.
 * Inputs: the Tables tab's figures and the project's values. Output: figures per day type and the fixed
 * operating cost a year (null when the cost estimate is not ready).
 */
export function dayFigures(
  t: TableFigures,
  prefs: PreferencesDoc["values"] | undefined,
  shares?: DayShares,
): { days: Record<DayTypeId, DayFigures>; fixedPerYear: number | null } {
  const days = costParam("cost.days_per_year", "*", prefs)[1];
  const lines = t.estimate?.lines ?? [];
  // A line's vehicle-km and hours on a day type: its weekday's times its service share on the day.
  const share = (id: string, dt: DayTypeId) => shares?.[id]?.[dt] ?? 1;
  const kmOn = (dt: DayTypeId) => lines.reduce((s, l) => s + l.kmPerYear * share(l.id, dt), 0) / days;
  const hoursOn = (dt: DayTypeId) => lines.reduce((s, l) => s + l.hoursPerYear * share(l.id, dt), 0) / days;
  const weekdayKm = kmOn("weekday");
  const weekdayRiders = t.riders ? Object.values(t.riders).reduce((s, r) => s + r[1], 0) : null;
  // The energy estimate is a year of the same vehicle-km.
  const energy = t.energy ? t.energy.total.energy_kwh / days : null;
  const split = t.estimate ? operatingSplit(t.estimate, prefs) : null;
  const out = {} as Record<DayTypeId, DayFigures>;
  for (const dt of DAY_TYPES) {
    // Energy and the cost of a day of service follow the day's vehicle-km.
    const ratio = weekdayKm > 0 ? kmOn(dt) / weekdayKm : 1;
    out[dt] = {
      vehicle_km: t.estimate ? kmOn(dt) : null,
      vehicle_hours: t.estimate ? hoursOn(dt) : null,
      passengers: weekdayRiders === null ? null : weekdayRiders * riderShare(dt, prefs),
      energy_kwh: energy === null ? null : energy * ratio,
      operating_cost: split ? split.perDay * ratio : null,
    };
  }
  return { days: out, fixedPerYear: split ? split.fixedPerYear : null };
}

/** One period of a calendar run: a year or a date, with its days per day type. */
export interface Period {
  label: string;
  /**
   * Days per day type (`weekday`) and, with the climate, expected days per weather variant (`weekday.hot`,
   * `weekday.very_hot`, `weekday.cold`; may be fractional).
   */
  counts: Record<string, number>;
  /** Share of a year the period stands for (the fixed operating cost). */
  share_of_year: number;
  /** The weather's extra energy, kWh: heating and air conditioning on board, switch heating. */
  extra?: { hvac_kwh: number; switch_heating_kwh: number };
}

/** A period with its days per day type in each month (January first), for the weather. */
interface MonthlyPeriod {
  period: Period;
  monthly: Record<DayTypeId, number[]>;
}

/** What a calendar run runs. */
export type RunMode = "years" | "date" | "days";

/** Most dates in a row of dates. */
export const MAX_DAYS = 366;

const daysInYear = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const zeros = () => Array.from({ length: 12 }, () => 0);

/**
 * Purpose: a year's days per day type in each month, scaled so each day type adds up to the year's day count
 * (the planner's own counts spread like the calendar's, or evenly over the year when the calendar has none).
 */
function monthlyOfYear(year: number, cal: ServiceCalendar, used: Record<DayTypeId, number>) {
  const holidays = holidaysFor(cal, year);
  const out = Object.fromEntries(DAY_TYPES.map((dt) => [dt, zeros()])) as Record<DayTypeId, number[]>;
  const all = zeros();
  for (const d of datesOf(year)) {
    const m = Number(d.slice(5, 7)) - 1;
    out[dayTypeOf(d, cal, holidays)]![m]! += 1;
    all[m]! += 1;
  }
  for (const dt of DAY_TYPES) {
    const counted = out[dt].reduce((s, x) => s + x, 0);
    const k = counted > 0 ? used[dt] / counted : 0;
    out[dt] = counted > 0 ? out[dt].map((x) => x * k) : all.map((x) => (x * used[dt]) / daysInYear(year));
  }
  return out;
}

function monthlyPeriods(
  mode: RunMode,
  cal: ServiceCalendar,
  span: { years?: SimulationYears; date?: string; from?: string; to?: string },
): MonthlyPeriod[] {
  if (mode === "years") {
    if (!span.years) return [];
    return yearList(span.years).map((y) => {
      const used = dayCounts(y, cal).used;
      return {
        period: { label: String(y), counts: { ...used }, share_of_year: 1 },
        monthly: monthlyOfYear(y, cal, used),
      };
    });
  }
  const one = (date: string): MonthlyPeriod => {
    const y = Number(date.slice(0, 4));
    const dt = dayTypeOf(date, cal, holidaysFor(cal, y));
    const monthly = Object.fromEntries(DAY_TYPES.map((d) => [d, zeros()])) as Record<DayTypeId, number[]>;
    monthly[dt][Number(date.slice(5, 7)) - 1] = 1;
    return { period: { label: date, counts: { [dt]: 1 }, share_of_year: 1 / daysInYear(y) }, monthly };
  };
  if (mode === "date") return span.date && DATE.test(span.date) ? [one(span.date)] : [];
  if (!span.from || !span.to || !DATE.test(span.from) || !DATE.test(span.to)) return [];
  const out: MonthlyPeriod[] = [];
  const end = Date.parse(`${span.to}T00:00:00Z`);
  for (let t = Date.parse(`${span.from}T00:00:00Z`); t <= end && out.length <= MAX_DAYS; t += 86_400_000)
    out.push(one(new Date(t).toISOString().slice(0, 10)));
  return out;
}

/**
 * Purpose: the periods of a run: every simulation year with its day counts, one date, or each date of a row
 * (one more than `MAX_DAYS` at most, so the panel can tell the row is too long).
 */
export function periodsFor(
  mode: RunMode,
  cal: ServiceCalendar,
  span: { years?: SimulationYears; date?: string; from?: string; to?: string },
): Period[] {
  return monthlyPeriods(mode, cal, span).map((p) => p.period);
}

/** The climate and what it costs in energy, for `weatherPeriods`. */
export interface WeatherInput {
  months: MonthClimate[];
  settings: WeatherSettings;
  /** Heating and air conditioning at full power for a day's service, kWh (null when the service is unknown). */
  hvacFullKwhPerDay: number | null;
  /** Switch heating on a frost day, kWh. */
  switchKwhPerFrostDay: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Purpose: the periods of a run with each day type split into ordinary days and expected hot, very hot and cold
 * days (from each month's climate), and the weather's extra energy.
 */
export function weatherPeriods(
  mode: RunMode,
  cal: ServiceCalendar,
  span: { years?: SimulationYears; date?: string; from?: string; to?: string },
  wx: WeatherInput,
): Period[] {
  const shares = wx.months.map((m) => variantShares(m, wx.settings));
  const loads = wx.months.map((m) => hvacLoad(m.mean_c, wx.settings));
  return monthlyPeriods(mode, cal, span).map(({ period, monthly }) => {
    const counts: Record<string, number> = {};
    const allDays = zeros();
    for (const dt of DAY_TYPES) {
      const total = period.counts[dt] ?? 0;
      if (!(total > 0)) continue;
      let rest = total;
      for (const v of VARIANTS) {
        const n = r3(monthly[dt].reduce((s, d, m) => s + d * shares[m]![v], 0));
        if (n > 0) counts[`${dt}.${v}`] = n;
        rest -= n;
      }
      if (r3(rest) > 0) counts[dt] = r3(rest);
      monthly[dt].forEach((d, m) => (allDays[m]! += d));
    }
    const hvac = wx.hvacFullKwhPerDay ?? 0;
    return {
      ...period,
      counts,
      extra: {
        hvac_kwh: Math.round(allDays.reduce((s, d, m) => s + d * hvac * loads[m]!, 0)),
        switch_heating_kwh: Math.round(
          allDays.reduce((s, d, m) => s + d * shares[m]!.cold * wx.switchKwhPerFrostDay, 0),
        ),
      },
    };
  });
}

/** The plan the worker runs (apps/api/src/simulation/calendar.ts `calendarPlan`). */
export interface CalendarPlan {
  mode: RunMode;
  /** Each day type's service day and day figures, and its own service lines when they differ (JSON text). */
  day_types: Record<DayTypeId, { from_s: number; to_s: number; per_day: DayFigures; lines?: string }>;
  periods: Period[];
  fixed_per_year: { operating_cost: number | null };
  currency: string | null;
  /** The weather's effects on the rail runs; absent without a climate. */
  weather?: WeatherPlan;
}

/**
 * Purpose: the plan of a run: each day type's service day, day figures and, when its lines run other times than
 * on a weekday, its own service lines; and the periods.
 */
export function buildPlan(
  mode: RunMode,
  cal: ServiceCalendar,
  periods: Period[],
  figures: ReturnType<typeof dayFigures>,
  currency: string | null,
  weather?: WeatherPlan,
  dayLines?: Partial<Record<DayTypeId, string>>,
): CalendarPlan {
  const day_types = {} as CalendarPlan["day_types"];
  for (const dt of DAY_TYPES) {
    const d = serviceDayFor(cal, dt);
    const lines = dayLines?.[dt];
    day_types[dt] = {
      from_s: d.firstS,
      to_s: d.lastS,
      per_day: figures.days[dt],
      ...(lines ? { lines } : {}),
    };
  }
  return {
    mode,
    day_types,
    periods,
    fixed_per_year: { operating_cost: figures.fixedPerYear },
    currency,
    ...(weather ? { weather } : {}),
  };
}

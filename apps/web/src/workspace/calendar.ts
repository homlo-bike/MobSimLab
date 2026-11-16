import { DEFAULT_SERVICE_DAY, type ServiceDay } from "../features/journey-planner/network";
import type { PreferencesDoc } from "./preferences";

/**
 * The project calendar (ADR-0020): day types, public holidays and the service day of each day type, kept in the
 * project's preferences document (`calendar`). A run simulates one representative day per day type; a year's
 * figures are the day type's figures times the number of its days in that year (`dayCounts`).
 */

/** Day types of the calendar; also the timetables' service ids. */
export type DayTypeId = "weekday" | "saturday" | "sunday" | "holiday";
export const DAY_TYPES: readonly DayTypeId[] = ["weekday", "saturday", "sunday", "holiday"];

/** One public holiday. */
export interface Holiday {
  /** YYYY-MM-DD. */
  date: string;
  /** English name (or the planner's own). */
  name: string;
  /** Name in the country's language. */
  localName?: string;
  /** Regions (ISO 3166-2) it is limited to; null or absent for the whole country. */
  regions?: string[] | null;
}

/** The service day of a day type, in minutes after midnight (last departure may pass 24:00). */
export interface ServiceWindow {
  firstMin: number;
  lastMin: number;
  /** Peak windows `[from, to)`, minutes. */
  peaks: [number, number][];
}

/** The calendar as the project keeps it. Everything is optional; absent parts take the defaults. */
export interface ServiceCalendar {
  /** ISO 3166-1 alpha-2 country of the public holidays; absent: the country at the project's location. */
  country?: string;
  /** ISO 3166-2 region (such as DE-BY) whose regional holidays also count; absent: national ones only. */
  region?: string;
  /** The project's copy of the fetched public holidays, by year ("2027"). */
  fetched?: Record<string, Holiday[]>;
  /** Days off the project adds. */
  added?: Holiday[];
  /** Dates of fetched holidays the project does not count. */
  removed?: string[];
  /** Service day per day type; absent: the app's default service day. */
  days?: Partial<Record<DayTypeId, ServiceWindow>>;
  /** The planner's own number of days per day type, by year ("2027"); absent: counted from the calendar. */
  counts?: Record<string, Partial<Record<DayTypeId, number>>>;
}

/** Simulation years of the project, inclusive. */
export interface SimulationYears {
  first: number;
  last: number;
}

/** Most years one project simulates. */
export const MAX_YEARS = 60;
/** Years shown and simulated by default, from this year on. */
export const DEFAULT_YEAR_SPAN = 10;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isYear = (y: unknown): y is number =>
  Number.isInteger(y) && (y as number) >= MIN_YEAR && (y as number) <= MAX_YEAR;

/** Purpose: the project's calendar; an absent or broken document gives the defaults. */
export function calendarFrom(doc: PreferencesDoc | null | undefined): ServiceCalendar {
  const c = doc?.calendar;
  return c && typeof c === "object" ? c : {};
}

/** Purpose: the document with a new calendar (empty parts removed). */
export function withCalendar(doc: PreferencesDoc | null | undefined, cal: ServiceCalendar): PreferencesDoc {
  const clean: ServiceCalendar = { ...cal };
  for (const k of Object.keys(clean) as (keyof ServiceCalendar)[]) {
    const v = clean[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete clean[k];
    else if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) delete clean[k];
  }
  const next: PreferencesDoc = { ...(doc ?? {}), values: { ...(doc?.values ?? {}) } };
  if (Object.keys(clean).length) next.calendar = clean;
  else delete next.calendar;
  return next;
}

/** Purpose: the project's simulation years; absent or broken: this year and the following ones. */
export function simulationYearsFrom(
  doc: PreferencesDoc | null | undefined,
  today: Date = new Date(),
): SimulationYears {
  const y = doc?.simulationYears;
  if (y && isYear(y.first) && isYear(y.last) && y.last >= y.first && y.last - y.first < MAX_YEARS)
    return { first: y.first, last: y.last };
  const first = today.getFullYear();
  return { first, last: first + DEFAULT_YEAR_SPAN - 1 };
}

/** Purpose: the document with new simulation years, or without them (`null`) so the defaults apply. */
export function withSimulationYears(
  doc: PreferencesDoc | null | undefined,
  years: SimulationYears | null,
): PreferencesDoc {
  const next: PreferencesDoc = { ...(doc ?? {}), values: { ...(doc?.values ?? {}) } };
  if (years === null) delete next.simulationYears;
  else {
    if (!isYear(years.first) || !isYear(years.last) || years.last < years.first)
      throw new Error("the last year must be on or after the first");
    if (years.last - years.first >= MAX_YEARS) throw new Error(`at most ${MAX_YEARS} years`);
    next.simulationYears = { first: years.first, last: years.last };
  }
  return next;
}

/** Purpose: every year from the first to the last. */
export function yearList(y: SimulationYears): number[] {
  return Array.from({ length: y.last - y.first + 1 }, (_, i) => y.first + i);
}

/** Purpose: the service day of a day type (seconds), as the timetables, GIS volumes and runs take it. */
export function serviceDayFor(cal: ServiceCalendar, dayType: DayTypeId): ServiceDay {
  const w = cal.days?.[dayType];
  if (!w || !(w.lastMin > w.firstMin)) return DEFAULT_SERVICE_DAY;
  return {
    firstS: w.firstMin * 60,
    lastS: w.lastMin * 60,
    peaks: (w.peaks ?? []).filter(([a, b]) => b > a).map(([a, b]) => [a * 60, b * 60] as [number, number]),
  };
}

/** Purpose: whether a holiday counts for the calendar's region (national ones always do). */
function inRegion(h: Holiday, region: string | undefined): boolean {
  if (!h.regions || h.regions.length === 0) return true;
  return !!region && h.regions.includes(region);
}

/**
 * Purpose: the days off that count in a year: the fetched public holidays (national, and the region's), plus
 * the project's added days, minus its removed ones. Sorted, without repeats.
 * Inputs: the calendar, the year, and the fetched holidays (default: the project's copy of that year).
 */
export function holidaysFor(
  cal: ServiceCalendar,
  year: number,
  fetched: readonly Holiday[] = cal.fetched?.[String(year)] ?? [],
): string[] {
  const prefix = `${year}-`;
  const removed = new Set(cal.removed ?? []);
  const out = new Set<string>();
  for (const h of fetched) if (h.date.startsWith(prefix) && inRegion(h, cal.region)) out.add(h.date);
  for (const d of removed) out.delete(d);
  for (const h of cal.added ?? []) if (h.date.startsWith(prefix) && DATE.test(h.date)) out.add(h.date);
  return [...out].sort();
}

/**
 * Purpose: the day type of a date: a counted holiday is "holiday" whatever the weekday, else Saturday, Sunday
 * or weekday.
 * Inputs: date YYYY-MM-DD, the calendar, the year's counted holidays (`holidaysFor`).
 */
export function dayTypeOf(date: string, _cal: ServiceCalendar, holidays: readonly string[]): DayTypeId {
  if (holidays.includes(date)) return "holiday";
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 6 ? "saturday" : wd === 0 ? "sunday" : "weekday";
}

/** Purpose: every date of a year, YYYY-MM-DD. */
export function datesOf(year: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, 0, 1); new Date(t).getUTCFullYear() === year; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Days of each day type in a year. */
export type DayCounts = Record<DayTypeId, number>;

/** Purpose: the number of days of each day type in a year, counted from the calendar. */
export function countDays(year: number, cal: ServiceCalendar, holidays: readonly string[]): DayCounts {
  const out: DayCounts = { weekday: 0, saturday: 0, sunday: 0, holiday: 0 };
  const set = new Set(holidays);
  for (const d of datesOf(year)) out[dayTypeOf(d, cal, set.has(d) ? [d] : [])]++;
  return out;
}

/** A year's day counts: what the calendar gives, what is used, and which ones the planner set. */
export interface YearCounts {
  year: number;
  counted: DayCounts;
  used: DayCounts;
  own: Partial<Record<DayTypeId, true>>;
  /** Whether the year's public holidays are in the project's copy (else only the added days count). */
  hasHolidays: boolean;
}

/** Purpose: a year's day counts with the planner's own numbers applied. */
export function dayCounts(year: number, cal: ServiceCalendar): YearCounts {
  const counted = countDays(year, cal, holidaysFor(cal, year));
  const own: YearCounts["own"] = {};
  const used = { ...counted };
  const set = cal.counts?.[String(year)] ?? {};
  for (const dt of DAY_TYPES) {
    const v = set[dt];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 366) {
      used[dt] = v;
      own[dt] = true;
    }
  }
  return { year, counted, used, own, hasHolidays: !!cal.fetched?.[String(year)] };
}

/** Purpose: the calendar with one day count of a year set by the planner, or back to the counted one (`null`). */
export function withDayCount(
  cal: ServiceCalendar,
  year: number,
  dayType: DayTypeId,
  value: number | null,
): ServiceCalendar {
  const counts = { ...(cal.counts ?? {}) };
  const y = { ...(counts[String(year)] ?? {}) };
  if (value === null) delete y[dayType];
  else y[dayType] = value;
  if (Object.keys(y).length) counts[String(year)] = y;
  else delete counts[String(year)];
  return { ...cal, counts };
}

/** The service day every day type has until the project sets its own, in minutes. */
export const DEFAULT_WINDOW: ServiceWindow = {
  firstMin: DEFAULT_SERVICE_DAY.firstS / 60,
  lastMin: DEFAULT_SERVICE_DAY.lastS / 60,
  peaks: DEFAULT_SERVICE_DAY.peaks.map(([a, b]) => [a / 60, b / 60] as [number, number]),
};

/** Purpose: a day type's service day in minutes: the project's, else the default. */
export function serviceWindowOf(cal: ServiceCalendar, dayType: DayTypeId): ServiceWindow {
  const w = cal.days?.[dayType];
  return w && w.lastMin > w.firstMin ? w : DEFAULT_WINDOW;
}

/** Purpose: whether a service day makes sense: it ends after it starts, and each peak ends after it starts. */
export function validWindow(w: ServiceWindow): boolean {
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 30 * 60;
  return (
    ok(w.firstMin) &&
    ok(w.lastMin) &&
    w.lastMin > w.firstMin &&
    w.peaks.length <= 4 &&
    w.peaks.every(([a, b]) => ok(a) && ok(b) && b > a)
  );
}

/**
 * Purpose: the calendar with a day type's service day set by the planner, or back to the default (`null`, or a
 * service day equal to the default). A service day that makes no sense is refused (the calendar is returned
 * unchanged).
 */
export function withServiceWindow(
  cal: ServiceCalendar,
  dayType: DayTypeId,
  w: ServiceWindow | null,
): ServiceCalendar {
  if (w && !validWindow(w)) return cal;
  const days = { ...(cal.days ?? {}) };
  if (!w || JSON.stringify(w) === JSON.stringify(DEFAULT_WINDOW)) delete days[dayType];
  else days[dayType] = { firstMin: w.firstMin, lastMin: w.lastMin, peaks: w.peaks.map(([a, b]) => [a, b]) };
  const next: ServiceCalendar = { ...cal, days };
  if (!Object.keys(days).length) delete next.days;
  return next;
}

/** Purpose: minutes after midnight as HH:MM (past 24:00 for after midnight). */
export function clockText(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Purpose: HH:MM (up to 29:59) as minutes after midnight, or null. */
export function parseClock(t: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 29 && min <= 59 ? h * 60 + min : null;
}

/** Purpose: the calendar with a holiday added by the planner, or a fetched one restored. */
export function withHolidayAdded(cal: ServiceCalendar, h: Holiday): ServiceCalendar {
  if (!DATE.test(h.date)) throw new Error("not a date");
  const removed = (cal.removed ?? []).filter((d) => d !== h.date);
  const fetched = Object.values(cal.fetched ?? {}).some((l) => l.some((x) => x.date === h.date));
  const added = (cal.added ?? []).filter((x) => x.date !== h.date);
  if (!fetched) added.push({ date: h.date, name: h.name.trim().slice(0, 100) });
  return { ...cal, removed, added: added.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Purpose: the calendar without a holiday: an added one is dropped, a fetched one no longer counts. */
export function withHolidayRemoved(cal: ServiceCalendar, date: string): ServiceCalendar {
  const added = (cal.added ?? []).filter((x) => x.date !== date);
  const fetched = Object.values(cal.fetched ?? {}).some((l) => l.some((x) => x.date === date));
  const removed = new Set(cal.removed ?? []);
  if (fetched) removed.add(date);
  return { ...cal, added, removed: [...removed].sort() };
}

/** A year's holidays as the calendar section lists them. */
export interface HolidayRow extends Holiday {
  /** "fetched" from Nager.Date, or "added" by the planner. */
  origin: "fetched" | "added";
  /** Whether it counts (a removed fetched day, or another region's, does not). */
  counts: boolean;
  /** Why it does not count. */
  reason?: "removed" | "region";
}

/** Purpose: every holiday of a year the section shows, fetched and added, in date order. */
export function holidayRows(cal: ServiceCalendar, year: number): HolidayRow[] {
  const removed = new Set(cal.removed ?? []);
  const rows: HolidayRow[] = [];
  for (const h of cal.fetched?.[String(year)] ?? []) {
    const region = inRegion(h, cal.region);
    const off = removed.has(h.date);
    rows.push({
      ...h,
      origin: "fetched",
      counts: region && !off,
      ...(off ? { reason: "removed" as const } : !region ? { reason: "region" as const } : {}),
    });
  }
  for (const h of cal.added ?? [])
    if (h.date.startsWith(`${year}-`)) rows.push({ ...h, origin: "added", counts: true });
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.origin.localeCompare(b.origin));
}

/** Purpose: the calendar with a year's fetched holidays kept as the project's copy. */
export function withFetched(cal: ServiceCalendar, year: number, days: readonly Holiday[]): ServiceCalendar {
  return {
    ...cal,
    fetched: {
      ...(cal.fetched ?? {}),
      [String(year)]: days.map((h) => ({
        date: h.date,
        name: h.name,
        ...(h.localName ? { localName: h.localName } : {}),
        ...(h.regions?.length ? { regions: [...h.regions] } : {}),
      })),
    },
  };
}

/** The calls the calendar makes; tests pass their own. */
export interface CalendarApi {
  /** A country's public holidays in a year (Nager.Date through the API). */
  holidays(country: string, year: number): Promise<Holiday[]>;
}

/** Purpose: the calendar API over HTTP, with answers kept for the session. */
export function calendarApi(fetchImpl: typeof fetch = (...a) => fetch(...a)): CalendarApi {
  const cache = new Map<string, Promise<Holiday[]>>();
  return {
    holidays(country, year) {
      const key = `${country.toUpperCase()}/${year}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const p = fetchImpl(
        `/api/calendar/holidays?country=${encodeURIComponent(country)}&year=${encodeURIComponent(year)}`,
        { credentials: "same-origin" },
      ).then(async (res) => {
        if (!res.ok) {
          const msg = await res
            .json()
            .then((j: { message?: string }) => j.message)
            .catch(() => undefined);
          throw new Error(msg ?? `Request failed (${res.status})`);
        }
        return ((await res.json()) as { holidays: Holiday[] }).holidays;
      });
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      return p;
    },
  };
}

const SHARED = calendarApi();

/** Purpose: a country's public holidays in a year, fetched once per session. */
export function fetchPublicHolidays(country: string, year: number): Promise<Holiday[]> {
  return SHARED.holidays(country, year);
}

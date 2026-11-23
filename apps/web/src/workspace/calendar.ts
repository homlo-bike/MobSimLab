import { withProjectFacts } from "../geodata/projectData";
import { DEFAULT_SERVICE_DAY, type ServiceDay } from "../features/journey-planner/network";
import type { PreferencesDoc } from "./preferences";
import { withApiMsg } from "../i18n/engine";

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
  /** The weekend; absent: the usual one in the calendar's country, else Saturday and Sunday. */
  weekend?: Weekend;
}

/**
 * The days of the weekend, as days of the week (0 Sunday to 6 Saturday). The main rest day's dates are the
 * "sunday" day type and the other day's the "saturday" one, so a Friday and Saturday weekend runs its Sunday
 * service on Fridays. A one-day weekend has no "saturday" days.
 */
export interface Weekend {
  /** The main rest day (Sunday in most countries, Friday in a Friday and Saturday weekend). */
  rest: number;
  /** The other weekend day; absent: a one-day weekend. */
  second?: number;
}

/** The weekend of most countries: Saturday and Sunday. */
export const SATURDAY_SUNDAY: Weekend = { rest: 0, second: 6 };
/** The weekend of most Arab countries: Friday and Saturday. */
export const FRIDAY_SATURDAY: Weekend = { rest: 5, second: 6 };
/** The weekends the planner can choose from, as days of the week; the country sets which one is the rest day. */
export const WEEKEND_DAYS: readonly (readonly number[])[] = [[6, 0], [5, 6], [4, 5], [0], [5], [6]];

/** Countries (ISO alpha-2) whose weekend is Friday and Saturday, for browsers without the Unicode week data. */
const FRIDAY_SATURDAY_COUNTRIES = new Set([
  "BD",
  "BH",
  "DZ",
  "EG",
  "IL",
  "IQ",
  "JO",
  "KW",
  "LY",
  "MV",
  "OM",
  "QA",
  "SA",
  "SD",
  "SY",
  "YE",
]);

const isDay = (d: unknown): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d < 7;
const isWeekend = (w: unknown): w is Weekend =>
  !!w &&
  typeof w === "object" &&
  isDay((w as Weekend).rest) &&
  ((w as Weekend).second === undefined ||
    (isDay((w as Weekend).second) && (w as Weekend).second !== (w as Weekend).rest));

/**
 * Purpose: the weekend days of a country (ISO alpha-2) from the Unicode CLDR week data, which the browser's Intl
 * API holds (0 Sunday to 6 Saturday); null when the country is not valid or the browser has no week data.
 */
export function cldrWeekendDays(country: string | null | undefined): number[] | null {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return null;
  try {
    const locale = new Intl.Locale(`und-${country.toUpperCase()}`) as Intl.Locale & {
      getWeekInfo?: () => { weekend?: number[] };
      weekInfo?: { weekend?: number[] };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // Intl numbers the days 1 Monday to 7 Sunday.
    const days = [...new Set((info?.weekend ?? []).map((d) => d % 7))].filter(isDay);
    return days.length >= 1 && days.length <= 2 ? days : null;
  } catch {
    return null;
  }
}

/**
 * Purpose: a weekend from its days in a country: the main rest day is Sunday if it is one of them, else Saturday in
 * Israel (the Sabbath), else Friday, else the later day.
 */
export function weekendFromDays(days: readonly number[], country?: string | null): Weekend {
  const set = [...new Set(days)].filter(isDay);
  if (set.length === 0) return SATURDAY_SUNDAY;
  if (set.length === 1) return { rest: set[0]! };
  const rest = set.includes(0)
    ? 0
    : country?.toUpperCase() === "IL" && set.includes(6)
      ? 6
      : set.includes(5)
        ? 5
        : set[set.length - 1]!;
  return { rest, second: set.find((d) => d !== rest) };
}

/** Purpose: the days of a weekend, in the order of a week that starts on Monday. */
export function weekendDays(w: Weekend): number[] {
  return (w.second === undefined ? [w.rest] : [w.rest, w.second]).sort(
    (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
  );
}

/**
 * Purpose: the usual weekend in a country (ISO alpha-2), from the Unicode CLDR week data (`cldrWeekendDays`);
 * Saturday and Sunday when unknown.
 */
export function countryWeekend(country: string | null | undefined): Weekend {
  const days = cldrWeekendDays(country);
  if (days) return weekendFromDays(days, country);
  return country && FRIDAY_SATURDAY_COUNTRIES.has(country.toUpperCase())
    ? weekendFromDays([5, 6], country)
    : SATURDAY_SUNDAY;
}

/** Purpose: the calendar's weekend: the planner's choice, else the usual one in its country. */
export function weekendOf(cal: ServiceCalendar): Weekend {
  return isWeekend(cal.weekend) ? cal.weekend : countryWeekend(cal.country);
}

/** Purpose: whether two weekends are the same days with the same rest day. */
export function sameWeekend(a: Weekend, b: Weekend): boolean {
  return a.rest === b.rest && a.second === b.second;
}

/** Purpose: the calendar with the planner's weekend (kept even when it is the country's usual one). */
export function withWeekend(cal: ServiceCalendar, w: Weekend): ServiceCalendar {
  return { ...cal, weekend: w.second === undefined ? { rest: w.rest } : { rest: w.rest, second: w.second } };
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
 * Purpose: the day type of a date: a counted holiday is "holiday" whatever the weekday; the weekend's main rest
 * day is "sunday" and its other day "saturday" (`weekendOf`); every other day is a weekday.
 * Inputs: date YYYY-MM-DD, the calendar, the year's counted holidays (`holidaysFor`).
 */
export function dayTypeOf(date: string, cal: ServiceCalendar, holidays: readonly string[]): DayTypeId {
  if (holidays.includes(date)) return "holiday";
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const w = weekendOf(cal);
  return wd === w.rest ? "sunday" : wd === w.second ? "saturday" : "weekday";
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
        withProjectFacts(
          `/api/calendar/holidays?country=${encodeURIComponent(country)}&year=${encodeURIComponent(year)}`,
        ),
        { credentials: "same-origin" },
      ).then(async (res) => {
        if (!res.ok) {
          const j = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
          throw withApiMsg(new Error(j?.message ?? `Request failed (${res.status})`), j);
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

/**
 * Countries (ISO alpha-2) where Eid al-Fitr and Eid al-Adha are public holidays. Where the fetched holidays
 * (Nager.Date) lack them, the calendar adds them (`withEid`).
 */
const EID_COUNTRIES = new Set([
  "AE",
  "AF",
  "AL",
  "AZ",
  "BD",
  "BF",
  "BH",
  "BN",
  "DJ",
  "DZ",
  "EG",
  "GM",
  "GN",
  "ID",
  "IQ",
  "IR",
  "JO",
  "KG",
  "KM",
  "KW",
  "LB",
  "LY",
  "MA",
  "ML",
  "MR",
  "MV",
  "MY",
  "NE",
  "NG",
  "OM",
  "PK",
  "PS",
  "QA",
  "SA",
  "SD",
  "SL",
  "SN",
  "SO",
  "SY",
  "TD",
  "TJ",
  "TN",
  "TR",
  "UZ",
  "YE",
]);

/** The two Eids: Hijri month, first day and number of days off. */
const EIDS = [
  { name: "Eid al-Fitr", localName: "عيد الفطر", month: 10, day: 1, days: 3 },
  { name: "Eid al-Adha", localName: "عيد الأضحى", month: 12, day: 10, days: 4 },
] as const;

let hijri: Intl.DateTimeFormat | null | undefined;
/** Purpose: the Umm al-Qura month and day of a date, or null where the browser has no Islamic calendar. */
function hijriOf(date: string): { month: number; day: number } | null {
  if (hijri === undefined) {
    try {
      const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
        month: "numeric",
        day: "numeric",
        timeZone: "UTC",
      });
      hijri = f.resolvedOptions().calendar.startsWith("islamic") ? f : null;
    } catch {
      hijri = null;
    }
  }
  if (!hijri) return null;
  const parts = hijri.formatToParts(new Date(`${date}T00:00:00Z`));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { month: n("month"), day: n("day") };
}

/**
 * Purpose: the days off of Eid al-Fitr (3 days from 1 Shawwal) and Eid al-Adha (4 days from 10 Dhu al-Hijjah)
 * in a Gregorian year, from the Umm al-Qura calendar. Where the moon is sighted, the actual day can be one
 * earlier or later. Empty where the browser has no Islamic calendar.
 */
export function eidHolidays(year: number): Holiday[] {
  const out: Holiday[] = [];
  for (const date of datesOf(year)) {
    const h = hijriOf(date);
    if (!h) return [];
    for (const e of EIDS) {
      const k = h.day - e.day;
      if (h.month === e.month && k >= 0 && k < e.days)
        out.push({
          date,
          name: k === 0 ? e.name : `${e.name} (day ${k + 1})`,
          localName: k === 0 ? e.localName : `${e.localName} (${k + 1})`,
        });
    }
  }
  return out;
}

/** Purpose: whether Eid al-Fitr and Eid al-Adha are public holidays in a country (ISO alpha-2). */
export function observesEid(country: string | null | undefined): boolean {
  return !!country && EID_COUNTRIES.has(country.toUpperCase());
}

/**
 * Purpose: a year's fetched holidays with the Eid days added where the country observes Eid and the list has
 * neither a holiday within two days of an Eid's first day nor a holiday named after it. Other countries'
 * lists are returned as they are.
 */
export function withEid(
  country: string | null | undefined,
  year: number,
  days: readonly Holiday[],
): Holiday[] {
  if (!observesEid(country)) return [...days];
  const eid = eidHolidays(year);
  const out = [...days];
  for (const e of EIDS) {
    const mine = eid.filter((h) => h.name.startsWith(e.name));
    const first = mine[0];
    if (!first) continue;
    const t0 = Date.parse(`${first.date}T00:00:00Z`);
    const named = new RegExp(
      e.name === "Eid al-Fitr"
        ? "fitr|ramazan|ramadan|lebaran|aidilfitri"
        : "adha|kurban|qurban|aidiladha|sacrifice",
      "i",
    );
    const listed = days.some(
      (h) =>
        named.test(`${h.name} ${h.localName ?? ""}`) ||
        Math.abs(Date.parse(`${h.date}T00:00:00Z`) - t0) <= 2 * 86_400_000,
    );
    if (!listed) out.push(...mine.filter((h) => !out.some((x) => x.date === h.date)));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Purpose: the calendar with what the country's customs add when the planner has not set them: its usual weekend
 * and, in each year with fetched holidays, the Eid days the list lacks (`withEid`). Unchanged for a country
 * whose customs are the defaults, or when there is nothing to add.
 */
export function withCountryCustoms(
  cal: ServiceCalendar,
  country: string | null | undefined,
): ServiceCalendar {
  let next = cal;
  if (!cal.weekend && country && !sameWeekend(countryWeekend(country), SATURDAY_SUNDAY))
    next = withWeekend(next, countryWeekend(country));
  if (observesEid(country) && cal.fetched) {
    const fetched = { ...cal.fetched };
    let changed = false;
    for (const [y, days] of Object.entries(cal.fetched)) {
      const full = withEid(country, Number(y), days);
      if (full.length !== days.length) {
        fetched[y] = full;
        changed = true;
      }
    }
    if (changed) next = { ...next, fetched };
  }
  return next;
}

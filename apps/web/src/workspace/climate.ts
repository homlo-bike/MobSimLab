/**
 * The project's climate (ADR-0020 weather day types): twelve months of air temperatures at the project's
 * location, fetched once from Open-Meteo (1991–2020, through the API) and kept in the project's preferences, with
 * the planner's own values on top. Calendar runs split each day type into ordinary, hot, very hot and cold days
 * from it (features/calendar-run/weather.ts). The climate is the same every simulation year.
 */
import { withProjectFacts } from "../geodata/projectData";
import type { PreferencesDoc } from "./preferences";
import { withApiMsg } from "../i18n/engine";

/** One month's air temperatures, °C. */
export interface MonthClimate {
  /** Average of the daily mean. */
  mean_c: number;
  /** Average of the daily maximum. */
  max_c: number;
  /** Average of the daily minimum. */
  min_c: number;
  /** Spread (standard deviation) of the daily maximum. */
  max_sd_c: number;
  /** Spread (standard deviation) of the daily minimum. */
  min_sd_c: number;
}
export const CLIMATE_FIELDS = ["mean_c", "max_c", "min_c", "max_sd_c", "min_sd_c"] as const;
export type ClimateField = (typeof CLIMATE_FIELDS)[number];

/** What Open-Meteo gave for the project's location. */
export interface FetchedClimate {
  lat: number;
  lon: number;
  from_year: number;
  to_year: number;
  months: MonthClimate[];
}

/** The project's climate as stored in its preferences. */
export interface ProjectClimate {
  fetched?: FetchedClimate;
  /** The planner's own values, by month (1–12). */
  own?: Record<string, Partial<MonthClimate>>;
  /**
   * A large project area's climate zones (climateZones.ts), each with its own climate; absent or fewer than two:
   * the one climate above holds for the whole project.
   */
  zones?: ZoneClimate[];
}

/** One climate zone of a large project area, with its climate. */
export interface ZoneClimate {
  /** The area polygon's id, with `-n` for a part of a large polygon. */
  id: string;
  name: string;
  /** Where its climate is asked for, [lon, lat], rounded to 0.1°. */
  at: [number, number];
  fetched?: FetchedClimate;
  own?: Record<string, Partial<MonthClimate>>;
}

/** Purpose: the project's climate from its preferences (empty when it has none yet). */
export function climateFrom(doc: PreferencesDoc | null | undefined): ProjectClimate {
  return doc?.climate ?? {};
}

/** Purpose: the preferences with the climate replaced. */
export function withClimate(doc: PreferencesDoc | null | undefined, c: ProjectClimate): PreferencesDoc {
  const next: PreferencesDoc = { ...(doc ?? {}), values: { ...(doc?.values ?? {}) } };
  if (c.fetched || (c.own && Object.keys(c.own).length) || (c.zones && c.zones.length)) next.climate = c;
  else delete next.climate;
  return next;
}

const ok = (v: unknown, field: ClimateField): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 70 && (!field.endsWith("_sd_c") || v >= 0);

/** One month's values as used, with which ones the planner set. */
export interface ClimateRow {
  month: number;
  used: Partial<MonthClimate>;
  own: Partial<Record<ClimateField, true>>;
  fetched: Partial<MonthClimate>;
}

/** Purpose: each month's values: Open-Meteo's, with the planner's on top. */
export function climateRows(c: ProjectClimate): ClimateRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const fetched: Partial<MonthClimate> = c.fetched?.months[i] ?? {};
    const own: ClimateRow["own"] = {};
    const used: Partial<MonthClimate> = { ...fetched };
    const set = c.own?.[String(i + 1)] ?? {};
    for (const f of CLIMATE_FIELDS) {
      const v = set[f];
      if (ok(v, f)) {
        used[f] = v;
        own[f] = true;
      }
    }
    return { month: i + 1, used, own, fetched };
  });
}

/** Purpose: the twelve months a run uses, or null while any value is missing. */
export function monthsOf(c: ProjectClimate): MonthClimate[] | null {
  const rows = climateRows(c);
  if (rows.some((r) => CLIMATE_FIELDS.some((f) => r.used[f] === undefined))) return null;
  return rows.map((r) => r.used as MonthClimate);
}

/** Purpose: the climate with one month's value set by the planner, or back to Open-Meteo's (`null`). */
export function withClimateValue(
  c: ProjectClimate,
  month: number,
  field: ClimateField,
  value: number | null,
): ProjectClimate {
  const own = { ...(c.own ?? {}) };
  const m = { ...(own[String(month)] ?? {}) };
  if (value === null) delete m[field];
  else m[field] = value;
  if (Object.keys(m).length) own[String(month)] = m;
  else delete own[String(month)];
  return { ...c, own };
}

/** Purpose: the climate with Open-Meteo's months kept as the project's copy. */
export function withFetchedClimate(c: ProjectClimate, fetched: FetchedClimate): ProjectClimate {
  return {
    ...c,
    fetched: {
      lat: fetched.lat,
      lon: fetched.lon,
      from_year: fetched.from_year,
      to_year: fetched.to_year,
      months: fetched.months.map((m) => ({
        mean_c: m.mean_c,
        max_c: m.max_c,
        min_c: m.min_c,
        max_sd_c: m.max_sd_c,
        min_sd_c: m.min_sd_c,
      })),
    },
  };
}

/**
 * Purpose: where the project's climate is asked for: the centre of its area, rounded to 0.1° as the API keeps
 * the climate it looked up when the area was saved; else the drawing's place; null with neither.
 */
export function climatePlace(
  bbox: readonly [number, number, number, number] | null | undefined,
  place: readonly [number, number] | null,
): readonly [number, number] | null {
  if (!bbox) return place;
  const [w, s, e, n] = bbox;
  return [Math.round(((w + e) / 2) * 10) / 10, Math.round(((s + n) / 2) * 10) / 10];
}

/**
 * Purpose: whether the project's climate should be fetched for it: it has none yet, or the one it has was
 * fetched outside the project area (the area moved). The planner's own values are kept either way.
 */
export function needsClimate(
  c: ProjectClimate,
  bbox: readonly [number, number, number, number] | null | undefined,
): boolean {
  if (!c.fetched) return true;
  if (!bbox) return false;
  const [w, s, e, n] = bbox;
  const { lat, lon } = c.fetched;
  // 0.05°: the climate's place is rounded to 0.1°.
  return lon < w - 0.05 || lon > e + 0.05 || lat < s - 0.05 || lat > n + 0.05;
}

/** The call the climate makes; tests pass their own. */
export type ClimateFetcher = (lat: number, lon: number) => Promise<FetchedClimate>;

/** Purpose: the climate at a place from the API (Open-Meteo, 1991–2020), asked once per place a session. */
export function climateFetcher(fetchImpl: typeof fetch = (...a) => fetch(...a)): ClimateFetcher {
  const cache = new Map<string, Promise<FetchedClimate>>();
  return (lat, lon) => {
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fetchImpl(
      withProjectFacts(`/api/calendar/climate?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`),
      {
        credentials: "same-origin",
      },
    ).then(async (res) => {
      if (!res.ok) {
        const j = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
        throw withApiMsg(new Error(j?.message ?? `Request failed (${res.status})`), j);
      }
      return (await res.json()) as FetchedClimate;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    return p;
  };
}

/** Purpose: the climate at a place, fetched once per session. */
export const fetchClimate: ClimateFetcher = climateFetcher();

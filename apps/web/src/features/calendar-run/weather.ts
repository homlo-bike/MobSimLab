/**
 * Weather day types of calendar runs (ADR-0020): from the project's monthly climate (workspace/climate.ts), each
 * day type is split into ordinary days and expected hot, very hot and cold days, and the weather's effects on
 * the railway and on energy are worked out. Every limit is an assumption library value the project can change
 * (Project preferences → All parameters, group "Energy and climate").
 *
 * - Hot day: the daily maximum reaches the first heat limit. Two limits, the lower one first:
 *   - heat speed restriction on welded track: rail temperature (air + `climate.rail_temp_above_air_c`) reaches
 *     the design temperature `climate.rail_design_temp_c` plus `climate.heat_restriction_margin_c`; running
 *     sections are capped at `climate.heat_speed_kmh`;
 *   - overhead line sag: the air reaches `climate.ocl_sag_air_temp_c`; sections under overhead line are capped
 *     at `climate.ocl_sag_speed_kmh`.
 *   A very hot day reaches both. Restrictions apply from `climate.heat_from_h` to `climate.heat_to_h`.
 * - Cold day: the daily minimum is at or below `climate.frost_day_min_c`. With switch heating
 *   (`climate.switch_heating`) the switches are heated (`climate.switch_heating_kw` per switch for
 *   `climate.switch_heating_hours`); without it, frozen switches add delays to the stability test
 *   (`climate.frost_extra_delayed_share`, `climate.frost_delay_mean_s`).
 * - Heating and air conditioning on board: below `climate.comfort_low_c` or above `climate.comfort_high_c` (daily
 *   mean), growing to the full `energy.hvac_power_kw` per vehicle at `climate.hvac_full_delta_c` beyond.
 *
 * The share of hot and cold days in a month comes from the month's average daily maximum and minimum and their
 * spread, taken as normally distributed.
 */
import type { Estimate } from "../costs/model";
import type { MonthClimate } from "../../workspace/climate";
import {
  choiceValue,
  LIBRARY_PARAMS,
  type LibraryParam,
  paramLibrary,
  type PreferencesDoc,
} from "../../workspace/preferences";

export const VARIANTS = ["hot", "very_hot", "cold"] as const;
export type Variant = (typeof VARIANTS)[number];

const BY_ID = new Map<string, LibraryParam>(LIBRARY_PARAMS.map((p) => [p.id, p]));

/**
 * Purpose: the central value of a number parameter for a mode ("*": every mode), with the project's own value
 * for the mode, else for every mode, on top. Negative values are allowed (temperatures).
 */
export function libValue(key: string, mode: string, prefs: PreferencesDoc["values"] | undefined): number {
  const p = BY_ID.get(key);
  if (!p) throw new Error(`unknown parameter ${key}`);
  const own = (id: string) => {
    const v = prefs?.[id];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const v = (mode !== "*" ? own(`${key}.${mode}`) : undefined) ?? own(key);
  if (v !== undefined) return v;
  const lib = paramLibrary(p, mode);
  if (typeof lib === "string") throw new Error(`${key} is not a number`);
  return lib[1];
}

/** Purpose: the value of an enum parameter, the project's choice on top. */
export function libChoice(key: string, doc: PreferencesDoc | null | undefined): string {
  const p = BY_ID.get(key);
  if (!p) throw new Error(`unknown parameter ${key}`);
  const lib = paramLibrary(p, "*");
  return choiceValue(doc, key) ?? (typeof lib === "string" ? lib : String(lib[1]));
}

/** The weather limits and effects a run uses. */
export interface WeatherSettings {
  /** Air temperature (daily maximum) at which heat speed restrictions start, °C. */
  heatAirC: number;
  heatKmh: number;
  /** Air temperature at which the overhead line sags, °C. */
  sagAirC: number;
  sagKmh: number;
  /** Hours of heat restrictions, s after midnight. */
  heatFromS: number;
  heatToS: number;
  /** Daily minimum at or below which a day is a frost day, °C. */
  frostC: number;
  switchHeating: boolean;
  switchKw: number;
  switchHours: number;
  frostExtraDelayedShare: number;
  frostDelayMeanS: number;
  comfortLowC: number;
  comfortHighC: number;
  hvacFullDeltaC: number;
}

/** Purpose: the weather settings of a project. */
export function weatherSettings(doc: PreferencesDoc | null | undefined): WeatherSettings {
  const v = (k: string) => libValue(k, "*", doc?.values);
  return {
    heatAirC:
      v("climate.rail_design_temp_c") +
      v("climate.heat_restriction_margin_c") -
      v("climate.rail_temp_above_air_c"),
    heatKmh: v("climate.heat_speed_kmh"),
    sagAirC: v("climate.ocl_sag_air_temp_c"),
    sagKmh: v("climate.ocl_sag_speed_kmh"),
    heatFromS: v("climate.heat_from_h") * 3600,
    heatToS: v("climate.heat_to_h") * 3600,
    frostC: v("climate.frost_day_min_c"),
    switchHeating: libChoice("climate.switch_heating", doc) !== "none",
    switchKw: v("climate.switch_heating_kw"),
    switchHours: v("climate.switch_heating_hours"),
    frostExtraDelayedShare: v("climate.frost_extra_delayed_share"),
    frostDelayMeanS: v("climate.frost_delay_mean_s"),
    comfortLowC: v("climate.comfort_low_c"),
    comfortHighC: v("climate.comfort_high_c"),
    hvacFullDeltaC: v("climate.hvac_full_delta_c"),
  };
}

/** Standard normal cumulative distribution (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Purpose: the chance a normally distributed value is at or above a limit (a step when there is no spread). */
export function above(limit: number, mean: number, sd: number): number {
  if (!(sd > 0)) return mean >= limit ? 1 : 0;
  return 1 - phi((limit - mean) / sd);
}

/** Shares of a month's days: ordinary, hot, very hot and cold. They add up to 1. */
export type VariantShares = Record<"ordinary" | Variant, number>;

/** Purpose: the expected share of a month's days in each weather variant. */
export function variantShares(m: MonthClimate, w: WeatherSettings): VariantShares {
  const lo = Math.min(w.heatAirC, w.sagAirC);
  const hi = Math.max(w.heatAirC, w.sagAirC);
  const veryHot = above(hi, m.max_c, m.max_sd_c);
  let hot = Math.max(0, above(lo, m.max_c, m.max_sd_c) - veryHot);
  let vh = veryHot;
  let cold = 1 - above(w.frostC + 1e-9, m.min_c, m.min_sd_c);
  // A day is hot or cold, not both: scale down in the (rare) months where they would overlap.
  const sum = hot + vh + cold;
  if (sum > 1) {
    hot /= sum;
    vh /= sum;
    cold /= sum;
  }
  return { ordinary: Math.max(0, 1 - hot - vh - cold), hot, very_hot: vh, cold };
}

/** What a heat variant changes on the railway (apps/api/src/simulation/calendar.ts `heat`). */
export interface HeatPlan {
  from_s: number;
  to_s: number;
  speed_cap_kmh: number | null;
  overhead_cap_kmh: number | null;
}
/** Frozen switches without switch heating: the stability test's primary delays on a cold day. */
export interface FrostPlan {
  delayed_share: number;
  primary_delay_mean_s: number;
  primary_delay_max_s: number;
}
export interface WeatherPlan {
  hot?: HeatPlan;
  very_hot?: HeatPlan;
  /** Null: switch heating, the rail service runs as on an ordinary day. */
  cold?: FrostPlan | null;
}

/**
 * Purpose: the weather's effects on the rail runs. A hot day has the effect with the lower limit (both when
 * the limits are the same), a very hot day both. Without switch heating, a cold day adds frozen switches'
 * delays to the stability test's: `base` is the run's own delayed share and delays.
 */
export function weatherPlan(
  w: WeatherSettings,
  base: { delayed_share: number; primary_delay_mean_s: number; primary_delay_max_s: number },
): WeatherPlan {
  const heatFirst = w.heatAirC <= w.sagAirC;
  const sagFirst = w.sagAirC <= w.heatAirC;
  const hours = { from_s: w.heatFromS, to_s: w.heatToS };
  return {
    hot: {
      ...hours,
      speed_cap_kmh: heatFirst ? w.heatKmh : null,
      overhead_cap_kmh: sagFirst ? w.sagKmh : null,
    },
    very_hot: { ...hours, speed_cap_kmh: w.heatKmh, overhead_cap_kmh: w.sagKmh },
    cold: w.switchHeating
      ? null
      : {
          delayed_share: Math.min(1, base.delayed_share + w.frostExtraDelayedShare),
          primary_delay_mean_s: w.frostDelayMeanS,
          // The cap on a primary delay rises with the frozen switches' mean delay.
          primary_delay_max_s: Math.max(base.primary_delay_max_s, 3 * w.frostDelayMeanS),
        },
  };
}

/** Purpose: the share of the full heating or air-conditioning power a month's mean temperature needs. */
export function hvacLoad(meanC: number, w: WeatherSettings): number {
  const gap = Math.max(0, w.comfortLowC - meanC, meanC - w.comfortHighC);
  return w.hvacFullDeltaC > 0 ? Math.min(1, gap / w.hvacFullDeltaC) : gap > 0 ? 1 : 0;
}

/**
 * Purpose: heating and air-conditioning power at full load of the vehicles in service on a day, kW·h per day:
 * each line's vehicle-hours a day times its mode's `energy.hvac_power_kw`.
 */
export function hvacFullKwhPerDay(
  estimate: Estimate | null,
  prefs: PreferencesDoc["values"] | undefined,
): number | null {
  if (!estimate) return null;
  const days = libValue("cost.days_per_year", "*", prefs);
  if (!(days > 0)) return null;
  return estimate.lines.reduce(
    (s, l) => s + (l.hoursPerYear / days) * libValue("energy.hvac_power_kw", l.mode, prefs),
    0,
  );
}

/** Purpose: the energy switch heating needs on one frost day, kWh. */
export function switchKwhPerFrostDay(switches: number, w: WeatherSettings): number {
  return w.switchHeating ? switches * w.switchKw * w.switchHours : 0;
}

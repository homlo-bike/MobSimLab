import { z } from "zod";
import { SWEEP_PARAMS, signallingParams } from "./params";

/**
 * Calendar runs (ADR-0020): what the simulator panel sends to run many years, one date or a row of dates from
 * representative day types (worker/src/mobsim_worker/jobs/calendar.py). The panel works out the day counts from
 * the project calendar and each day type's day figures from the Tables tab's models.
 */

const DAY = 48 * 3600;
const DAY_TYPES = ["weekday", "saturday", "sunday", "holiday"] as const;
/** Most periods one run expands: years of a multi-year run, or dates of a multi-day run. */
export const MAX_PERIODS = 366;

const amount = z.number().finite().min(0).max(1e15).nullable();
const dayFigures = z.strictObject({
  vehicle_km: amount,
  vehicle_hours: amount,
  passengers: amount,
  energy_kwh: amount,
  operating_cost: amount,
});
const dayType = z
  .strictObject({
    /** The day type's service day, s after midnight: the rail run covers it. */
    from_s: z.number().finite().min(0).max(DAY),
    to_s: z.number().finite().min(0).max(DAY),
    per_day: dayFigures,
  })
  .refine((d) => d.to_s > d.from_s, "a service day must end after it starts");
/** Day count keys: a day type, or a day type in a weather variant (`weekday.hot`). */
const VARIANTS = ["hot", "very_hot", "cold"] as const;
const COUNT_KEY = new RegExp(`^(${DAY_TYPES.join("|")})(\\.(${VARIANTS.join("|")}))?$`);
/** Days per key; expected days of a weather variant may be fractional. */
const counts = z.record(z.string().regex(COUNT_KEY), z.number().finite().min(0).max(366));

const kmh = z.number().finite().positive().max(1000).nullable();
/** Heat speed restrictions: their hours (s after midnight) and the caps on running sections. */
const heat = z.strictObject({
  from_s: z.number().finite().min(0).max(DAY),
  to_s: z.number().finite().min(0).max(DAY),
  speed_cap_kmh: kmh,
  overhead_cap_kmh: kmh,
});
/** Frozen switches without switch heating: the stability test's primary delays on a cold day. */
const frost = z.strictObject({
  delayed_share: z.number().finite().min(0).max(1),
  primary_delay_mean_s: z.number().finite().min(0).max(DAY),
  primary_delay_max_s: z.number().finite().min(0).max(DAY),
});
const kwh = z.number().finite().min(0).max(1e15);

export const calendarPlan = z
  .strictObject({
    mode: z.enum(["years", "date", "days"]),
    day_types: z.strictObject(
      Object.fromEntries(DAY_TYPES.map((d) => [d, dayType])) as Record<
        (typeof DAY_TYPES)[number],
        typeof dayType
      >,
    ),
    periods: z
      .array(
        z.strictObject({
          /** A year ("2027") or a date ("2027-05-01"). */
          label: z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/),
          counts,
          /** Share of a year the period stands for, for the fixed operating cost (1 for a year). */
          share_of_year: z.number().finite().min(0).max(1),
          /** The weather's extra energy in the period, kWh: heating and cooling on board, switch heating. */
          extra: z.strictObject({ hvac_kwh: kwh, switch_heating_kwh: kwh }).optional(),
        }),
      )
      .min(1)
      .max(MAX_PERIODS),
    fixed_per_year: z.strictObject({ operating_cost: amount }),
    /** Weather variants of the day types (the project's climate); absent: every day is an ordinary day. */
    weather: z
      .strictObject({ hot: heat.optional(), very_hot: heat.optional(), cold: frost.nullable().optional() })
      .optional(),
    /** ISO 4217 code the money figures are in; null when the project shows each country's own. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  })
  .refine(
    (p) => p.periods.every((x) => Object.values(x.counts).some((n) => (n ?? 0) > 0)),
    "a period has no days",
  );
export type CalendarPlan = z.infer<typeof calendarPlan>;

/** Settings of the rail runs of a calendar run: any capacity setting but the period, which each day type sets. */
export const calendarParams = z.strictObject({
  ...Object.fromEntries(Object.entries(SWEEP_PARAMS).map(([k, v]) => [k, v.optional()])),
  signalling: signallingParams.optional(),
}) as z.ZodType<Partial<Record<keyof typeof SWEEP_PARAMS, number>> & { signalling?: Record<string, number> }>;
export type CalendarSettings = z.infer<typeof calendarParams>;

import { z } from "zod";
import { SWEEP_PARAMS } from "./params";

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
const counts = z.strictObject(
  Object.fromEntries(DAY_TYPES.map((d) => [d, z.number().int().min(0).max(366).optional()])) as Record<
    (typeof DAY_TYPES)[number],
    z.ZodOptional<z.ZodNumber>
  >,
);

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
        }),
      )
      .min(1)
      .max(MAX_PERIODS),
    fixed_per_year: z.strictObject({ operating_cost: amount }),
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
export const calendarParams = z.strictObject(
  Object.fromEntries(Object.entries(SWEEP_PARAMS).map(([k, v]) => [k, v.optional()])),
) as z.ZodType<Partial<Record<keyof typeof SWEEP_PARAMS, number>>>;
export type CalendarSettings = z.infer<typeof calendarParams>;

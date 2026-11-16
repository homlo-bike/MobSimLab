import { describe, expect, it } from "vitest";
import { calendarParams, calendarPlan, type CalendarPlan } from "../src/simulation/calendar";

const day = (from_s: number) => ({
  from_s,
  to_s: 88200,
  per_day: { vehicle_km: 1000, vehicle_hours: 50, passengers: 20000, energy_kwh: 3000, operating_cost: null },
});

function plan(over: Partial<CalendarPlan> = {}): CalendarPlan {
  return {
    mode: "years",
    day_types: { weekday: day(18000), saturday: day(18000), sunday: day(25200), holiday: day(25200) },
    periods: [
      { label: "2027", counts: { weekday: 258, saturday: 50, sunday: 51, holiday: 6 }, share_of_year: 1 },
    ],
    fixed_per_year: { operating_cost: 1e6 },
    currency: "EUR",
    ...over,
  };
}

describe("calendar run settings", () => {
  it("takes what the simulator panel builds for years, a date and a row of dates", () => {
    expect(calendarPlan.safeParse(plan()).success).toBe(true);
    expect(
      calendarPlan.safeParse(
        plan({
          mode: "date",
          periods: [{ label: "2027-05-01", counts: { saturday: 1 }, share_of_year: 1 / 365 }],
        }),
      ).success,
    ).toBe(true);
  });

  it("refuses periods without days, broken labels, unknown day types and backwards service days", () => {
    expect(
      calendarPlan.safeParse(plan({ periods: [{ label: "2027", counts: {}, share_of_year: 1 }] })).success,
    ).toBe(false);
    expect(
      calendarPlan.safeParse(plan({ periods: [{ label: "27", counts: { weekday: 1 }, share_of_year: 1 }] }))
        .success,
    ).toBe(false);
    const p = plan();
    expect(
      calendarPlan.safeParse({
        ...p,
        periods: [{ label: "2027", counts: { school_day: 3 }, share_of_year: 1 }],
      }).success,
    ).toBe(false);
    expect(
      calendarPlan.safeParse({ ...p, day_types: { ...p.day_types, sunday: { ...day(90000), to_s: 3600 } } })
        .success,
    ).toBe(false);
    expect(calendarPlan.safeParse(plan({ periods: Array(367).fill(p.periods[0]) })).success).toBe(false);
  });

  it("takes capacity settings but not the period, which each day type sets", () => {
    expect(calendarParams.safeParse({ stability_runs: 4, seed: 2 }).success).toBe(true);
    expect(calendarParams.safeParse({ from_s: 0 }).success).toBe(false);
  });
});

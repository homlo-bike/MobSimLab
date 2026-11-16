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
    // A day type whose lines run their own times brings its own service lines.
    const own = plan();
    own.day_types.sunday = { ...own.day_types.sunday, lines: '{"service_lines":[]}' };
    expect(calendarPlan.safeParse(own).success).toBe(true);
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

  it("takes weather variants with expected days, their rail effects and their energy", () => {
    const heat = { from_s: 43200, to_s: 72000, speed_cap_kmh: 60, overhead_cap_kmh: null };
    const weather = plan({
      periods: [
        {
          label: "2027",
          counts: { weekday: 240.5, "weekday.hot": 12.5, "weekday.cold": 5, saturday: 50 },
          share_of_year: 1,
          extra: { hvac_kwh: 12000, switch_heating_kwh: 900 },
        },
      ],
      weather: {
        hot: heat,
        very_hot: { ...heat, overhead_cap_kmh: 80 },
        cold: { delayed_share: 0.4, primary_delay_mean_s: 300, primary_delay_max_s: 1800 },
      },
    });
    expect(calendarPlan.safeParse(weather).success).toBe(true);
    expect(calendarPlan.safeParse({ ...weather, weather: { cold: null } }).success).toBe(true);
    const p = weather.periods[0]!;
    expect(
      calendarPlan.safeParse({ ...weather, periods: [{ ...p, counts: { "weekday.snowy": 3 } }] }).success,
    ).toBe(false);
    expect(
      calendarPlan.safeParse({ ...weather, weather: { hot: { ...heat, speed_cap_kmh: -5 } } }).success,
    ).toBe(false);
  });

  it("takes capacity settings but not the period, which each day type sets", () => {
    expect(calendarParams.safeParse({ stability_runs: 4, seed: 2 }).success).toBe(true);
    expect(calendarParams.safeParse({ from_s: 0 }).success).toBe(false);
  });
});

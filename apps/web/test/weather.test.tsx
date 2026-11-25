import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarRunDetail, CalendarRunsApi } from "../src/features/calendar-run/api";
import { CalendarRun } from "../src/features/calendar-run/CalendarRun";
import { type CalendarPlan, periodsFor, weatherPeriods } from "../src/features/calendar-run/model";
import {
  above,
  hvacFullKwhFromService,
  hvacFullKwhPerDay,
  hvacLoad,
  switchKwhPerFrostDay,
  variantShares,
  weatherPlan,
  weatherSettings,
} from "../src/features/calendar-run/weather";
import type { Estimate } from "../src/features/costs/model";
import type { EnergyEstimate } from "../src/features/energy/types";
import { withSimulationYears } from "../src/workspace/calendar";
import { ClimateSection } from "../src/workspace/ClimateSection";
import {
  climatePlace,
  type FetchedClimate,
  type MonthClimate,
  monthsOf,
  needsClimate,
  withClimate,
  withClimateValue,
  withFetchedClimate,
} from "../src/workspace/climate";
import { type PreferencesDoc, withChoice, withPref } from "../src/workspace/preferences";

/** A climate with a cold January and a hot July; the other months are mild. */
const mild: MonthClimate = { mean_c: 12, max_c: 17, min_c: 7, max_sd_c: 3, min_sd_c: 3 };
const MONTHS: MonthClimate[] = Array.from({ length: 12 }, (_, i) =>
  i === 0
    ? { mean_c: -1, max_c: 2, min_c: -4, max_sd_c: 3, min_sd_c: 3 }
    : i === 6
      ? { mean_c: 24, max_c: 30, min_c: 17, max_sd_c: 4, min_sd_c: 3 }
      : mild,
);
const FETCHED: FetchedClimate = { lat: 52.5, lon: 13.4, from_year: 1991, to_year: 2020, months: MONTHS };
const withMonths = (doc: PreferencesDoc | null = null) => withClimate(doc, withFetchedClimate({}, FETCHED));

describe("weather model", () => {
  it("takes the limits from the assumption library, with the project's values on top", () => {
    const w = weatherSettings(null);
    // Rail designed for 25 °C, restrictions 25 °C above it, rails 20 °C above the air: 30 °C air.
    expect(w.heatAirC).toBe(30);
    expect(w.sagAirC).toBe(38);
    expect(w.frostC).toBe(0);
    expect(w.switchHeating).toBe(true);
    const own = weatherSettings(
      withChoice(withPref(null, "climate.frost_day_min_c", -3), "climate.switch_heating", "none"),
    );
    expect(own.frostC).toBe(-3);
    expect(own.switchHeating).toBe(false);
  });

  it("expects hot, very hot and frost days from a month's averages and spreads", () => {
    expect(above(30, 30, 4)).toBeCloseTo(0.5, 6);
    expect(above(30, 25, 0)).toBe(0);
    const w = weatherSettings(null);
    const july = variantShares(MONTHS[6]!, w);
    expect(july.hot + july.very_hot).toBeCloseTo(0.5, 3);
    expect(july.very_hot).toBeCloseTo(above(38, 30, 4), 6);
    expect(july.cold).toBeCloseTo(0, 6);
    const jan = variantShares(MONTHS[0]!, w);
    // Lows average −4 °C: most January days are frost days.
    expect(jan.cold).toBeGreaterThan(0.85);
    expect(jan.ordinary + jan.hot + jan.very_hot + jan.cold).toBeCloseTo(1, 9);
  });

  it("splits each day type's days into weather variants and keeps the totals", () => {
    const cal = {};
    const span = { years: { first: 2027, last: 2027 } };
    const w = weatherSettings(null);
    const [plain] = periodsFor("years", cal, span);
    const [p] = weatherPeriods("years", cal, span, {
      months: MONTHS,
      settings: w,
      hvacFullKwhPerDay: 100,
      switchKwhPerFrostDay: switchKwhPerFrostDay(10, w),
    });
    const weekdays = Object.entries(p!.counts)
      .filter(([k]) => k === "weekday" || k.startsWith("weekday."))
      .reduce((s, [, n]) => s + n, 0);
    expect(weekdays).toBeCloseTo(plain!.counts.weekday!, 2);
    expect(p!.counts["weekday.hot"]).toBeGreaterThan(5);
    expect(p!.counts["weekday.cold"]).toBeGreaterThan(15);
    // 10 switches × 4 kW × 12 h on each frost day.
    expect(switchKwhPerFrostDay(10, w)).toBe(480);
    expect(p!.extra!.switch_heating_kwh).toBeGreaterThan(480 * 20);
    // Heating below 15 °C and cooling above 22 °C, full at 20 °C beyond.
    expect(hvacLoad(-5, w)).toBe(1);
    expect(hvacLoad(12, w)).toBeCloseTo(0.15);
    expect(hvacLoad(18, w)).toBe(0);
    expect(p!.extra!.hvac_kwh).toBe(
      Math.round(
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].reduce(
          (s, d, m) => s + d * 100 * hvacLoad(MONTHS[m]!.mean_c, w),
          0,
        ),
      ),
    );
    const [date] = weatherPeriods(
      "date",
      cal,
      { date: "2027-07-14" },
      {
        months: MONTHS,
        settings: w,
        hvacFullKwhPerDay: null,
        switchKwhPerFrostDay: 0,
      },
    );
    expect(Object.values(date!.counts).reduce((s, n) => s + n, 0)).toBeCloseTo(1, 2);
    expect(date!.counts["weekday.hot"]).toBeGreaterThan(0.3);
  });

  it("caps speeds on hot days and adds frozen switches only without switch heating", () => {
    const base = { delayed_share: 0.3, primary_delay_mean_s: 45, primary_delay_max_s: 180 };
    const heated = weatherPlan(weatherSettings(null), base);
    expect(heated.hot).toEqual({
      from_s: 12 * 3600,
      to_s: 20 * 3600,
      speed_cap_kmh: 60,
      overhead_cap_kmh: null,
    });
    expect(heated.very_hot).toMatchObject({ speed_cap_kmh: 60, overhead_cap_kmh: 80 });
    expect(heated.cold).toBeNull();
    const frozen = weatherPlan(weatherSettings(withChoice(null, "climate.switch_heating", "none")), base);
    expect(frozen.cold).toEqual({ delayed_share: 0.4, primary_delay_mean_s: 300, primary_delay_max_s: 900 });
  });

  it("works out heating and cooling power from each line's vehicle-hours and mode", () => {
    const est = {
      lines: [
        { id: "a", mode: "bus", hoursPerYear: 30000 },
        { id: "b", mode: "metro", hoursPerYear: 3000 },
      ],
    } as unknown as Estimate;
    // 300 days a year: 100 bus hours at 15 kW and 10 metro unit-hours at 80 kW.
    expect(hvacFullKwhPerDay(est, undefined)).toBeCloseTo(1500 + 800);
    expect(hvacFullKwhPerDay(null, undefined)).toBeNull();
  });

  it("works out heating and cooling power from the timetables when the Tables tab has not run", () => {
    // 50 tram train-hours at 40 kW and 100 bus hours at 15 kW a weekday.
    expect(
      hvacFullKwhFromService(
        [
          { mode: "tram", hours: 50 },
          { mode: "bus", hours: 100 },
        ],
        undefined,
      ),
    ).toBeCloseTo(2000 + 1500);
    expect(hvacFullKwhFromService([], undefined)).toBeNull();
  });
});

describe("climate in Project preferences", () => {
  afterEach(cleanup);

  it("fetches the climate for the project's location, keeps it and lets the planner change a month", async () => {
    const fetcher = vi.fn(async () => FETCHED);
    let prefs: PreferencesDoc | null = null;
    const { rerender } = render(
      <ClimateSection
        preferences={prefs}
        editable
        onPreferences={(d) => (prefs = d)}
        place={[13.41, 52.52]}
        fetcher={fetcher}
      />,
    );
    await waitFor(() => expect(prefs?.climate?.fetched?.months).toHaveLength(12));
    expect(fetcher).toHaveBeenCalledWith(52.52, 13.41);
    rerender(
      <ClimateSection
        preferences={prefs}
        editable
        onPreferences={(d) => (prefs = d)}
        place={[13.41, 52.52]}
        fetcher={fetcher}
      />,
    );
    expect(screen.getByText(/Weather data by Open-Meteo.com/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Jul · Average high (°C)"), { target: { value: "33" } });
    expect(monthsOf(prefs!.climate!)![6]!.max_c).toBe(33);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks for a location before fetching", () => {
    const fetcher = vi.fn(async () => FETCHED);
    render(
      <ClimateSection preferences={null} editable onPreferences={() => {}} place={null} fetcher={fetcher} />,
    );
    expect(screen.getByText(/Draw the railway or a street line first/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the planner's own values when a month is set back", () => {
    const c = withClimateValue(withFetchedClimate({}, FETCHED), 7, "max_c", 33);
    expect(monthsOf(c)![6]!.max_c).toBe(33);
    expect(monthsOf(withClimateValue(c, 7, "max_c", null))![6]!.max_c).toBe(30);
    expect(monthsOf({})).toBeNull();
  });

  it("asks for the climate at the area's centre, as the API kept it when the area was saved", () => {
    expect(climatePlace([13.08, 52.33, 13.76, 52.68], [13.0, 52.0])).toEqual([13.4, 52.5]);
    expect(climatePlace(null, [13.0, 52.0])).toEqual([13.0, 52.0]);
    expect(climatePlace(undefined, null)).toBeNull();
  });

  it("fetches the climate when the project has none, or has one from outside its area", () => {
    const berlin: [number, number, number, number] = [13.08, 52.33, 13.76, 52.68];
    expect(needsClimate({}, null)).toBe(true);
    expect(needsClimate(withFetchedClimate({}, FETCHED), berlin)).toBe(false);
    expect(needsClimate(withFetchedClimate({}, FETCHED), null)).toBe(false);
    // The area moved to Munich: the Berlin climate is fetched again.
    expect(needsClimate(withFetchedClimate({}, FETCHED), [11.36, 48.06, 11.72, 48.25])).toBe(true);
  });
});

describe("calendar run panel with the climate", () => {
  afterEach(cleanup);

  const ESTIMATE = {
    items: [],
    lines: [
      {
        id: "street:0",
        name: "1",
        mode: "bus",
        color: "#000",
        lengthKm: 10,
        inService: 5,
        fleet: 6,
        hoursPerYear: 15000,
        kmPerYear: 300000,
      },
    ],
    modes: ["bus"],
    notes: [],
  } as Estimate;
  const ENERGY = { total: { energy_kwh: 600000 } } as unknown as EnergyEstimate;

  it("sends the weather variants and their effects, and shows them in the results", async () => {
    const start = vi.fn(async (_network: unknown, plan: CalendarPlan): Promise<CalendarRunDetail> => ({
      id: "r1",
      kind: "calendar",
      status: "done",
      network: { kind: "none" },
      plan,
      verdict: null,
      error: null,
      cancelRequested: false,
      createdBy: null,
      createdAt: "2027-03-01T10:00:00Z",
      startedAt: null,
      finishedAt: null,
      progress: null,
      result: {
        mode: "years",
        notes: [],
        run: { verdict: null },
        day_types: {
          weekday: {
            ...plan.day_types.weekday,
            days: 261,
            weather: { hot: { days: 6.5 }, cold: { days: 20.25 } },
          },
        },
        periods: [
          {
            label: "2027",
            counts: { weekday: 261, saturday: 51, sunday: 52, holiday: 1 },
            weather: { hot: 9, very_hot: 1, cold: 30 },
            days: 365,
            vehicle_km: 365000,
            vehicle_hours: 18250,
            passengers: null,
            energy_kwh: 800000,
            operating_cost: null,
            extra: { hvac_kwh: 60000, switch_heating_kwh: 10000 },
          },
        ],
      },
    }));
    const api = {
      list: vi.fn(async () => []),
      get: vi.fn(),
      start,
      cancel: vi.fn(),
      rerun: vi.fn(),
      remove: vi.fn(),
    } as unknown as CalendarRunsApi;
    render(
      <CalendarRun
        api={api}
        canRun
        railway={null}
        preferences={withMonths(withSimulationYears(null, { first: 2027, last: 2027 }))}
        tables={{ estimate: ESTIMATE, riders: null, energy: ENERGY }}
        currency={null}
        today={new Date("2027-03-01T12:00:00Z")}
      />,
    );
    expect(screen.getByText(/Expected weather:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run on the server and save" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const [, plan, params] = start.mock.calls[0]! as unknown as [
      unknown,
      CalendarPlan,
      Record<string, number>,
    ];
    expect(plan.weather?.hot?.speed_cap_kmh).toBe(60);
    expect(plan.weather?.cold).toBeNull();
    expect(Object.keys(plan.periods[0]!.counts)).toContain("weekday.hot");
    expect(plan.periods[0]!.extra!.hvac_kwh).toBeGreaterThan(0);
    // No railway, so no switches to heat.
    expect(plan.periods[0]!.extra!.switch_heating_kwh).toBe(0);
    expect(params.delayed_share).toBeCloseTo(0.3);
    expect(await screen.findByText("Hot and very hot days")).toBeTruthy();
    expect(screen.getAllByText("Hot days").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/60 MWh for heating and air conditioning on board and 10 MWh for switch heating/),
    ).toBeTruthy();
  });

  it("runs every day as an ordinary day without a climate", () => {
    render(
      <CalendarRun
        api={null}
        canRun
        railway={null}
        preferences={null}
        tables={{ estimate: null, riders: null, energy: null }}
        currency={null}
        today={new Date("2027-03-01T12:00:00Z")}
      />,
    );
    expect(screen.getByText(/No climate yet/)).toBeTruthy();
  });
});

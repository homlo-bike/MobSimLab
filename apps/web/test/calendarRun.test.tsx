import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarRunDetail, CalendarRunsApi } from "../src/features/calendar-run/api";
import { CalendarRun } from "../src/features/calendar-run/CalendarRun";
import {
  buildPlan,
  type CalendarPlan,
  dayFigures,
  operatingSplit,
  periodsFor,
  riderShare,
} from "../src/features/calendar-run/model";
import type { CostItem, Estimate } from "../src/features/costs/model";
import type { EnergyEstimate } from "../src/features/energy/types";
import { withFetched, withSimulationYears } from "../src/workspace/calendar";
import type { PreferencesDoc } from "../src/workspace/preferences";

const item = (category: CostItem["category"], mode: string, amount: number): CostItem => ({
  category,
  mode,
  line: null,
  label: category,
  quantity: 1,
  unit: "",
  rate: [amount, amount, amount],
  amount: [amount * 0.8, amount, amount * 1.2],
  param: null,
});

/** A year at 300 weekday equivalents (cost.days_per_year): 300 000 vehicle-km, 3 million service cost. */
const ESTIMATE: Estimate = {
  items: [
    item("vehicles", "bus", 9e6),
    item("service", "bus", 3e6),
    item("maintenance", "bus", 1e6),
    item("overheads", "bus", 0.4e6),
  ],
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
};
const ENERGY = { total: { energy_kwh: 600000 } } as unknown as EnergyEstimate;
const RIDERS: Record<string, [number, number, number]> = { "street:0": [8000, 10000, 12000] };

describe("calendar run model", () => {
  it("splits the operating cost into a cost per day of service and a fixed cost a year", () => {
    const s = operatingSplit(ESTIMATE, undefined);
    // Overheads 0.4 M split 3:1 between service and upkeep.
    expect(s.perDay).toBeCloseTo(3.3e6 / 300);
    expect(s.fixedPerYear).toBeCloseTo(1.1e6);
  });

  it("gives each day type its day figures, with fewer riders at weekends", () => {
    const f = dayFigures({ estimate: ESTIMATE, riders: RIDERS, energy: ENERGY }, undefined);
    expect(f.days.weekday).toMatchObject({
      vehicle_km: 1000,
      vehicle_hours: 50,
      passengers: 10000,
      energy_kwh: 2000,
    });
    expect(f.days.saturday.vehicle_km).toBe(1000);
    expect(f.days.saturday.passengers).toBeCloseTo(6000);
    expect(f.days.holiday.passengers).toBeCloseTo(4500);
    expect(riderShare("sunday", { "benefit.ridership.sunday_share": 0.3 })).toBe(0.3);
    const none = dayFigures({ estimate: null, riders: null, energy: null }, undefined);
    expect(none.days.weekday).toEqual({
      vehicle_km: null,
      vehicle_hours: null,
      passengers: null,
      energy_kwh: null,
      operating_cost: null,
    });
    expect(none.fixedPerYear).toBeNull();
  });

  it("makes the periods of years, one date and a row of dates from the calendar", () => {
    const cal = withFetched({}, 2027, [{ date: "2027-05-01", name: "Labour Day" }]);
    const years = periodsFor("years", cal, { years: { first: 2027, last: 2028 } });
    expect(years.map((p) => p.label)).toEqual(["2027", "2028"]);
    expect(years[0]!.counts).toEqual({ weekday: 261, saturday: 51, sunday: 52, holiday: 1 });
    expect(periodsFor("date", cal, { date: "2027-05-01" })).toEqual([
      { label: "2027-05-01", counts: { holiday: 1 }, share_of_year: 1 / 365 },
    ]);
    const days = periodsFor("days", cal, { from: "2027-04-29", to: "2027-05-03" });
    expect(days.map((p) => Object.keys(p.counts)[0])).toEqual([
      "weekday",
      "weekday",
      "holiday",
      "sunday",
      "weekday",
    ]);
    expect(periodsFor("days", cal, { from: "2027-01-01", to: "2028-12-31" }).length).toBe(367);
    const plan = buildPlan(
      "years",
      cal,
      years,
      dayFigures({ estimate: ESTIMATE, riders: null, energy: null }, undefined),
      "EUR",
    );
    expect(plan.day_types.sunday).toMatchObject({ from_s: 5 * 3600, to_s: 24.5 * 3600 });
    expect(plan.fixed_per_year.operating_cost).toBeCloseTo(1.1e6);
  });
});

describe("calendar run panel", () => {
  afterEach(cleanup);

  function fakeApi() {
    const runs: CalendarRunDetail[] = [];
    const api: CalendarRunsApi = {
      list: vi.fn(async () => runs),
      get: vi.fn(async (id: string) => runs.find((r) => r.id === id)!),
      start: vi.fn(async (network: Parameters<CalendarRunsApi["start"]>[0], plan: CalendarPlan) => {
        const r: CalendarRunDetail = {
          id: "r1",
          kind: "calendar",
          status: "done",
          network: network ? { kind: "files", topologyName: "t", linesName: "l" } : { kind: "none" },
          plan,
          verdict: null,
          error: null,
          cancelRequested: false,
          createdBy: { id: "u", displayName: "Alice" },
          createdAt: "2027-03-01T10:00:00Z",
          startedAt: null,
          finishedAt: null,
          progress: null,
          result: {
            mode: plan.mode,
            notes: [],
            run: { verdict: null },
            day_types: { weekday: { ...plan.day_types.weekday, days: 517 } },
            periods: plan.periods.map((p) => ({
              label: p.label,
              counts: { weekday: p.counts.weekday ?? 0, saturday: 0, sunday: 0, holiday: 0 },
              days: 365,
              vehicle_km: 365000,
              vehicle_hours: 18250,
              passengers: null,
              energy_kwh: 730000,
              operating_cost: 5e6,
            })),
          },
        };
        runs.unshift(r);
        return r;
      }),
      cancel: vi.fn(),
      rerun: vi.fn(),
      remove: vi.fn(async () => {}),
    };
    return api;
  }

  it("runs the simulation years without rail and shows each year's figures", async () => {
    const api = fakeApi();
    let prefs: PreferencesDoc = withSimulationYears(null, { first: 2027, last: 2028 });
    render(
      <CalendarRun
        api={api}
        canRun
        railway={null}
        preferences={prefs}
        onPreferences={(d) => {
          prefs = d;
        }}
        tables={{ estimate: ESTIMATE, riders: null, energy: ENERGY }}
        currency="EUR"
        today={new Date("2027-03-01T12:00:00Z")}
      />,
    );
    expect(screen.getByText("Simulation years 2027 to 2028.")).toBeTruthy();
    expect(screen.getByText(/Not known yet: Passengers/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Saturday"), { target: { value: "70" } });
    expect(prefs.values["benefit.ridership.saturday_share"]).toBe(0.7);
    fireEvent.click(screen.getByRole("button", { name: "Run on the server and save" }));
    await waitFor(() => expect(api.start).toHaveBeenCalled());
    const [network, plan] = vi.mocked(api.start).mock.calls[0]!;
    expect(network).toBeNull();
    expect(plan.periods.map((p) => p.label)).toEqual(["2027", "2028"]);
    expect(plan.day_types.weekday.per_day.vehicle_km).toBe(1000);
    expect(await screen.findByText("Each year")).toBeTruthy();
    // Two years of 730 MWh, and 730 days in all; the total row adds up the energy.
    expect(screen.getAllByText("730")).toHaveLength(3);
    expect(screen.getByText("1,460")).toBeTruthy();
  });

  it("runs one date as its day type", async () => {
    const api = fakeApi();
    render(
      <CalendarRun
        api={api}
        canRun
        railway={null}
        preferences={null}
        tables={{ estimate: ESTIMATE, riders: RIDERS, energy: ENERGY }}
        currency={null}
        today={new Date("2027-03-01T12:00:00Z")}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "One date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-03-06" } });
    expect(screen.getByText("Saturday: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run on the server and save" }));
    await waitFor(() => expect(api.start).toHaveBeenCalled());
    expect(vi.mocked(api.start).mock.calls[0]![1].periods).toEqual([
      { label: "2027-03-06", counts: { saturday: 1 }, share_of_year: 1 / 365 },
    ]);
  });
});

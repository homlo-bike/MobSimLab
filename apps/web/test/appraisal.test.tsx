import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Estimate as BenefitEstimate } from "../src/features/benefits/model";
import type { Triple } from "../src/features/benefits/params";
import type { Estimate as CostEstimate } from "../src/features/costs/model";
import type { DemandRidership } from "../src/features/demand/ridership";
import { AppraisalSection } from "../src/features/appraisal/AppraisalSection";
import { appraisalLines } from "../src/features/appraisal/inputs";
import {
  type AppraisalInput,
  type AppraisalLine,
  appraise,
  cashFlow,
  central,
  irr,
  libraryValue,
  mca,
  npv,
  paramValue,
  present,
  socialRateKey,
} from "../src/features/appraisal/model";

afterEach(cleanup);

const Z: Triple = [0, 0, 0];
const flat = (v: number): Triple => [v, v, v];

/** A line with no uncertainty, so the medium case is exact. */
function line(over: Partial<AppraisalLine> = {}): AppraisalLine {
  return {
    id: "rail:a",
    name: "Line A",
    mode: "tram",
    color: "#c00",
    shown: true,
    spending: { civil: flat(800), systems: flat(200), vehicles: flat(0), operating: flat(10) },
    annual: flat(1_000_000),
    gdp: flat(0),
    userDay: 300,
    carKmDay: 0,
    days: 300,
    growth: 0,
    ...over,
  };
}

/** Settings that make the arithmetic easy: 1 year of works, 10 of operation, 10 % / 5 %, no growth. */
const PREFS: Record<string, number> = {
  "appraisal.build_years": 1,
  "appraisal.period_years": 10,
  "appraisal.discount.social_cohesion": 0.1,
  "appraisal.discount.social_other": 0.1,
  "appraisal.discount.financial": 0.05,
  "appraisal.conversion_factor": 1,
  "appraisal.life.civil": 1000,
  "appraisal.life.systems": 1000,
  "appraisal.life.vehicles": 1000,
  "appraisal.vot_growth": 0,
};

const input = (lines: AppraisalLine[], prefs = PREFS): AppraisalInput => ({
  lines,
  fares: null,
  prefs,
  perIntl: 1,
  country: "POL",
});

describe("discounting", () => {
  it("discounts from the first year and finds the rate of return", () => {
    expect(npv([-100, 110], 0.1)).toBeCloseTo(0, 9);
    expect(npv([-100, 50, 50], 0)).toBe(0);
    expect(irr([-100, 110])).toBeCloseTo(0.1, 5);
    expect(irr([-100, 60, 60])).toBeCloseTo(0.1307, 3);
    // No sign change: no rate of return.
    expect(irr([100, 10])).toBeNull();
    expect(irr([-100, -10])).toBeNull();
  });

  it("uses 3 % in EU countries outside the Cohesion Fund and 5 % elsewhere", () => {
    expect(socialRateKey("DEU")).toBe("appraisal.discount.social_other");
    expect(socialRateKey("pol")).toBe("appraisal.discount.social_cohesion");
    expect(socialRateKey("USA")).toBe("appraisal.discount.social_cohesion");
    expect(socialRateKey(null)).toBe("appraisal.discount.social_cohesion");
    expect(libraryValue("appraisal.discount.social_other")[1]).toBe(0.03);
    expect(libraryValue("appraisal.discount.social_cohesion")[1]).toBe(0.05);
    expect(libraryValue("appraisal.discount.financial")[1]).toBe(0.04);
  });

  it("takes the project's value as the medium and moves low and high with it", () => {
    expect(paramValue("appraisal.period_years", "tram", undefined)).toEqual([25, 30, 40]);
    expect(paramValue("appraisal.period_years", "bus", undefined)).toEqual([15, 20, 25]);
    expect(paramValue("appraisal.period_years", "bus", { "appraisal.period_years.bus": 40 })).toEqual([
      30, 40, 50,
    ]);
    // A value for every mode applies where the mode has none of its own.
    expect(paramValue("appraisal.life.vehicles", "bus", { "appraisal.life.vehicles": 24 })[1]).toBe(24);
  });
});

describe("cash flow", () => {
  it("spreads construction over the works, then counts benefits and costs each year", () => {
    const inp = input([line()], { ...PREFS, "appraisal.build_years": 2 });
    const ys = cashFlow(inp, inp.lines, central, null, { build: 2, period: 10 });
    expect(ys).toHaveLength(12);
    expect(ys[0]!.construction).toBe(500);
    expect(ys[1]!.construction).toBe(500);
    expect(ys[1]!.op).toBe(0);
    expect(ys[2]!.op).toBe(1);
    expect(ys[2]!.operating).toBe(10);
    expect(ys[2]!.user).toBe(300 * 300);
    expect(ys[0]!.user).toBe(0);
  });

  it("buys assets again at the end of their life and returns the value left", () => {
    const l = line({ spending: { civil: Z, systems: Z, vehicles: flat(120), operating: Z } });
    const inp = input([l], { ...PREFS, "appraisal.life.vehicles": 4 });
    const ys = cashFlow(inp, [l], central, null, { build: 1, period: 10 });
    // Bought at opening (year 1 of operation), again in years 5 and 9; the last has 4 − 2 = 2 years left.
    expect(ys.filter((y) => y.renewals > 0).map((y) => y.op)).toEqual([5, 9]);
    expect(ys[ys.length - 1]!.residual).toBeCloseTo(60, 9);
    // Without renewals the value left is the share of the life not used.
    const long = input([l], { ...PREFS, "appraisal.life.vehicles": 40 });
    const ys2 = cashFlow(long, [l], central, null, { build: 1, period: 10 });
    expect(ys2[ys2.length - 1]!.residual).toBeCloseTo(120 * (30 / 40), 9);
  });

  it("grows ridership and the value of time, and prices the car-km saved", () => {
    const l = line({ growth: 0.1, userDay: 1, carKmDay: 10, days: 1 });
    const prefs = {
      ...PREFS,
      "appraisal.vot_growth": 0.5,
      "appraisal.external.climate": 1,
      "appraisal.external.air_pollution": 0,
      "appraisal.external.noise": 0,
      "appraisal.external.accidents": 0,
      "appraisal.external.congestion": 0,
    };
    const inp = { ...input([l], prefs), perIntl: 2 };
    const ys = cashFlow(inp, [l], central, null, { build: 1, period: 3 });
    expect(ys[2]!.user).toBeCloseTo(1.1 * 1.5, 9);
    expect(ys[3]!.user).toBeCloseTo(1.1 ** 2 * 1.5 ** 2, 9);
    // 10 car-km × 1 int. $ × 2 units per int. $.
    expect(ys[1]!.external).toBeCloseTo(20, 9);
    expect(ys[2]!.external).toBeCloseTo(22, 9);
  });

  it("adds the economic and financial values up", () => {
    const l = line({ userDay: 3 });
    const inp = input([l]);
    const ys = cashFlow(inp, [l], central, { "rail:a": Array(10).fill(50) }, { build: 1, period: 10 });
    const p = present(ys, central, inp, [l]);
    const annuity = (r: number) =>
      Array.from({ length: 10 }, (_, k) => 1 / (1 + r) ** (k + 1)).reduce((a, b) => a + b);
    expect(p.user).toBeCloseTo(900 * annuity(0.1), 6);
    expect(p.fares).toBeCloseTo(50 * annuity(0.1), 6);
    // Civil and systems live long: most of their value comes back at the end.
    const residual = 1000 * (990 / 1000);
    expect(p.capital).toBeCloseTo(1000 - residual / 1.1 ** 10, 6);
    expect(p.enpv).toBeCloseTo(p.benefits - p.costs, 9);
    expect(p.bcr).toBeCloseTo(p.benefits / p.costs, 9);
    // The operator only sees fares against its costs, at the financial rate.
    const fin = ys.map((y) => y.fares - (y.construction + y.renewals - y.residual + y.operating));
    expect(p.fnpv).toBeCloseTo(npv(fin, 0.05), 6);
    expect(p.err).not.toBeNull();
    expect(
      npv(
        ys.map((y) => y.user + y.fares - (y.construction - y.residual + y.operating)),
        p.err!,
      ),
    ).toBeCloseTo(0, 3);
  });

  it("applies the conversion factor to economic costs only", () => {
    const l = line();
    const ys = cashFlow(input([l]), [l], central, null, { build: 1, period: 10 });
    const a = present(ys, central, input([l]), [l]);
    const b = present(ys, central, input([l], { ...PREFS, "appraisal.conversion_factor": 0.5 }), [l]);
    expect(b.costs).toBeCloseTo(a.costs / 2, 9);
    expect(b.benefits).toBeCloseTo(a.benefits, 9);
    expect(b.fnpv).toBeCloseTo(a.fnpv, 9);
  });
});

describe("appraisal", () => {
  const lines = [
    line({
      spending: { civil: [600, 800, 1200], systems: [150, 200, 300], vehicles: Z, operating: [8, 10, 14] },
    }),
    line({
      id: "street:0",
      name: "Bus 1",
      mode: "bus",
      color: "#00c",
      spending: { civil: flat(20), systems: Z, vehicles: flat(30), operating: flat(5) },
      annual: [400_000, 500_000, 700_000],
      userDay: 50,
    }),
    line({
      id: ":tram",
      name: "Shared tram items",
      shown: false,
      spending: { civil: flat(100), systems: Z, vehicles: Z, operating: Z },
      userDay: 0,
    }),
  ];
  const prefs = { ...PREFS };
  delete prefs["appraisal.build_years"];
  delete prefs["appraisal.period_years"];
  const a = appraise(input(lines, prefs), 60);

  it("gives a row per shown line, per mode and in total, on the longest timeline of their modes", () => {
    expect(a.rows.map((r) => r.id)).toEqual(["rail:a", "street:0", "mode:tram", "total"]);
    const by = Object.fromEntries(a.rows.map((r) => [r.id, r]));
    expect(by["rail:a"]!.timeline).toEqual({ build: 4, period: 30 });
    expect(by["street:0"]!.timeline).toEqual({ build: 2, period: 20 });
    expect(by["total"]!.timeline).toEqual({ build: 4, period: 30 });
    // The mode counts the items no line runs on yet.
    expect(by["mode:tram"]!.central.capital).toBeGreaterThan(by["rail:a"]!.central.capital);
    for (const r of a.rows) {
      expect(r.enpv[0]).toBeLessThanOrEqual(r.enpv[1]);
      expect(r.enpv[1]).toBeLessThanOrEqual(r.enpv[2]);
    }
    expect(a.years).toHaveLength(34);
  });

  it("finds switching values that bring the ENPV to 0", () => {
    const base = a.tests[0]!.result;
    const capex = a.switching.find((s) => s.id === "capex")!;
    expect(capex.change).toBeCloseTo(base.enpv / base.capital, 9);
    const shifted = appraise(
      input(
        lines.map((l) => ({ ...l })),
        prefs,
      ),
      20,
    ).tests[0]!.result;
    expect(shifted.enpv).toBeCloseTo(base.enpv, 6);
    const demand = a.switching.find((s) => s.id === "demand")!;
    // Scaling ridership by 1 + change leaves nothing.
    const k = 1 + demand.change!;
    expect(base.user * k + base.fares * k + base.external * k + base.gdp - base.costs).toBeCloseTo(0, 6);
  });

  it("runs the standard tests", () => {
    const by = Object.fromEntries(a.tests.map((t) => [t.id, t.result]));
    expect(by["capex20"]!.enpv).toBeLessThan(by["base"]!.enpv);
    expect(by["capex40"]!.enpv).toBeLessThan(by["capex20"]!.enpv);
    expect(by["demand-20"]!.user).toBeCloseTo(by["base"]!.user * 0.8, 6);
    expect(by["delay2"]!.user).toBeLessThan(by["base"]!.user);
    expect(by["opex10"]!.operating).toBeCloseTo(by["base"]!.operating * 1.1, 6);
  });

  it("ranks the values by how far they move the ENPV", () => {
    expect(a.tornado.length).toBeGreaterThan(3);
    const swing = a.tornado.map((b) => Math.abs(b.high - b.low));
    expect(swing).toEqual([...swing].sort((x, y) => y - x));
    const capex = a.tornado.find((b) => b.name === "input.capex")!;
    expect(capex.low).toBeGreaterThan(capex.high);
    // Only the social rate of the project's country is varied.
    expect(a.tornado.some((b) => b.name === "appraisal.discount.social_other")).toBe(false);
  });

  it("says when the demand run's benefits are missing", () => {
    const none = appraise(input([line({ userDay: null, carKmDay: null })]), 20);
    expect(none.notes.join(" ")).toMatch(/No demand run/);
    expect(none.switching.some((s) => s.id === "user")).toBe(false);
    expect(none.rows[0]!.central.user).toBe(0);
  });

  it("gives the same numbers again", () => {
    const b = appraise(input(lines, prefs), 60);
    expect(b.rows.map((r) => r.enpv)).toEqual(a.rows.map((r) => r.enpv));
  });
});

describe("multi-criteria analysis", () => {
  const lines = [
    {
      id: "a",
      name: "A",
      color: "#c00",
      values: { enpv: 100, ridership: 10, jobs: 5, education: 1, healthcare: 0, construction_cost: 50 },
    },
    {
      id: "b",
      name: "B",
      color: "#00c",
      values: { enpv: 0, ridership: 20, jobs: 5, education: null, healthcare: 0, construction_cost: 100 },
    },
  ];

  it("scores each criterion 0–100 between the lines and weighs them", () => {
    const r = mca(lines, null, undefined);
    expect(r.criteria.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 9);
    const a = r.lines.find((l) => l.id === "a")!;
    const b = r.lines.find((l) => l.id === "b")!;
    expect(a.scores.enpv).toBe(100);
    expect(b.scores.enpv).toBe(0);
    // Lower cost is better.
    expect(a.scores.construction_cost).toBe(100);
    // Equal values score 100 for both; a missing value scores nothing.
    expect(a.scores.jobs).toBe(100);
    expect(b.scores.education).toBeNull();
    expect(a.total).toBeCloseTo((100 + 0 + 100 + 100 + 100 + 100) / 6, 9);
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
  });

  it("takes the project's weights and its own criteria", () => {
    const r = mca(
      lines,
      { criteria: [{ id: "x", name: "Heritage", weight: 6, higher: false, scores: { a: 3, b: 1 } }] },
      {
        "appraisal.mca.weight.enpv": 0,
        "appraisal.mca.weight.jobs": 0,
        "appraisal.mca.weight.education": 0,
        "appraisal.mca.weight.healthcare": 0,
        "appraisal.mca.weight.construction_cost": 0,
      },
    );
    const own = r.criteria.find((c) => c.id === "own:x")!;
    expect(own.share).toBeCloseTo(6 / 7, 9);
    const b = r.lines.find((l) => l.id === "b")!;
    expect(b.scores["own:x"]).toBe(100);
    expect(b.rank).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The section

const COSTS: CostEstimate = {
  items: [
    {
      category: "tbm",
      mode: "metro",
      line: "rail:m1",
      label: "Tunnel",
      quantity: 5,
      unit: "km",
      rate: [100e6, 150e6, 250e6],
      amount: [500e6, 750e6, 1250e6],
      param: null,
    },
    {
      category: "service",
      mode: "metro",
      line: "rail:m1",
      label: "Service",
      quantity: 1,
      unit: "year",
      rate: [10e6, 12e6, 15e6],
      amount: [10e6, 12e6, 15e6],
      param: null,
    },
  ],
  lines: [
    {
      id: "rail:m1",
      name: "M1",
      mode: "metro",
      color: "#e00",
      lengthKm: 5,
      inService: 8,
      fleet: 9,
      hoursPerYear: 1e4,
      kmPerYear: 1e6,
    },
  ],
  modes: ["metro"],
  notes: [],
};

const BENEFITS = {
  rows: [
    {
      id: "rail:m1",
      scope: "line",
      name: "M1",
      mode: "metro",
      color: "#e00",
      values: { ridership_annual: [8e6, 10e6, 12e6], gdp: [1e6, 2e6, 3e6] },
      access: {
        pop: 1000,
        jobsNear: 100,
        before: { jobs: 10, school: 1, university: 0, hospital: 0, clinic: 1 },
        after: { jobs: 50, school: 2, university: 1, hospital: 1, clinic: 1 },
        gaining: { jobs: 0, school: 0, university: 0, hospital: 0, clinic: 0 },
      },
    },
  ],
  stations: {},
  notes: [],
  draws: 200,
} as unknown as BenefitEstimate;

const DEMAND: DemandRidership = {
  runId: "r1",
  finishedAt: null,
  uncalibrated: true,
  lines: { "rail:m1": 30_000 },
  stations: {},
  stops: {},
  appraisal: {
    method: "logsum",
    currency: "EUR",
    user_benefit: 120_000,
    user_benefit_by_purpose: { hbw: 60_000, hbe: 20_000, hbo: 30_000, nhb: 10_000 },
    generalised_hours: 9000,
    no_alternative_trips: 0,
    car_trips_saved: 5000,
    car_vehicle_km_saved: 30_000,
  },
};

describe("appraisal inputs", () => {
  it("gives each line its costs, ridership, GDP growth and its share of the demand run's benefits", () => {
    const ls = appraisalLines(COSTS, BENEFITS, DEMAND, undefined, undefined);
    expect(ls).toHaveLength(1);
    const l = ls[0]!;
    expect(l.spending.civil).toEqual([500e6, 750e6, 1250e6]);
    expect(l.spending.operating).toEqual([10e6, 12e6, 15e6]);
    expect(l.gdp).toEqual([1e6, 2e6, 3e6]);
    expect(l.userDay).toBe(120_000);
    expect(l.carKmDay).toBe(30_000);
    expect(l.days).toBeGreaterThan(250);
    // Without a demand run there is nothing to share.
    const no = appraisalLines(COSTS, BENEFITS, null, undefined, undefined)[0]!;
    expect(no.userDay).toBeNull();
  });
});

describe("appraisal section", () => {
  const costs = { estimate: COSTS, currency: "EUR", country: "DEU", perIntl: 0.8 };

  it("waits for the cost tables", () => {
    render(
      <AppraisalSection
        costs={null}
        benefits={null}
        fares={null}
        demand={null}
        preferences={null}
        doc={null}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/cost tables/);
  });

  it("shows the results, the sensitivity and the multi-criteria analysis, and saves values", () => {
    const onPreferences = vi.fn();
    const onDoc = vi.fn();
    render(
      <AppraisalSection
        costs={costs}
        benefits={BENEFITS}
        fares={null}
        demand={DEMAND}
        preferences={null}
        onPreferences={onPreferences}
        doc={null}
        onDoc={onDoc}
        draws={20}
      />,
    );
    expect(screen.getAllByText("Economic net present value").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Per line" })).toBeTruthy();
    expect(screen.getByLabelText("Tornado chart of the economic net present value")).toBeTruthy();
    expect(screen.getByText("Construction cost +40 %")).toBeTruthy();
    expect(
      screen.getByText("Fare revenue is not counted until the fare revenue table has priced the lines."),
    ).toBeTruthy();
    // Germany: the 3 % rate applies.
    const settings = screen.getByRole("region", { name: "Appraisal settings" });
    expect(
      within(settings)
        .getAllByText(/applies to this project's country/)[0]!
        .closest("tr")!.textContent,
    ).toMatch(/other EU countries/);
    const rate = within(settings).getByLabelText("Social discount rate (real), other EU countries");
    fireEvent.change(rate, { target: { value: "0.02" } });
    fireEvent.blur(rate);
    expect(onPreferences).toHaveBeenCalledWith({ values: { "appraisal.discount.social_other": 0.02 } });
    // External costs show in the project's currency and save in international dollars.
    const climate = within(settings).getByLabelText(
      "External cost of a car-km: climate change and well-to-tank emissions",
    );
    fireEvent.change(climate, { target: { value: "0.08" } });
    fireEvent.blur(climate);
    expect(onPreferences.mock.calls[1]![0].values["appraisal.external.climate"]).toBeCloseTo(0.1, 9);
    fireEvent.click(screen.getByRole("button", { name: "Add a criterion" }));
    expect(onDoc.mock.calls[0]![0].criteria[0]).toMatchObject({
      name: "Criterion 1",
      weight: 1,
      higher: true,
    });
  });
});

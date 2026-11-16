/**
 * The appraisal of a project (ADR-0045, 09-planning-models §3.2–3.4): construction and operating costs from the
 * cost tables, fare revenue from the fare revenue table, the users' benefit and the car-km saved from the demand
 * model, and GDP growth from the benefit tables, laid out year by year. From the cash flows: economic net present
 * value (ENPV), economic rate of return (ERR) and benefit-cost ratio (BCR), financial net present value (FNPV)
 * and financial rate of return (FIRR), per line, per mode and in total. Low, medium and high are the 10th, 50th
 * and 90th percentile of a seeded Monte Carlo run; a tornado chart, switching values and the standard tests
 * show how the result depends on each input; a weighted-sum multi-criteria analysis ranks the lines.
 * Every value comes from the assumption library (assumptions/parameters/appraisal.yaml) unless the project set
 * its own in Project preferences.
 */
import data from "./defaults.generated.json";
import { p10p50p90, seeded, triangular, type Triple } from "../benefits/params";
import type { Spending } from "../benefits/model";
import { drawNumbers, fareDraw, type FareInput, fareValue } from "../fares/model";

export interface AppraisalParam {
  label: string;
  unit: string;
  values: Record<string, Triple>;
}

export const PARAMS = (data as unknown as { params: Record<string, AppraisalParam> }).params;

/** Values the project decides: the Monte Carlo run keeps them at the project's value. */
export const POLICY = new Set([
  "appraisal.build_years",
  "appraisal.period_years",
  "appraisal.discount.financial",
  "appraisal.discount.social_cohesion",
  "appraisal.discount.social_other",
  "appraisal.conversion_factor",
]);

/** External costs of a car-km the project saves, in the order the tables show them. */
export const EXTERNAL = ["climate", "air_pollution", "noise", "accidents", "congestion"] as const;
export type External = (typeof EXTERNAL)[number];

/** EU members outside the Cohesion Fund 2021–2027 (ISO 3166 alpha-3): the 3 % social discount rate. */
export const EU_OTHER = new Set([
  "AUT",
  "BEL",
  "DNK",
  "FIN",
  "FRA",
  "DEU",
  "IRL",
  "ITA",
  "LUX",
  "NLD",
  "ESP",
  "SWE",
]);

/** Purpose: the library's low, central and high value of an appraisal parameter for a mode (else "*"). */
export function libraryValue(key: string, mode = "*"): Triple {
  const p = PARAMS[key];
  if (!p) throw new Error(`unknown appraisal parameter ${key}`);
  return (p.values[mode] ?? p.values["*"]) as Triple;
}

/** Purpose: the preference id of a project's own value for a mode, or for every mode ("*"). */
export function prefId(key: string, mode = "*"): string {
  return mode === "*" ? key : `${key}.${mode}`;
}

/**
 * Purpose: the values a project uses: its own value (for the mode, else for every mode) replaces the central
 * one and low and high move with it; with a library central of 0, the own value is all three.
 */
export function paramValue(key: string, mode: string, prefs: Record<string, number> | undefined): Triple {
  const lib = libraryValue(key, mode);
  const pick = (id: string) => {
    const v = prefs?.[id];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const own = pick(prefId(key, mode)) ?? pick(prefId(key, "*"));
  if (own === undefined) return lib;
  if (lib[1] === 0) return [own, own, own];
  const k = own / lib[1];
  const t: Triple = [lib[0] * k, own, lib[2] * k];
  return t[0] <= t[2] ? t : [t[2], own, t[0]];
}

/** Purpose: which social discount rate applies in a country (EU CBA Guide 2014: 3 % or 5 %). */
export function socialRateKey(iso3: string | null): string {
  return iso3 && EU_OTHER.has(iso3.toUpperCase())
    ? "appraisal.discount.social_other"
    : "appraisal.discount.social_cohesion";
}

/** A line (or a mode's items no line uses yet) as the appraisal sees it. Money in the project's currency. */
export interface AppraisalLine {
  id: string;
  name: string;
  mode: string;
  color: string;
  /** False for a mode's shared items that no line runs on yet: counted in the mode and total only. */
  shown: boolean;
  /** Construction by asset class and operating cost a year (cost tables). */
  spending: Spending;
  /** Boardings a year (benefit tables, from the demand run when one is picked). */
  annual: Triple;
  /** GDP growth a year from agglomeration (benefit tables). */
  gdp: Triple;
  /** The demand run's users' benefit on a weekday that falls to this line (null without a run). */
  userDay: number | null;
  /** Car vehicle-km a weekday the line saves (null without a run). */
  carKmDay: number | null;
  /** Weekday equivalents a year. */
  days: number;
  /** Yearly change in ridership (fare revenue table). */
  growth: number;
}

export interface AppraisalInput {
  lines: AppraisalLine[];
  /** The fare revenue table's input, for its draws (null: no fare revenue). */
  fares: FareInput | null;
  prefs: Record<string, number> | undefined;
  /** Units of the project's currency per 2023 international dollar (external cost values). */
  perIntl: number;
  /** ISO 3166 alpha-3 code of the project's country. */
  country: string | null;
}

/**
 * How a calculation picks each uncertain value from its low, central and high: `name` is a parameter key or
 * one of `input.capex`, `input.opex`, `ridership`, `input.gdp`.
 */
export type Pick = (name: string, t: Triple) => number;
export const central: Pick = (_n, t) => t[1];

/** Changes for the standard tests. */
export interface Shift {
  capex?: number;
  opex?: number;
  demand?: number;
  delay?: number;
}

/** Present values of one calculation (economic ones after the conversion factor). */
export interface Present {
  user: number;
  fares: number;
  external: number;
  gdp: number;
  /** Construction, renewals less residual value. */
  capital: number;
  operating: number;
  benefits: number;
  costs: number;
  enpv: number;
  bcr: number | null;
  err: number | null;
  fnpv: number;
  firr: number | null;
}

/** One year of the cash flow (economic money, before discounting; fares also in the financial flow). */
export interface CashYear {
  /** 1 at the start of works. */
  year: number;
  /** Year of operation, 0 while building. */
  op: number;
  construction: number;
  renewals: number;
  residual: number;
  operating: number;
  user: number;
  fares: number;
  external: number;
  gdp: number;
}

export interface Timeline {
  build: number;
  period: number;
}

/** Purpose: the timeline of a set of lines: the longest construction and appraisal period of their modes. */
export function timeline(lines: AppraisalLine[], pick: Pick, prefs: AppraisalInput["prefs"]): Timeline {
  const modes = [...new Set(lines.map((l) => l.mode))];
  const of = (key: string) =>
    Math.max(1, ...modes.map((m) => Math.round(pick(key, paramValue(key, m, prefs)))));
  return { build: of("appraisal.build_years"), period: of("appraisal.period_years") };
}

/** Purpose: the net present value of a cash flow at a rate (year 1 undiscounted). */
export function npv(flow: number[], r: number): number {
  let s = 0;
  for (let t = 0; t < flow.length; t++) s += flow[t]! / (1 + r) ** t;
  return s;
}

/**
 * Purpose: the rate of return of a cash flow: the rate at which its net present value is 0, by bisection
 * between −99 % and 1,000 %. Null when the value does not change sign there (no return, or no costs).
 */
export function irr(flow: number[]): number | null {
  let lo = -0.99;
  let hi = 10;
  let flo = npv(flow, lo);
  const fhi = npv(flow, hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo === 0 || Math.sign(flo) === Math.sign(fhi))
    return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(flow, mid);
    if (Math.abs(f) < 1e-9 || hi - lo < 1e-7) return mid;
    if (Math.sign(f) === Math.sign(flo)) {
      lo = mid;
      flo = f;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

const CLASSES = ["civil", "systems", "vehicles"] as const;

/**
 * Purpose: the cash flow of a set of lines, year by year, on one timeline. Construction is spread evenly over
 * the construction years; each asset class is bought again at the end of its life and its remaining value is
 * returned in the last year (straight line). Benefits and fares start in the first year of operation and grow
 * with ridership (and the users' benefit also with the value of time).
 * Inputs: the lines, how to pick each value, the fares of each line and year (null without fares), the
 * timeline and the standard test's changes. Output: the years. No side effects.
 */
export function cashFlow(
  input: AppraisalInput,
  lines: AppraisalLine[],
  pick: Pick,
  fares: Record<string, number[]> | null,
  tl: Timeline,
  shift: Shift = {},
): CashYear[] {
  const delay = Math.max(0, Math.round(shift.delay ?? 0));
  const build = tl.build + delay;
  const years: CashYear[] = [];
  for (let t = 0; t < build + tl.period; t++)
    years.push({
      year: t + 1,
      op: t < build ? 0 : t - build + 1,
      construction: 0,
      renewals: 0,
      residual: 0,
      operating: 0,
      user: 0,
      fares: 0,
      external: 0,
      gdp: 0,
    });
  const { prefs } = input;
  const capexK = shift.capex ?? 1;
  const opexK = shift.opex ?? 1;
  const demandK = shift.demand ?? 1;
  const vot = pick("appraisal.vot_growth", paramValue("appraisal.vot_growth", "*", prefs));
  const extPer = EXTERNAL.reduce((s, k) => {
    const key = `appraisal.external.${k}`;
    return s + pick(key, paramValue(key, "*", prefs));
  }, 0);
  for (const l of lines) {
    const life = (c: (typeof CLASSES)[number]) =>
      Math.max(1, pick(`appraisal.life.${c}`, paramValue(`appraisal.life.${c}`, l.mode, prefs)));
    for (const c of CLASSES) {
      const cost = pick("input.capex", l.spending[c]) * capexK;
      if (!(cost > 0)) continue;
      for (let t = 0; t < build; t++) years[t]!.construction += cost / build;
      const L = life(c);
      // Bought at the start of operation year 1, then again every L years.
      let bought = 1;
      for (let s = 1 + L; s <= tl.period; s += L) {
        const at = Math.floor(s);
        years[build + at - 1]!.renewals += cost;
        bought = at;
      }
      const left = L - (tl.period - bought + 1);
      if (left > 0) years[years.length - 1]!.residual += (cost * left) / L;
    }
    const opex = pick("input.opex", l.spending.operating) * opexK;
    const ridersK = l.annual[1] > 0 ? pick("ridership", l.annual) / l.annual[1] : 1;
    const gdp = pick("input.gdp", l.gdp);
    for (let k = 1; k <= tl.period; k++) {
      const y = years[build + k - 1]!;
      const grow = (1 + l.growth) ** (k - 1);
      y.operating += opex;
      y.gdp += gdp;
      if (l.userDay !== null) y.user += l.userDay * l.days * demandK * ridersK * grow * (1 + vot) ** (k - 1);
      if (l.carKmDay !== null)
        y.external += l.carKmDay * l.days * demandK * ridersK * grow * extPer * input.perIntl;
      const f = fares?.[l.id];
      if (f) y.fares += (f[k - 1] ?? f[f.length - 1] ?? 0) * demandK;
    }
  }
  return years;
}

/** Purpose: the present values and returns of a cash flow. */
export function present(
  years: CashYear[],
  pick: Pick,
  input: AppraisalInput,
  lines: AppraisalLine[],
): Present {
  const { prefs } = input;
  const modes = [...new Set(lines.map((l) => l.mode))];
  const one = (key: string) => pick(key, paramValue(key, modes.length === 1 ? modes[0]! : "*", prefs));
  const rs = one(socialRateKey(input.country));
  const rf = one("appraisal.discount.financial");
  const cf = one("appraisal.conversion_factor");
  const pv = (f: (y: CashYear) => number, r: number) => npv(years.map(f), r);
  const user = pv((y) => y.user, rs);
  const fares = pv((y) => y.fares, rs);
  const external = pv((y) => y.external, rs);
  const gdp = pv((y) => y.gdp, rs);
  const capital = cf * pv((y) => y.construction + y.renewals - y.residual, rs);
  const operating = cf * pv((y) => y.operating, rs);
  const benefits = user + fares + external + gdp;
  const costs = capital + operating;
  const econ = years.map(
    (y) =>
      y.user + y.fares + y.external + y.gdp - cf * (y.construction + y.renewals - y.residual + y.operating),
  );
  const fin = years.map((y) => y.fares - (y.construction + y.renewals - y.residual + y.operating));
  return {
    user,
    fares,
    external,
    gdp,
    capital,
    operating,
    benefits,
    costs,
    enpv: benefits - costs,
    bcr: costs > 0 ? benefits / costs : null,
    err: irr(econ),
    fnpv: npv(fin, rf),
    firr: irr(fin),
  };
}

/** One row of the appraisal: a line, all lines of a mode, or all lines. */
export interface AppraisalRow {
  id: string;
  scope: "line" | "mode" | "total";
  name: string;
  mode: string | null;
  color: string;
  timeline: Timeline;
  /** The medium case: every value at its central. */
  central: Present;
  /** Monte Carlo 10th, 50th and 90th percentiles. */
  enpv: Triple;
  bcr: Triple;
  err: Triple;
  fnpv: Triple;
  firr: Triple;
  /** Share of the draws with an ENPV above 0. */
  positive: number;
  /** Draws with a rate of return (the others have none). */
  errShare: number;
  firrShare: number;
}

export interface TornadoBar {
  name: string;
  label: string;
  /** ENPV with the value at its low and at its high. */
  low: number;
  high: number;
  /** The value at low and high, for the label. */
  values: [number, number];
  unit: string;
}

export interface Switching {
  id: "capex" | "opex" | "demand" | "user" | "gdp";
  label: string;
  /** Present value of the item in the medium case. */
  value: number;
  /** Change (share) of the item that brings the ENPV to 0; null when no change can. */
  change: number | null;
}

export interface Scenario {
  id: string;
  label: string;
  result: Present;
}

export interface Appraisal {
  rows: AppraisalRow[];
  /** All lines, the medium case, year by year. */
  years: CashYear[];
  tornado: TornadoBar[];
  switching: Switching[];
  tests: Scenario[];
  draws: number;
  notes: string[];
}

/** Labels of the inputs that are not parameters. */
export const INPUT_LABEL: Record<string, string> = {
  "input.capex": "Construction cost (cost tables)",
  "input.opex": "Operating cost (cost tables)",
  ridership: "Ridership (benefit tables / demand run)",
  "input.gdp": "GDP growth from agglomeration (benefit tables)",
};

interface Scope {
  id: string;
  scope: AppraisalRow["scope"];
  name: string;
  mode: string | null;
  color: string;
  lines: AppraisalLine[];
}

/** Purpose: the rows: each shown line, each mode with more than that one line in it, and all lines. */
export function scopes(lines: AppraisalLine[]): Scope[] {
  const modes = [...new Set(lines.map((l) => l.mode))];
  return [
    ...lines
      .filter((l) => l.shown)
      .map((l) => ({
        id: l.id,
        scope: "line" as const,
        name: l.name,
        mode: l.mode,
        color: l.color,
        lines: [l],
      })),
    // A mode of one line and nothing shared would repeat that line's row.
    ...modes
      .filter((m) => {
        const ls = lines.filter((l) => l.mode === m);
        return !(ls.length === 1 && ls[0]!.shown);
      })
      .map((m) => {
        const ls = lines.filter((l) => l.mode === m);
        return {
          id: `mode:${m}`,
          scope: "mode" as const,
          name: m,
          mode: m,
          color: ls.find((l) => l.shown)?.color ?? "#475569",
          lines: ls,
        };
      }),
    { id: "total", scope: "total" as const, name: "All lines", mode: null, color: "#0f172a", lines },
  ];
}

/** Purpose: the median fare revenue of each line and year over the draws (the medium case). */
function medianFares(runs: Record<string, number[]>[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!runs.length) return out;
  for (const id of Object.keys(runs[0]!)) {
    const n = runs[0]![id]!.length;
    out[id] = [];
    for (let t = 0; t < n; t++) out[id]!.push(p10p50p90(runs.map((r) => r[id]?.[t] ?? 0))[1]);
  }
  return out;
}

/** Purpose: the parameters the tornado chart varies, with the inputs, for the given lines. */
function tornadoNames(lines: AppraisalLine[], country: string | null, withDemand: boolean): string[] {
  const names = ["input.capex", "input.opex", "ridership", "input.gdp"];
  for (const key of Object.keys(PARAMS)) {
    if (key.startsWith("appraisal.mca.")) continue;
    if (key.startsWith("appraisal.discount.social") && key !== socialRateKey(country)) continue;
    if ((key.startsWith("appraisal.external.") || key === "appraisal.vot_growth") && !withDemand) continue;
    names.push(key);
  }
  return lines.length ? names : [];
}

/**
 * Purpose: the appraisal of a project: every row's medium case and Monte Carlo percentiles; for all lines the
 * cash flow, the tornado chart, the switching values and the standard tests (09 §3.4).
 * Inputs: the lines and settings; the number of draws and a seed. Output: the appraisal. No side effects.
 */
export function appraise(input: AppraisalInput, draws = 200, seed = 0xa9a1): Appraisal {
  const n = Math.max(20, draws);
  const notes: string[] = [];
  const rowsOf = scopes(input.lines);
  const maxPeriod = Math.max(1, ...rowsOf.map((s) => timeline(s.lines, central, input.prefs).period));
  // Fare revenue by line and year of operation, one set per draw (the same random numbers as the costs).
  const fareRuns: Record<string, number[]>[] = [];
  const us: ((name: string) => number)[] = [];
  for (let d = 0; d < n; d++) {
    const u = drawNumbers(seed, d);
    us.push(u);
    if (input.fares && input.fares.lines.length) {
      const fd = fareDraw(input.fares, maxPeriod, u);
      fareRuns.push(
        Object.fromEntries(Object.entries(fd.lines).map(([id, ys]) => [id, ys.map((y) => y.net)])),
      );
    }
  }
  const fares0 = input.fares ? medianFares(fareRuns) : null;
  // Fares at the medium case move with ridership, as in the draws.
  const centralFares = (pick: Pick): Record<string, number[]> | null => {
    if (!fares0) return null;
    const out: Record<string, number[]> = {};
    for (const l of input.lines) {
      const f = fares0[l.id];
      if (!f) continue;
      const k = l.annual[1] > 0 ? pick("ridership", l.annual) / l.annual[1] : 1;
      out[l.id] = f.map((v) => v * k);
    }
    return out;
  };
  const run = (lines: AppraisalLine[], pick: Pick, fares: Record<string, number[]> | null, shift?: Shift) => {
    const tl = timeline(lines, pick, input.prefs);
    const years = cashFlow(input, lines, pick, fares, tl, shift);
    return { tl, years, result: present(years, pick, input, lines) };
  };
  const mcPick =
    (u: (name: string) => number): Pick =>
    (name, t) =>
      POLICY.has(name) ? t[1] : triangular(t, u(name));
  const rows: AppraisalRow[] = rowsOf.map((s) => {
    const c = run(s.lines, central, centralFares(central));
    const res = us.map((u, d) => run(s.lines, mcPick(u), fareRuns[d] ?? null).result);
    const rates = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
    const err = rates(res.map((r) => r.err));
    const firr = rates(res.map((r) => r.firr));
    return {
      id: s.id,
      scope: s.scope,
      name: s.name,
      mode: s.mode,
      color: s.color,
      timeline: c.tl,
      central: c.result,
      enpv: p10p50p90(res.map((r) => r.enpv)),
      bcr: p10p50p90(rates(res.map((r) => r.bcr))),
      err: p10p50p90(err),
      fnpv: p10p50p90(res.map((r) => r.fnpv)),
      firr: p10p50p90(firr),
      positive: res.filter((r) => r.enpv > 0).length / res.length,
      errShare: err.length / res.length,
      firrShare: firr.length / res.length,
    };
  });

  const all = input.lines;
  const base = run(all, central, centralFares(central));
  const withDemand = all.some((l) => l.userDay !== null);
  if (!withDemand)
    notes.push(
      "No demand run is picked for ridership in the Demand section, so the users' benefit and the car-km saved are not counted.",
    );
  if (!input.fares)
    notes.push("Fare revenue is not counted until the fare revenue table has priced the lines.");
  // Tornado: each value at its low and its high, the others at their central.
  const tornado: TornadoBar[] = [];
  for (const name of tornadoNames(all, input.country, withDemand)) {
    const at =
      (i: 0 | 2): Pick =>
      (nm, t) =>
        nm === name ? t[i] : t[1];
    const lo = run(all, at(0), centralFares(at(0))).result.enpv;
    const hi = run(all, at(2), centralFares(at(2))).result.enpv;
    if (Math.abs(hi - lo) < 1e-9 * Math.max(1, Math.abs(base.result.enpv))) continue;
    const p = PARAMS[name];
    const tri = p ? paramValue(name, "*", input.prefs) : null;
    tornado.push({
      name,
      label: p ? p.label : (INPUT_LABEL[name] ?? name),
      low: lo,
      high: hi,
      values: tri ? [tri[0], tri[2]] : [0, 0],
      unit: p ? p.unit : "",
    });
  }
  tornado.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  // Switching values: how far one item can change before the ENPV reaches 0 (it is linear in each).
  const r = base.result;
  const sw = (id: Switching["id"], label: string, value: number, cost: boolean): Switching => ({
    id,
    label,
    value,
    change: value > 0 ? (cost ? r.enpv / value : -r.enpv / value) : null,
  });
  const switching = [
    sw("capex", "Construction cost, renewals and residual value", r.capital, true),
    sw("opex", "Operating cost", r.operating, true),
    sw("demand", "Ridership: users' benefit, fares and car-km saved", r.user + r.fares + r.external, false),
    ...(withDemand ? [sw("user", "Users' benefit (value of time)", r.user, false)] : []),
    sw("gdp", "GDP growth from agglomeration", r.gdp, false),
  ];
  const cf = centralFares(central);
  const tests: Scenario[] = [
    { id: "base", label: "Medium case", result: r },
    { id: "capex20", label: "Construction cost +20 %", result: run(all, central, cf, { capex: 1.2 }).result },
    { id: "capex40", label: "Construction cost +40 %", result: run(all, central, cf, { capex: 1.4 }).result },
    { id: "demand-20", label: "Ridership −20 %", result: run(all, central, cf, { demand: 0.8 }).result },
    { id: "delay2", label: "Opening 2 years later", result: run(all, central, cf, { delay: 2 }).result },
    { id: "opex10", label: "Operating cost +10 %", result: run(all, central, cf, { opex: 1.1 }).result },
  ];
  return { rows, years: base.years, tornado, switching, tests, draws: n, notes };
}

// ---------------------------------------------------------------------------------------------------------
// Multi-criteria analysis

/** A criterion the planner adds, scored by hand per line. */
export interface OwnCriterion {
  id: string;
  name: string;
  weight: number;
  /** True when a higher score is better. */
  higher: boolean;
  scores: Record<string, number>;
}

/** The appraisal's saved settings (drawing kind `appraisal`); the values are in Project preferences. */
export interface AppraisalDoc {
  criteria?: OwnCriterion[];
}

/** The built-in criteria, scored from the model outputs. */
export const BUILT_IN = [
  { id: "enpv", label: "Economic net present value", higher: true },
  { id: "ridership", label: "Boardings a year", higher: true },
  { id: "jobs", label: "Jobs reachable per resident, gain", higher: true },
  { id: "education", label: "Schools and universities reachable, gain", higher: true },
  { id: "healthcare", label: "Hospitals and clinics reachable, gain", higher: true },
  { id: "construction_cost", label: "Construction cost", higher: false },
] as const;
export type BuiltIn = (typeof BUILT_IN)[number]["id"];

export interface McaLine {
  id: string;
  name: string;
  color: string;
  /** Raw values of the built-in criteria (null when unknown). */
  values: Record<BuiltIn, number | null>;
}

export interface McaCriterion {
  id: string;
  label: string;
  higher: boolean;
  /** Weight as set, and as a share of all weights. */
  weight: number;
  share: number;
  own: boolean;
}

export interface McaResult {
  criteria: McaCriterion[];
  /** Per line: raw value and score 0–100 per criterion, total score, rank (1 best). */
  lines: {
    id: string;
    name: string;
    color: string;
    raw: Record<string, number | null>;
    scores: Record<string, number | null>;
    total: number;
    rank: number;
  }[];
}

/**
 * Purpose: a weighted-sum multi-criteria analysis of the lines: each criterion scored 0–100 between the worst
 * and the best line (100 for all when they are equal; lower is better for costs), weights normalised to add up
 * to 1, and the lines ranked by their weighted score. A line without a value for a criterion scores 0 on it.
 */
export function mca(
  lines: McaLine[],
  doc: AppraisalDoc | null,
  prefs: Record<string, number> | undefined,
): McaResult {
  const crit: (McaCriterion & { raw: (id: string) => number | null })[] = [
    ...BUILT_IN.map((c) => ({
      id: c.id,
      label: c.label,
      higher: c.higher,
      weight: Math.max(0, paramValue(`appraisal.mca.weight.${c.id}`, "*", prefs)[1]),
      share: 0,
      own: false,
      raw: (id: string) => lines.find((l) => l.id === id)?.values[c.id] ?? null,
    })),
    ...(doc?.criteria ?? []).map((c) => ({
      id: `own:${c.id}`,
      label: c.name,
      higher: c.higher,
      weight: Math.max(0, Number.isFinite(c.weight) ? c.weight : 0),
      share: 0,
      own: true,
      raw: (id: string) => {
        const v = c.scores[id];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      },
    })),
  ];
  const wsum = crit.reduce((s, c) => s + c.weight, 0);
  for (const c of crit) c.share = wsum > 0 ? c.weight / wsum : 0;
  const scored = lines.map((l) => {
    const raw: Record<string, number | null> = {};
    const scores: Record<string, number | null> = {};
    let total = 0;
    for (const c of crit) {
      const v = c.raw(l.id);
      raw[c.id] = v;
      const vs = lines.map((x) => c.raw(x.id)).filter((x): x is number => x !== null);
      if (v === null || !vs.length) {
        scores[c.id] = null;
        continue;
      }
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);
      const s = hi > lo ? (100 * (c.higher ? v - lo : hi - v)) / (hi - lo) : 100;
      scores[c.id] = s;
      total += c.share * s;
    }
    return { id: l.id, name: l.name, color: l.color, raw, scores, total, rank: 0 };
  });
  [...scored].sort((a, b) => b.total - a.total).forEach((x, i) => (x.rank = i + 1));
  return {
    criteria: crit.map((c) => ({
      id: c.id,
      label: c.label,
      higher: c.higher,
      weight: c.weight,
      share: c.share,
      own: c.own,
    })),
    lines: scored,
  };
}

/** Purpose: a stable random id for a new criterion. */
export function newId(): string {
  return Math.floor(seeded(Date.now() >>> 0)() * 2 ** 32).toString(36);
}

/** Purpose: the yearly ridership change the fare revenue table uses for a mode. */
export function ridershipGrowth(mode: string, own: Record<string, number> | undefined): number {
  return fareValue("fare.ridership_growth", own, mode)[1];
}

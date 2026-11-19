import type { MessageKey } from "../../i18n/messages";
/**
 * The fare revenue model of the Tables tab (ADR-0044): a line's boardings a year, from the ridership
 * estimate, times the average fare its riders pay. The fare follows the project's fare structure (flat,
 * zonal with the tariff zones drawn on the Schematic network map, or distance-based), tickets and passes,
 * discount groups, a fare elasticity of ridership, yearly fare and ridership changes, fare evasion and the
 * cost of collecting fares. Every value comes from the assumption library (assumptions/parameters/fares.yaml)
 * unless the project set its own. Low, medium and high come from a seeded Monte Carlo run.
 */
import data from "./defaults.generated.json";
import { p10p50p90, seeded, triangular, type Triple } from "../benefits/params";
import type { SchematicArea } from "../schematic/common";
import type { Pt } from "../schematic/layout";
import type { SchematicNetwork } from "../schematic/lines";

export type FareStructure = "flat" | "zonal" | "distance";
export const STRUCTURES: FareStructure[] = ["flat", "zonal", "distance"];
export const STRUCTURE_LABEL: Record<FareStructure, MessageKey> = {
  flat: "fare.flat",
  zonal: "fare.zonal",
  distance: "fare.distance",
};

/**
 * The fare revenue settings of a project (drawing kind `fares`): the fare structure and the values the
 * project changed. Fares are kept in 2023 international dollars (PPP), like the library, so they follow the
 * project's currency and price level; the table shows and takes them in the project's currency.
 */
export interface FaresDoc {
  structure?: FareStructure;
  values?: Record<string, number>;
}

export interface FareParam {
  label: string;
  unit: string;
  values: Record<string, Triple>;
}

export const FARE_PARAMS = (data as unknown as { params: Record<string, FareParam> }).params;

/** Parameters that are amounts of money (converted to the project's currency for display and input). */
export const MONEY = new Set([
  "fare.flat",
  "fare.zonal.first_zone",
  "fare.zonal.extra_zone",
  "fare.distance.base",
  "fare.distance.per_km",
  "fare.distance.max",
]);

/** The fare parameters each structure uses. */
export const STRUCTURE_KEYS: Record<FareStructure, string[]> = {
  flat: ["fare.flat"],
  zonal: ["fare.zonal.first_zone", "fare.zonal.extra_zone"],
  distance: ["fare.distance.base", "fare.distance.per_km", "fare.distance.max"],
};

/**
 * Values the project decides (fare levels, the pass price, the discounts and the yearly fare change): the
 * Monte Carlo run keeps them at the project's value. The others describe how people behave and vary between
 * low and high.
 */
export const POLICY = new Set([
  ...MONEY,
  "fare.pass.price_in_fares",
  "fare.concession.child.discount",
  "fare.concession.senior.discount",
  "fare.concession.student.discount",
  "fare.real_increase",
]);

export const GROUPS = ["child", "senior", "student"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = {
  child: "Children",
  senior: "Older people",
  student: "Students",
};

/** Purpose: the library's low, central and high value of a fare parameter for a mode (else "*"). */
export function libraryValue(key: string, mode = "*"): Triple {
  const p = FARE_PARAMS[key];
  if (!p) throw new Error(`unknown fare parameter ${key}`);
  return (p.values[mode] ?? p.values["*"]) as Triple;
}

/**
 * Purpose: the values a project uses for a parameter: its own value replaces the central one and low and
 * high move with it (as in the cost and benefit tables); with a library central of 0, the own value is all
 * three.
 */
export function fareValue(key: string, own: Record<string, number> | undefined, mode = "*"): Triple {
  const lib = libraryValue(key, mode);
  const v = own?.[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return lib;
  if (lib[1] === 0) return [v, v, v];
  const k = v / lib[1];
  const t: Triple = [lib[0] * k, v, lib[2] * k];
  return t[0] <= t[2] ? t : [t[2], v, t[0]];
}

/** One way to travel on a line: between two of its stops, with its share of the line's trips. */
export interface TripPair {
  km: number;
  zones: number;
  share: number;
}

/** The trips of a line, from its stops, their boardings and the tariff zones. */
export interface LineTrips {
  id: string;
  pairs: TripPair[];
  avgKm: number;
  avgZones: number;
}

/** Purpose: whether a point lies inside a polygon (even-odd rule). */
export function inside(p: Pt, ring: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi) hit = !hit;
  }
  return hit;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Purpose: the trips of each line of the diagram network. A line's trips are spread between each pair of
 * its stops in proportion to the boardings at both ends (the planner's own boardings by station name, else
 * the ridership estimate's; equal when neither is known). The distance is along the line; the zones are
 * the different tariff zones the stops on the way lie in (a stop outside every zone counts as a zone of its
 * own). Without tariff zones every trip is in one zone.
 * Inputs: the diagram network, its station positions (from the network map's layout), the drawn areas, the
 * estimate's boardings by line id and station name, and the planner's own boardings by station name.
 * Output: the trips by line id. No side effects.
 */
export function lineTrips(
  net: SchematicNetwork,
  pos: readonly Pt[],
  areas: readonly SchematicArea[],
  boardings: Record<string, Record<string, number>>,
  own: Record<string, number> | undefined,
): Map<string, LineTrips> {
  const zones = areas.filter((a) => a.kind === "zone" && a.points.length >= 3);
  const zoneOf = net.stations.map((_, i) => {
    const p = pos[i];
    if (!p) return "";
    return zones.find((z) => inside(p, z.points))?.id ?? "";
  });
  const ownBy = new Map(Object.entries(own ?? {}).map(([k, v]) => [norm(k), v]));
  const out = new Map<string, LineTrips>();
  for (const l of net.lines) {
    const n = l.stops.length;
    if (n < 2) continue;
    const est = new Map(Object.entries(boardings[l.id] ?? {}).map(([k, v]) => [norm(k), v]));
    const name = (i: number) => norm(net.stations[l.stops[i]!]?.name ?? "");
    let w = l.stops.map((_, i) => {
      const o = ownBy.get(name(i));
      const v = o !== undefined && Number.isFinite(o) ? o : est.get(name(i));
      return v !== undefined && Number.isFinite(v) ? Math.max(0, v) : 0;
    });
    if (!w.some((x) => x > 0)) w = w.map(() => 1);
    const at = [0];
    for (let i = 1; i < n; i++) at.push(at[i - 1]! + (l.distM[i - 1] ?? 0) / 1000);
    const pairs: TripPair[] = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const seen = new Set<string>([zoneOf[l.stops[i]!]!]);
      for (let j = i + 1; j < n; j++) {
        seen.add(zoneOf[l.stops[j]!]!);
        const weight = w[i]! * w[j]!;
        if (weight <= 0 || l.stops[i] === l.stops[j]) continue;
        pairs.push({ km: at[j]! - at[i]!, zones: zones.length ? seen.size : 1, share: weight });
        total += weight;
      }
    }
    if (!total) continue;
    for (const p of pairs) p.share /= total;
    out.set(l.id, {
      id: l.id,
      pairs,
      avgKm: pairs.reduce((s, p) => s + p.km * p.share, 0),
      avgZones: pairs.reduce((s, p) => s + p.zones * p.share, 0),
    });
  }
  return out;
}

/** The fare levels one evaluation uses, in the project's currency. */
interface Levels {
  flat: number;
  first: number;
  extra: number;
  base: number;
  perKm: number;
  max: number;
}

/** Purpose: the single fare of one trip. */
export function tripFare(structure: FareStructure, f: Levels, km: number, zones: number): number {
  if (structure === "flat") return f.flat;
  if (structure === "zonal") return f.first + Math.max(0, zones - 1) * f.extra;
  const v = f.base + f.perKm * km;
  return f.max > 0 ? Math.min(f.max, v) : v;
}

/** Purpose: the average single fare of a line's trips (the first trip pair when the line has none). */
function averageFare(structure: FareStructure, f: Levels, trips: LineTrips | undefined): number {
  if (!trips || !trips.pairs.length) return tripFare(structure, f, 0, 1);
  return trips.pairs.reduce((s, p) => s + p.share * tripFare(structure, f, p.km, p.zones), 0);
}

/** A line as the fare model sees it. */
export interface FareLine {
  id: string;
  name: string;
  mode: string;
  color: string;
  /** Boardings a year from the ridership estimate (low, medium, high). */
  annual: Triple;
}

export interface FareInput {
  structure: FareStructure;
  /** The project's own values (fares in 2023 international dollars). */
  own: Record<string, number> | undefined;
  /** Units of the project's currency per 2023 international dollar (PPP factor × price escalation). */
  perIntl: number;
  lines: FareLine[];
  trips: Map<string, LineTrips>;
}

/** One year of one draw, for a line or in total. */
export interface YearMoney {
  /** Boardings that year, after the fare's effect. */
  riders: number;
  /** Fares paid (after evasion). */
  gross: number;
  /** Cost of collecting them. */
  collection: number;
  /** Fares paid less the cost of collecting them. */
  net: number;
}

/** One Monte Carlo draw: each line's years, and the average fares of the first year. */
export interface FareDraw {
  lines: Record<string, YearMoney[]>;
  /** Average single fare and average fare paid per boarding, by line id, in the first year. */
  fares: Record<string, { single: number; paid: number }>;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Purpose: one draw of the fare revenue of every line for a number of years.
 * Inputs: the model input, the number of years, and a uniform random number per value (`u(name)` in
 * [0, 1); 0.5-ish gives about the central value). Policy values stay at the project's value.
 * Output: per line, the boardings, fares paid, collection cost and net revenue of each year (year 1 first).
 * The appraisal can call this with its own random numbers to draw fare revenue together with costs.
 */
export function fareDraw(input: FareInput, years: number, u: (name: string) => number): FareDraw {
  const { structure, own, perIntl } = input;
  const val = (key: string, mode: string) => {
    const t = fareValue(key, own, mode);
    return POLICY.has(key) ? t[1] : triangular(t, u(`${key}|${mode}`));
  };
  const ref = (key: string, mode: string) => libraryValue(key, mode)[1];
  const levels = (get: (k: string, m: string) => number, mode: string): Levels => ({
    flat: get("fare.flat", mode) * perIntl,
    first: get("fare.zonal.first_zone", mode) * perIntl,
    extra: get("fare.zonal.extra_zone", mode) * perIntl,
    base: get("fare.distance.base", mode) * perIntl,
    perKm: get("fare.distance.per_km", mode) * perIntl,
    max: get("fare.distance.max", mode) * perIntl,
  });
  const uRiders = u("ridership");
  const out: FareDraw = { lines: {}, fares: {} };
  for (const l of input.lines) {
    const m = l.mode;
    const trips = input.trips.get(l.id);
    const passShare = clamp01(val("fare.pass.trip_share", m));
    const tripsPerMonth = Math.max(1, val("fare.pass.trips_per_month", m));
    const ticket = (price: number) => 1 - passShare + (passShare * Math.max(0, price)) / tripsPerMonth;
    const discount = (get: (k: string, m: string) => number) =>
      Math.max(
        0,
        1 -
          GROUPS.reduce(
            (s, g) =>
              s +
              clamp01(val(`fare.concession.${g}.share`, m)) *
                clamp01(get(`fare.concession.${g}.discount`, m)),
            0,
          ),
      );
    const single = averageFare(structure, levels(val, m), trips);
    const paid = single * ticket(val("fare.pass.price_in_fares", m)) * discount(val);
    const refPaid =
      averageFare(structure, levels(ref, m), trips) *
      ticket(ref("fare.pass.price_in_fares", m)) *
      discount(ref);
    const e = val("fare.elasticity", m);
    const effect = refPaid > 0 && paid > 0 ? (paid / refPaid) ** e : 1;
    const riders0 = Math.max(0, triangular(l.annual, uRiders)) * effect;
    const growth = val("fare.ridership_growth", m);
    const rise = val("fare.real_increase", m);
    const evasion = clamp01(val("fare.evasion_share", m));
    const collect = clamp01(val("fare.collection_cost_share", m));
    const ys: YearMoney[] = [];
    for (let t = 0; t < years; t++) {
      const fareK = (1 + rise) ** t;
      const riders = riders0 * (1 + growth) ** t * fareK ** e;
      const gross = riders * (1 - evasion) * paid * fareK;
      const collection = gross * collect;
      ys.push({ riders, gross, collection, net: gross - collection });
    }
    out.lines[l.id] = ys;
    out.fares[l.id] = { single, paid };
  }
  return out;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Purpose: random numbers for one draw of `fareDraw`, seeded by the draw and the value's name. */
export function drawNumbers(seed: number, d: number): (name: string) => number {
  return (name) => seeded(hash(name) ^ seed ^ Math.imul(d + 1, 2654435761))();
}

/** One row of the fare revenue table: a line, all lines of a mode, or all lines. */
export interface FareRow {
  id: string;
  scope: "line" | "mode" | "total";
  name: string;
  mode: string | null;
  color: string;
  /** Boardings a year from the ridership estimate, before the fare's effect. */
  estimate: Triple;
  /** Boardings in the first year after the fare's effect. */
  riders: Triple;
  /** Average single fare and average fare paid per boarding (first year). */
  single: Triple;
  paid: Triple;
  /** Average trip length, km, and zones per trip (lines only; boardings-weighted for modes and in total). */
  avgKm: number | null;
  avgZones: number | null;
  /** First year: fares paid, cost of collecting them, and net. */
  gross: Triple;
  collection: Triple;
  net: Triple;
}

/** The totals of one year over all lines. */
export interface FareYear {
  year: number;
  riders: Triple;
  gross: Triple;
  collection: Triple;
  net: Triple;
}

export interface FareEstimate {
  rows: FareRow[];
  /** All lines, year by year. */
  years: FareYear[];
  draws: number;
}

/** Years the table shows and passes on. */
export const YEARS = 30;

/**
 * Purpose: the fare revenue per line, per mode and in total, and year by year, as the 10th, 50th and 90th
 * percentile of a seeded Monte Carlo run.
 * Inputs: the model input, the number of years and draws, and a seed. Output: the estimate. No side effects.
 */
export function fareEstimate(input: FareInput, years = YEARS, draws = 200, seed = 0xfa7e): FareEstimate {
  const n = Math.max(20, draws);
  const runs: FareDraw[] = [];
  for (let d = 0; d < n; d++) runs.push(fareDraw(input, years, drawNumbers(seed, d)));
  const modes = [...new Set(input.lines.map((l) => l.mode))];
  const scopes: {
    id: string;
    scope: FareRow["scope"];
    name: string;
    mode: string | null;
    color: string;
    lines: FareLine[];
  }[] = [
    ...input.lines.map((l) => ({
      id: l.id,
      scope: "line" as const,
      name: l.name,
      mode: l.mode,
      color: l.color,
      lines: [l],
    })),
    ...modes.map((m) => {
      const ls = input.lines.filter((l) => l.mode === m);
      return {
        id: `mode:${m}`,
        scope: "mode" as const,
        name: m,
        mode: m,
        color: ls[0]?.color ?? "#475569",
        lines: ls,
      };
    }),
    {
      id: "total",
      scope: "total" as const,
      name: "All lines",
      mode: null,
      color: "#0f172a",
      lines: input.lines,
    },
  ];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const rows: FareRow[] = scopes.map((s) => {
    const pick = (f: (r: FareDraw, id: string) => number) =>
      p10p50p90(runs.map((r) => sum(s.lines.map((l) => f(r, l.id)))));
    const riders = pick((r, id) => r.lines[id]?.[0]?.riders ?? 0);
    const gross = pick((r, id) => r.lines[id]?.[0]?.gross ?? 0);
    // Average fares weighted by each line's riders in the draw.
    const avg = (k: "single" | "paid") =>
      p10p50p90(
        runs.map((r) => {
          const w = sum(s.lines.map((l) => r.lines[l.id]?.[0]?.riders ?? 0));
          if (w <= 0) return sum(s.lines.map((l) => r.fares[l.id]?.[k] ?? 0)) / Math.max(1, s.lines.length);
          return sum(s.lines.map((l) => (r.lines[l.id]?.[0]?.riders ?? 0) * (r.fares[l.id]?.[k] ?? 0))) / w;
        }),
      );
    const weights = s.lines.map((l) => Math.max(0, l.annual[1]));
    const wsum = sum(weights);
    const tripAvg = (k: "avgKm" | "avgZones") => {
      const vs = s.lines.map((l) => input.trips.get(l.id)?.[k]);
      if (vs.some((v) => v === undefined)) return null;
      if (wsum <= 0) return sum(vs as number[]) / Math.max(1, vs.length);
      return sum((vs as number[]).map((v, i) => v * weights[i]!)) / wsum;
    };
    return {
      id: s.id,
      scope: s.scope,
      name: s.name,
      mode: s.mode,
      color: s.color,
      estimate: [0, 1, 2].map((i) => sum(s.lines.map((l) => l.annual[i]!))) as Triple,
      riders,
      single: avg("single"),
      paid: avg("paid"),
      avgKm: tripAvg("avgKm"),
      avgZones: tripAvg("avgZones"),
      gross,
      collection: pick((r, id) => r.lines[id]?.[0]?.collection ?? 0),
      net: pick((r, id) => r.lines[id]?.[0]?.net ?? 0),
    };
  });
  const out: FareYear[] = [];
  for (let t = 0; t < years; t++) {
    const tot = (k: keyof YearMoney) =>
      p10p50p90(runs.map((r) => sum(input.lines.map((l) => r.lines[l.id]?.[t]?.[k] ?? 0))));
    out.push({
      year: t + 1,
      riders: tot("riders"),
      gross: tot("gross"),
      collection: tot("collection"),
      net: tot("net"),
    });
  }
  return { rows, years: out, draws: n };
}

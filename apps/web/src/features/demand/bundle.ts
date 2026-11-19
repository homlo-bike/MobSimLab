/**
 * The input of a demand run (contracts/demand-input.schema.json) from the project: the zones with their people,
 * jobs and special generators, the published lines with running times and headways by period, and the
 * country's money figures. The streets are not sent: the API adds the OpenStreetMap street tiles of the
 * zones and the worker builds the street network from them.
 *
 * Values the planner gave a zone are used as given. The rest is estimated the way the benefit tables do
 * (ADR-0040): people from WorldPop, workers and children from the World Bank shares, jobs from the floor area of
 * OpenStreetMap buildings, and schools, universities, hospitals and clinics from OpenStreetMap places.
 */
import type { Note } from "../../i18n/i18n";
import type { Timetable } from "../journey-planner/types";
import { type BuildingIn, catchment, classify, type CountryFigures, type PlaceIn } from "../benefits/model";
import { paramValue } from "../benefits/params";
import { inRing, type LonLat, type Region, regionAt, ringAreaM2, ringCentre } from "../benefits/regions";
import type { PreferencesDoc } from "../../workspace/preferences";
import { demandValue } from "./params";
import { type DemandZone, type ZoneField, type ZoneValues, zoneCentre, zoneKm2 } from "./zones";

export type PeriodId = "am" | "md" | "pm" | "ev";
export const PERIOD_IDS: PeriodId[] = ["am", "md", "pm", "ev"];

/** Purpose: the four periods' windows in seconds after midnight, from the project's demand values. */
export function periodWindows(prefs: PreferencesDoc | null | undefined): Record<PeriodId, [number, number]> {
  const h = (k: string) => demandValue(`demand.period.${k}`, prefs) * 3600;
  return {
    am: [h("am_start_h"), h("am_end_h")],
    md: [h("am_end_h"), h("pm_start_h")],
    pm: [h("pm_start_h"), h("pm_end_h")],
    ev: [h("pm_end_h"), h("ev_end_h")],
  };
}

export interface BundleStop {
  id: string;
  name: string;
  lonlat: LonLat;
  mode: string;
  /** Step-free access as recorded in Create; null where nobody recorded the stop's features. */
  step_free?: boolean | null;
}

/** A drawn stop or platform with what Create records about its access (step-free, lift or ramp). */
export interface StopAccess {
  lonlat: LonLat;
  /** null where no feature of the stop is recorded. */
  stepFree: boolean | null;
}

/** A street setup from the GIS tab as the demand model reads it (contracts/demand-input.schema.json). */
export interface BundleStreetSetup {
  way: number;
  traffic_lanes?: number | null;
  bus_lane?: boolean | null;
  bike_lane?: boolean | null;
  separated?: boolean | null;
}

/** Farthest a drawn stop may be from a timetable stop to give it its step-free access, m. */
const STOP_MATCH_M = 50;

/**
 * Purpose: the timetable's stops with their step-free access from the nearest drawn stop or platform (within
 * 50 m); stops with no drawn stop near, or one with no recorded features, stay unknown (null).
 */
export function withStepFree(transit: BundleTransit, drawn: readonly StopAccess[]): BundleTransit {
  if (!drawn.length) return transit;
  const near = (p: LonLat): StopAccess | null => {
    let best: StopAccess | null = null;
    let bestM = STOP_MATCH_M;
    const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
    for (const d of drawn) {
      const m = Math.hypot((d.lonlat[0] - p[0]) * kx, (d.lonlat[1] - p[1]) * 110_574);
      if (m <= bestM) {
        best = d;
        bestM = m;
      }
    }
    return best;
  };
  return {
    ...transit,
    stops: transit.stops.map((s) => ({ ...s, step_free: near(s.lonlat)?.stepFree ?? null })),
  };
}

export interface BundlePattern {
  stops: string[];
  run_s: number[];
  headway_s: Partial<Record<PeriodId, number | null>>;
}

export interface BundleLine {
  id: string;
  name: string;
  mode: string;
  patterns: BundlePattern[];
}

export interface BundleTransit {
  stops: BundleStop[];
  lines: BundleLine[];
  catchment_m: Record<string, number>;
}

/** Shortest headway sent, s (the worker's limit). */
const MIN_HEADWAY_S = 30;

/**
 * Purpose: the published lines as the demand model reads them: the stops the lines call at, and per line its
 * stopping patterns with the mean running time between stops (dwell included) and the mean headway in each
 * period. Trips with the same stops in the same order form one pattern; a frequency pattern counts its
 * departures in each period.
 */
export function transitOf(tt: Timetable | null, prefs: PreferencesDoc | null | undefined): BundleTransit {
  if (!tt) return { stops: [], lines: [], catchment_m: {} };
  const windows = periodWindows(prefs);
  const routes = new Map(tt.routes.map((r) => [r.route_id, r]));
  const used = new Map<string, string>(); // stop id → mode
  type Acc = {
    stops: string[];
    run: number[];
    n: number;
    deps: number[];
    perPeriod?: Record<PeriodId, number>;
  };
  const byRoute = new Map<string, Map<string, Acc>>();
  const acc = (route: string, stops: string[]): Acc => {
    let m = byRoute.get(route);
    if (!m) byRoute.set(route, (m = new Map()));
    const key = stops.join("|");
    let a = m.get(key);
    if (!a) m.set(key, (a = { stops, run: stops.slice(1).map(() => 0), n: 0, deps: [] }));
    return a;
  };
  for (const t of tt.trips) {
    if (!routes.has(t.route_id)) continue;
    const st = [...t.stop_times].sort((a, b) => a.stop_sequence - b.stop_sequence);
    if (st.length < 2) continue;
    const a = acc(
      t.route_id,
      st.map((s) => s.stop_id),
    );
    for (let k = 0; k + 1 < st.length; k++)
      a.run[k]! += Math.max(0, st[k + 1]!.departure_time - st[k]!.departure_time);
    a.n++;
    a.deps.push(st[0]!.departure_time);
  }
  for (const p of tt.frequency_patterns ?? []) {
    if (!routes.has(p.route_id) || p.stops.length < 2) continue;
    const a = acc(
      p.route_id,
      p.stops.map((s) => s.stop_id),
    );
    // run_time is from the previous stop; the dwell at the next stop goes with the run to it.
    const run = p.stops.slice(1).map((s) => Math.max(0, s.run_time + s.dwell_time));
    const per = { am: 0, md: 0, pm: 0, ev: 0 } as Record<PeriodId, number>;
    for (const q of p.periods) {
      if (!(q.headway_secs > 0)) continue;
      for (const id of PERIOD_IDS) {
        const [w0, w1] = windows[id];
        const overlap = Math.max(0, Math.min(w1, q.end_time) - Math.max(w0, q.start_time));
        per[id] += overlap / q.headway_secs;
      }
    }
    const trips = Object.values(per).reduce((x, y) => x + y, 0) || 1;
    for (let k = 0; k < run.length; k++) a.run[k]! += run[k]! * trips;
    a.n += trips;
    a.perPeriod = Object.fromEntries(
      PERIOD_IDS.map((id) => [id, (a.perPeriod?.[id] ?? 0) + per[id]]),
    ) as Record<PeriodId, number>;
  }
  const lines: BundleLine[] = [];
  for (const [routeId, pats] of byRoute) {
    const r = routes.get(routeId)!;
    const patterns: BundlePattern[] = [];
    for (const a of pats.values()) {
      if (!a.n) continue;
      const counts: Record<PeriodId, number> = { am: 0, md: 0, pm: 0, ev: 0 };
      for (const d of a.deps)
        for (const id of PERIOD_IDS) if (d >= windows[id][0] && d < windows[id][1]) counts[id]++;
      for (const id of PERIOD_IDS) counts[id] += a.perPeriod?.[id] ?? 0;
      const headway_s: BundlePattern["headway_s"] = {};
      for (const id of PERIOD_IDS) {
        const len = windows[id][1] - windows[id][0];
        headway_s[id] =
          counts[id] > 0 && len > 0 ? Math.max(MIN_HEADWAY_S, Math.round(len / counts[id])) : null;
      }
      if (PERIOD_IDS.every((id) => headway_s[id] === null)) continue;
      patterns.push({ stops: a.stops, run_s: a.run.map((x) => Math.round((x / a.n) * 10) / 10), headway_s });
      for (const s of a.stops) used.set(s, r.mode);
    }
    if (patterns.length)
      lines.push({ id: routeId, name: r.route_short_name || routeId, mode: r.mode, patterns });
  }
  const stops: BundleStop[] = tt.stops
    .filter((s) => used.has(s.stop_id))
    .map((s) => ({
      id: s.stop_id,
      name: s.stop_name || s.stop_id,
      lonlat: [s.stop_lon, s.stop_lat],
      mode: used.get(s.stop_id)!,
    }));
  const modes = [...new Set(stops.map((s) => s.mode))];
  const values = prefs?.values;
  const catchment_m: Record<string, number> = { "*": catchment([], values) };
  for (const m of modes) catchment_m[m] = catchment([m], values);
  return { stops, lines, catchment_m };
}

// ---------------------------------------------------------------------------------------------------
// Zone values.

/** A zone as the demand model reads it (contracts/demand-input.schema.json `zone`). */
export interface BundleZone {
  id: string;
  name: string;
  centroid: LonLat;
  area_km2: number;
  population: number;
  workers: number;
  children: number;
  retail_jobs: number;
  other_jobs: number;
  schools: number;
  universities: number;
  hospitals: number;
  clinics: number;
  tourism: number;
  pupils?: number;
  visits?: number;
  cbd: boolean | null;
  parking_cost?: number | null;
}

/** Where each zone's values came from, for the zone table. */
export type ValueSource = "own" | "worldpop" | "buildings" | "places" | "country" | "none";

export interface EstimateInput {
  zones: DemandZone[];
  /** WorldPop people per zone id; null where unavailable. */
  worldpop: Record<string, number | null>;
  /** OpenStreetMap buildings and places of the loaded tiles; `covered` tells whether a zone's tiles loaded. */
  buildings: BuildingIn[];
  places: PlaceIn[];
  covered: (z: DemandZone) => boolean;
  country: CountryFigures;
  regions: Region[];
  prefs: PreferencesDoc | null | undefined;
}

export interface Estimated {
  zones: BundleZone[];
  /** Per zone id and value: where it came from. */
  sources: Record<string, Partial<Record<ZoneField, ValueSource>>>;
  notes: Note[];
}

/** Purpose: which zone holds each point, with a grid over the zones' boxes. */
export function zoneLocator(zones: DemandZone[]): (p: LonLat) => number {
  const cell = 0.005; // about 500 m
  const grid = new Map<string, number[]>();
  zones.forEach((z, i) => {
    const xs = z.ring.map((p) => p[0]);
    const ys = z.ring.map((p) => p[1]);
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++)
      for (let y = Math.floor(Math.min(...ys) / cell); y <= Math.floor(Math.max(...ys) / cell); y++) {
        const k = `${x},${y}`;
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
  });
  return (p) => {
    for (const i of grid.get(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`) ?? [])
      if (inRing(p, zones[i]!.ring)) return i;
    return -1;
  };
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Purpose: every zone's values for the demand model: the planner's own, else estimated. Output: the zones,
 * where each value came from, and notes on what is missing.
 */
export function estimateZones(input: EstimateInput): Estimated {
  const { zones, prefs, country, regions } = input;
  const values = prefs?.values;
  const central = (key: string) => paramValue(key, "*", values)[1];
  const notes: Note[] = [];
  const under15 = country.under15 ?? 0.18;
  const workerShare = country.employmentRatio15 !== null ? country.employmentRatio15 * (1 - under15) : 0.45;
  if (country.under15 === null) notes.push({ key: "dem.note.noChildren" });
  if (country.employmentRatio15 === null) notes.push({ key: "ben.note.noEmployment" });

  const locate = zoneLocator(zones);
  const homes = zones.map(() => 0);
  const retail = zones.map(() => 0);
  const other = zones.map(() => 0);
  const unknownHomes = central("benefit.unknown_building_residential_share");
  const defLevels = central("benefit.default_levels");
  const m2PerJob = {
    office: central("benefit.m2_per_job.office"),
    retail: central("benefit.m2_per_job.retail"),
    industrial: central("benefit.m2_per_job.industrial"),
    public: central("benefit.m2_per_job.public"),
  };
  const floorPerPerson = central("benefit.floor_m2_per_person");
  for (const b of input.buildings) {
    const at = ringCentre(b.ring);
    const i = locate(at);
    if (i < 0) continue;
    const use = classify(b.use, regionAt(regions, at), unknownHomes);
    if (!use.homes && !use.jobs) continue;
    const levels = b.levels ?? (b.height_m ? Math.max(1, Math.round(b.height_m / 3)) : defLevels);
    const floor = ringAreaM2(b.ring) * levels;
    if (!(floor > 0)) continue;
    homes[i]! += floor * use.homes;
    if (use.jobs) {
      const jobs = (floor * (1 - use.homes)) / m2PerJob[use.jobs];
      if (use.jobs === "retail") retail[i]! += jobs;
      else other[i]! += jobs;
    }
  }
  const placeCount = zones.map(() => ({ school: 0, university: 0, hospital: 0, clinic: 0 }));
  for (const p of input.places) {
    const i = locate(p.lonlat);
    if (i >= 0) placeCount[i]![p.kind]++;
  }

  const sources: Estimated["sources"] = {};
  let uncovered = 0;
  let noPeople = 0;
  const out = zones.map((z, i): BundleZone => {
    const own = z.values;
    const src: Partial<Record<ZoneField, ValueSource>> = {};
    const take = (key: ZoneField, estimate: () => [number, ValueSource]): number => {
      const v = own[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        src[key] = "own";
        return v;
      }
      const [n, s] = estimate();
      src[key] = s;
      return round(n);
    };
    const covered = input.covered(z);
    if (!covered) uncovered++;
    const population = take("population", () => {
      const wp = input.worldpop[z.id];
      if (typeof wp === "number" && Number.isFinite(wp)) return [wp, "worldpop"];
      if (covered && homes[i]! > 0) return [homes[i]! / floorPerPerson, "buildings"];
      return [0, "none"];
    });
    if (population <= 0) noPeople++;
    const workers = take("workers", () => [population * workerShare, "country"]);
    const children = take("children", () => [population * under15, "country"]);
    // Zones whose buildings were not loaded hold as many jobs as workers, so their trips stay balanced.
    const retailJobs = take("retail_jobs", () => (covered ? [retail[i]!, "buildings"] : [0, "none"]));
    const otherJobs = take("other_jobs", () => (covered ? [other[i]!, "buildings"] : [workers, "country"]));
    const count = (key: ZoneField, kind: keyof (typeof placeCount)[number]) =>
      take(key, () => (covered ? [placeCount[i]![kind], "places"] : [0, "none"]));
    const zone: BundleZone = {
      id: z.id,
      name: z.name,
      centroid: zoneCentre(z),
      area_km2: Math.round(zoneKm2(z) * 1000) / 1000,
      population,
      workers,
      children,
      retail_jobs: retailJobs,
      other_jobs: otherJobs,
      schools: count("schools", "school"),
      universities: count("universities", "university"),
      hospitals: count("hospitals", "hospital"),
      clinics: count("clinics", "clinic"),
      tourism: take("tourism", () => [0, "none"]),
      cbd: typeof own.cbd === "boolean" ? own.cbd : null,
    };
    for (const k of ["pupils", "visits", "parking_cost"] as const) {
      const v = own[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        zone[k] = v;
        src[k] = "own";
      }
    }
    sources[z.id] = src;
    return zone;
  });
  if (uncovered) notes.push({ key: "dem.note.uncovered", vars: { count: uncovered } });
  if (noPeople) notes.push({ key: "dem.note.noPeople", vars: { count: noPeople } });
  return { zones: out, sources, notes };
}

/** Purpose: whether a value is the planner's own (a number given for a zone). */
export function ownValue(v: ZoneValues, key: ZoneField): boolean {
  const n = v[key];
  return typeof n === "number" && Number.isFinite(n);
}

/** The country's money figures for the demand model. */
export interface BundleEconomy {
  currency: string;
  gdp_per_capita: number;
  ppp_per_usd: number;
}

export interface Bundle {
  version: 1;
  zones: BundleZone[];
  transit: BundleTransit;
  economy: BundleEconomy;
  street_setups?: BundleStreetSetup[];
}

/** Purpose: the bundle, and the counts the run list shows. */
export function makeBundle(
  zones: BundleZone[],
  transit: BundleTransit,
  economy: BundleEconomy,
  streetSetups: readonly BundleStreetSetup[] = [],
): { bundle: Bundle; summary: { zones: number; stops: number; lines: number } } {
  const setups = streetSetups
    .filter((s) => s.traffic_lanes != null || s.bus_lane != null || s.bike_lane != null)
    .map((s) => ({
      way: s.way,
      traffic_lanes: s.traffic_lanes ?? null,
      bus_lane: s.bus_lane ?? null,
      bike_lane: s.bike_lane ?? null,
      separated: s.separated ?? null,
    }));
  return {
    bundle: { version: 1, zones, transit, economy, ...(setups.length ? { street_setups: setups } : {}) },
    summary: { zones: zones.length, stops: transit.stops.length, lines: transit.lines.length },
  };
}

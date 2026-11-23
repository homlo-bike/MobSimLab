/**
 * The benefit estimate of a project (ADR-0040): access for people, ridership, GDP growth, resident
 * earnings, land value uplift, property tax and the stimulated economy, per line, per mode and in total,
 * as low, medium and high (10th, 50th and 90th percentile of a seeded Monte Carlo over the parameter
 * ranges and the cost range).
 *
 * Zones are the stations; their people, jobs, schools and health places come from the buildings and places
 * of OpenStreetMap, WorldPop and the World Bank, with the planner's regions taking priority. Travel times
 * between zones come from the journey planner with and without each line.
 */
import type { Note } from "../../i18n/i18n";
import type { LonLat, Timetable } from "../journey-planner/types";
import { compile, type Compiled, type Vars } from "./formula";
import { type BenefitsDoc, FORMULA_BY_ID, type FormulaId, FORMULAS, formulaText } from "./formulas";
import { type Net, type NetLine, networkOf, withoutRoutes } from "./network";
import { p10p50p90, paramValue, seeded, triangular, type Triple } from "./params";
import { type Region, regionAt, ringAreaM2, ringCentre, usable } from "./regions";
import { distanceM } from "../../map/geo";
import { sameNameStationM } from "../../workspace/preferences";

export type PlaceKind = "school" | "university" | "hospital" | "clinic";
export const PLACE_KINDS: PlaceKind[] = ["school", "university", "hospital", "clinic"];
export type AccessKind = "jobs" | PlaceKind;
export const ACCESS_KINDS: AccessKind[] = ["jobs", ...PLACE_KINDS];

export interface BuildingIn {
  id: string;
  ring: LonLat[];
  height_m?: number;
  levels?: number;
  use?: string;
}

export interface PlaceIn {
  id: string;
  kind: PlaceKind;
  lonlat: LonLat;
}

/** Country figures from the World Bank (shares 0–1, money in the project's currency). */
export interface CountryFigures {
  gdpPerCapita: number | null;
  /** Employed people as a share of the population aged 15 and over. */
  employmentRatio15: number | null;
  under15: number | null;
}

/** Spending of one line (or of a mode's shared items), low/medium/high, project currency. */
export interface Spending {
  civil: Triple;
  systems: Triple;
  vehicles: Triple;
  /** A year. */
  operating: Triple;
}

/** Travel times between stations in minutes, door to door from the zone's average walk. */
export type Matrix = number[][];

/** Earliest arrival from a point at every stop. */
/** Earliest arrival at stops by id, seconds after midnight; null or undefined where not reached. */
export type ReachFn = (from: LonLat, t0: number) => { get(stopId: string): number | null | undefined };

export const DEPARTURES_S = [7.5 * 3600, 8 * 3600, 8.5 * 3600];
const CELL_M = 50;

// ---------------------------------------------------------------------------------------------------
// Buildings: use, floor area, homes and jobs.

export type JobClass = "office" | "retail" | "industrial" | "public";
const RESIDENTIAL = new Set([
  "house",
  "residential",
  "apartments",
  "detached",
  "semidetached_house",
  "terrace",
  "dormitory",
  "bungalow",
  "cabin",
  "farm",
  "houseboat",
  "static_caravan",
]);
const CLASS: Record<string, JobClass> = {
  office: "office",
  commercial: "office",
  retail: "retail",
  shop: "retail",
  supermarket: "retail",
  kiosk: "retail",
  hotel: "retail",
  industrial: "industrial",
  warehouse: "industrial",
  manufacture: "industrial",
  factory: "industrial",
  hangar: "industrial",
  service: "industrial",
  school: "public",
  university: "public",
  college: "public",
  kindergarten: "public",
  hospital: "public",
  civic: "public",
  government: "public",
  public: "public",
  train_station: "public",
  transportation: "public",
  church: "public",
};
const EMPTY = new Set([
  "garage",
  "garages",
  "shed",
  "roof",
  "carport",
  "parking",
  "hut",
  "construction",
  "ruins",
  "greenhouse",
  "barn",
  "stable",
  "toilets",
  "bunker",
  "container",
]);

/** What a building holds: share of floor area that is homes, and the job class of the rest. */
export interface BuildingUse {
  homes: number;
  jobs: JobClass | null;
  /** True when OpenStreetMap only says `building=yes`. */
  unknown: boolean;
}

/** Purpose: what a building holds, from its OSM use and, for unknown buildings, the region's land use. */
export function classify(use: string | undefined, region: Region | null, unknownHomes: number): BuildingUse {
  const u = (use ?? "yes").toLowerCase();
  if (EMPTY.has(u)) return { homes: 0, jobs: null, unknown: false };
  if (RESIDENTIAL.has(u)) return { homes: 1, jobs: null, unknown: false };
  const amenity = u.startsWith("amenity:") ? u.slice(8) : null;
  if (amenity) {
    const c =
      CLASS[amenity] ?? (["school", "hospital", "clinic", "doctors"].includes(amenity) ? "public" : "retail");
    return { homes: 0, jobs: c, unknown: false };
  }
  const c = CLASS[u];
  if (c) return { homes: 0, jobs: c, unknown: false };
  switch (region?.values.landUse) {
    case "residential":
      return { homes: 1, jobs: null, unknown: true };
    case "commercial":
      return { homes: 0, jobs: "office", unknown: true };
    case "industrial":
      return { homes: 0, jobs: "industrial", unknown: true };
    case "public":
      return { homes: 0, jobs: "public", unknown: true };
    case "mixed":
      return { homes: 0.5, jobs: "office", unknown: true };
    default:
      return { homes: unknownHomes, jobs: "office", unknown: true };
  }
}

// ---------------------------------------------------------------------------------------------------
// Zones.

export interface Zone {
  id: string;
  name: string;
  at: LonLat;
  /** Walking catchment, m (largest of the modes calling here). */
  radius: number;
  lines: string[];
  modes: string[];
  pop: number;
  jobs: number;
  children: number;
  students: number;
  workers: number;
  gdpPerCapita: number;
  gdpPerWorker: number;
  places: Record<PlaceKind, number>;
  /** Average walk to the station within the zone, minutes. */
  accessMin: number;
}

/** A building inside a catchment, with what the land value formula needs. */
export interface BuildingRec {
  id: string;
  at: LonLat;
  floor: number;
  homes: number;
  region: Region | null;
  gdpPerCapita: number;
  /** Lines whose stations are within walking distance: line id, metres, catchment radius. */
  near: { line: string; d: number; r: number }[];
}

export interface Prepared {
  net: Net;
  zones: Zone[];
  buildings: BuildingRec[];
  /** Per region: floor area of homes and of work places among the buildings, and share of its area covered. */
  regionStock: Map<string, { homes: number; work: number; covered: number }>;
  notes: Note[];
  /** How the population of the zones was found. */
  popSource: { worldpop: number; buildings: number; regions: number };
  /** Walking speed and detour factor, from the project's preferences or the library. */
  walk: Walk;
}

export interface PrepareInput {
  timetable: Timetable;
  buildings: BuildingIn[];
  places: PlaceIn[];
  /** WorldPop people in each station's catchment circle (WorldPop year), null where unavailable. */
  worldpop: Record<string, number | null>;
  country: CountryFigures;
  regions: Region[];
  prefs: Record<string, number> | undefined;
}

const central = (key: string, mode: string, prefs: PrepareInput["prefs"]) => paramValue(key, mode, prefs)[1];

/** Purpose: the walking catchment of a station, m: the largest of its modes' `mode.catchment_m`. */
export function catchment(modes: string[], prefs: PrepareInput["prefs"]): number {
  return Math.max(...(modes.length ? modes : ["*"]).map((m) => central("mode.catchment_m", m, prefs)));
}

/** Purpose: a circle around a point as a closed ring of `n` points. */
export function circle(at: LonLat, r: number, n = 24): LonLat[] {
  const kx = 111_320 * Math.cos((at[1] * Math.PI) / 180);
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([at[0] + (r * Math.cos(a)) / kx, at[1] + (r * Math.sin(a)) / 110_574]);
  }
  out.push(out[0]!);
  return out;
}

/** Purpose: the stations of a timetable with their catchment circles, for the WorldPop request. */
export function catchments(tt: Timetable, prefs: PrepareInput["prefs"]): { id: string; ring: LonLat[] }[] {
  return networkOf(tt, sameNameStationM(prefs)).stations.map((s) => ({
    id: s.id,
    ring: circle(s.at, catchment(s.modes, prefs)),
  }));
}

/**
 * Purpose: the stations that may be within their catchment of a point, found on a grid of squares
 * at least as wide as the largest catchment, so the zones of a network with hundreds of stops do not
 * measure every 50 m cell against every stop (the Tables tab froze on the Damascus network, bug 21).
 * Input: the stations with their catchment radius, m. Output: a function giving, for a point, the
 * indexes of the stations in its square and the eight around it, in ascending order; every station
 * whose catchment holds the point is among them (all stations for a network spread over more than
 * two degrees of latitude).
 */
export function stationsAround(st: readonly { at: LonLat; radius: number }[]): (p: LonLat) => number[] {
  const lats = st.map((s) => s.at[1]);
  // Across more than two degrees of latitude the flat squares stop being safe: check every station.
  if (!st.length || Math.max(...lats) - Math.min(...lats) > 2) {
    const every = st.map((_, i) => i);
    return () => every;
  }
  const lat0 = lats.reduce((a, v) => a + v, 0) / st.length;
  // A margin for the flat projection across a city or region; the distances themselves are measured
  // on the sphere by the caller.
  const size = Math.max(1, ...st.map((s) => s.radius)) * 1.25 + 100;
  const kx = 111_320 * Math.max(0.01, Math.cos((lat0 * Math.PI) / 180));
  const sq = (p: LonLat): [number, number] => [
    Math.floor((p[0] * kx) / size),
    Math.floor((p[1] * 110_574) / size),
  ];
  const grid = new Map<string, number[]>();
  st.forEach((s, i) => {
    const [x, y] = sq(s.at);
    const k = `${x},${y}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  return (p) => {
    const [x, y] = sq(p);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${x + dx},${y + dy}`);
        if (list) out.push(...list);
      }
    return out.sort((a, b) => a - b);
  };
}

/** Prefixes of the project values that `prepare` and `access` read: catchments, walking and benefit values. */
const PREPARE_KEYS = ["benefit.", "mode.catchment_m", "journey.", "demand.walk_speed_kmh"];

/**
 * Purpose: the project values `prepare` and `access` read, without the rest (unit costs, fares, timetables),
 * so editing a cost does not prepare the zones and reach the stations again (the Tables tab froze for a
 * minute on the Damascus network after each unit-cost edit). Input: the project's values. Output: a subset.
 */
export function prepareValues(prefs: PrepareInput["prefs"]): Record<string, number> {
  return Object.fromEntries(
    Object.entries(prefs ?? {}).filter(([k]) => PREPARE_KEYS.some((p) => k.startsWith(p))),
  );
}

/** Purpose: the people, jobs and places of every station's zone, and the buildings near the lines. */
export function prepare(input: PrepareInput): Prepared {
  const { prefs, country, regions } = input;
  const notes: Note[] = [];
  const net = networkOf(input.timetable, sameNameStationM(prefs));
  const st = net.stations.map((s) => ({ ...s, radius: catchment(s.modes, prefs) }));
  const around = stationsAround(st);
  const nearest = (p: LonLat): { i: number; d: number } | null => {
    let best: { i: number; d: number } | null = null;
    for (const i of around(p)) {
      const s = st[i]!;
      const d = distanceM(p, s.at);
      if (d <= s.radius && (!best || d < best.d)) best = { i, d };
    }
    return best;
  };

  const under15 = country.under15 ?? 0.18;
  const nationalWorkers =
    country.employmentRatio15 !== null ? country.employmentRatio15 * (1 - under15) : 0.45;
  if (country.employmentRatio15 === null) notes.push({ key: "ben.note.noEmployment" });
  const nationalGdp = country.gdpPerCapita ?? 0;
  if (country.gdpPerCapita === null) notes.push({ key: "ben.note.noGdp" });
  const gdpAt = (r: Region | null) =>
    usable(r?.values.gdpPerCapita) ? r!.values.gdpPerCapita! : nationalGdp;
  const workersAt = (r: Region | null) =>
    usable(r?.values.employmentRate) && r!.values.employmentRate! <= 1
      ? r!.values.employmentRate!
      : nationalWorkers;

  // Buildings: floor area, homes and jobs; assigned to a 50 m cell and to the nearest station.
  const unknownHomes = central("benefit.unknown_building_residential_share", "*", prefs);
  const defLevels = central("benefit.default_levels", "*", prefs);
  const m2PerJob: Record<JobClass, number> = {
    office: central("benefit.m2_per_job.office", "*", prefs),
    retail: central("benefit.m2_per_job.retail", "*", prefs),
    industrial: central("benefit.m2_per_job.industrial", "*", prefs),
    public: central("benefit.m2_per_job.public", "*", prefs),
  };
  const floorPerPerson = central("benefit.floor_m2_per_person", "*", prefs);
  const all = st.map((s) => s.at);
  const lat0 = all.length ? all.reduce((a, p) => a + p[1], 0) / all.length : 0;
  const lon0 = all.length ? all.reduce((a, p) => a + p[0], 0) / all.length : 0;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const cellOf = (p: LonLat) =>
    `${Math.floor(((p[0] - lon0) * kx) / CELL_M)},${Math.floor(((p[1] - lat0) * 110_574) / CELL_M)}`;
  const cellHomes = new Map<string, number>();
  const cellJobs = new Map<string, number>();
  const buildings: BuildingRec[] = [];
  const regionStock = new Map<string, { homes: number; work: number; covered: number }>();
  const lineStations = net.lines.map((l) => ({
    l,
    at: l.stations.map((id) => st.find((s) => s.id === id)!),
  }));
  for (const b of input.buildings) {
    const at = ringCentre(b.ring);
    if (!nearest(at)) continue;
    const region = regionAt(regions, at);
    const use = classify(b.use, region, unknownHomes);
    if (!use.homes && !use.jobs) continue;
    const levels = b.levels ?? (b.height_m ? Math.max(1, Math.round(b.height_m / 3)) : defLevels);
    const floor = ringAreaM2(b.ring) * levels;
    if (!(floor > 0)) continue;
    const cell = cellOf(at);
    cellHomes.set(cell, (cellHomes.get(cell) ?? 0) + floor * use.homes);
    if (use.jobs)
      cellJobs.set(cell, (cellJobs.get(cell) ?? 0) + (floor * (1 - use.homes)) / m2PerJob[use.jobs]);
    const near: BuildingRec["near"] = [];
    for (const { l, at: stops } of lineStations) {
      const r = central("mode.catchment_m", l.mode, prefs);
      let d = Infinity;
      for (const s of stops) d = Math.min(d, distanceM(at, s.at));
      if (d <= r) near.push({ line: l.id, d, r });
    }
    if (region) {
      const k = regionStock.get(region.id) ?? { homes: 0, work: 0, covered: 0 };
      k.homes += floor * use.homes;
      k.work += floor * (1 - use.homes);
      regionStock.set(region.id, k);
    }
    if (near.length)
      buildings.push({ id: b.id, at, floor, homes: use.homes, region, gdpPerCapita: gdpAt(region), near });
  }

  // Cells: the population and jobs of each 50 m cell within a catchment, by the first source that has it.
  const zonesAcc = st.map(() => ({ pop: 0, jobs: 0, workers: 0, gdp: 0 }));
  const popSource = { worldpop: 0, buildings: 0, regions: 0 };
  const cellArea = CELL_M * CELL_M;
  const nCells = new Map<number, number>();
  const cells: { at: LonLat; key: string; zone: number; circles: number[] }[] = [];
  if (st.length) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const z of st) {
      const dx = z.radius / kx;
      const dy = z.radius / 110_574;
      [w, s, e, n] = [
        Math.min(w, z.at[0] - dx),
        Math.min(s, z.at[1] - dy),
        Math.max(e, z.at[0] + dx),
        Math.max(n, z.at[1] + dy),
      ];
    }
    const step = { x: CELL_M / kx, y: CELL_M / 110_574 };
    const x0 = lon0 + Math.floor(((w - lon0) * kx) / CELL_M) * step.x;
    const y0 = lat0 + Math.floor(((s - lat0) * 110_574) / CELL_M) * step.y;
    for (let x = x0; x <= e; x += step.x)
      for (let y = y0; y <= n; y += step.y) {
        const at: LonLat = [x + step.x / 2, y + step.y / 2];
        const circles = around(at).filter((i) => distanceM(at, st[i]!.at) <= st[i]!.radius);
        if (!circles.length) continue;
        const zone = nearest(at)!.i;
        for (const c of circles) nCells.set(c, (nCells.get(c) ?? 0) + 1);
        cells.push({ at, key: cellOf(at), zone, circles });
      }
  }
  for (const c of cells) {
    const region = regionAt(regions, c.at);
    if (region) {
      const k = regionStock.get(region.id) ?? { homes: 0, work: 0, covered: 0 };
      k.covered += cellArea / Math.max(1, ringAreaM2(region.ring));
      regionStock.set(region.id, k);
    }
    let pop: number;
    if (usable(region?.values.populationDensity)) {
      pop = (region!.values.populationDensity! * cellArea) / 1e6;
      popSource.regions++;
    } else {
      const wp = c.circles.map((i) => input.worldpop[st[i]!.id]);
      if (wp.every((v) => typeof v === "number" && Number.isFinite(v))) {
        pop =
          c.circles.reduce((a, i, k) => a + (wp[k] as number) / Math.max(1, nCells.get(i) ?? 1), 0) /
          c.circles.length;
        popSource.worldpop++;
      } else {
        pop = (cellHomes.get(c.key) ?? 0) / floorPerPerson;
        popSource.buildings++;
      }
    }
    const jobs =
      usable(region?.values.jobs) && ringAreaM2(region!.ring) > 0
        ? (region!.values.jobs! * cellArea) / ringAreaM2(region!.ring)
        : (cellJobs.get(c.key) ?? 0);
    const z = zonesAcc[c.zone]!;
    z.pop += pop;
    z.jobs += jobs;
    z.workers += pop * workersAt(region);
    z.gdp += jobs * (gdpAt(region) / Math.max(0.05, workersAt(region)));
  }
  if (popSource.buildings && popSource.worldpop) notes.push({ key: "ben.note.worldPopPart" });
  else if (popSource.buildings && !popSource.regions) notes.push({ key: "ben.note.worldPopNone" });

  const places = st.map(
    () => ({ school: 0, university: 0, hospital: 0, clinic: 0 }) as Record<PlaceKind, number>,
  );
  for (const p of input.places) {
    const z = nearest(p.lonlat);
    if (z) places[z.i]![p.kind]++;
  }
  const students = central("benefit.age_18_24_share", "*", prefs);
  const walkMs = central("demand.walk_speed_kmh", "*", prefs) / 3.6;
  const detour = central("journey.walk_detour_factor", "*", prefs);
  const zones: Zone[] = st.map((s, i) => {
    const a = zonesAcc[i]!;
    const region = regionAt(regions, s.at);
    const gdpPerCapita = gdpAt(region);
    const wpc = workersAt(region);
    return {
      id: s.id,
      name: s.name,
      at: s.at,
      radius: s.radius,
      lines: s.lines,
      modes: s.modes,
      pop: a.pop,
      jobs: a.jobs,
      children: a.pop * under15,
      students: a.pop * students,
      workers: a.workers,
      gdpPerCapita,
      gdpPerWorker: a.jobs > 0 ? a.gdp / a.jobs : gdpPerCapita / Math.max(0.05, wpc),
      places: places[i]!,
      accessMin: Math.max(1, ((2 / 3) * s.radius * detour) / walkMs / 60),
    };
  });
  return { net, zones, buildings, regionStock, notes, popSource, walk: { kmh: walkMs * 3.6, detour } };
}

// ---------------------------------------------------------------------------------------------------
// Travel times and access.

/** The scenarios the estimate compares: the whole network, none, and without each line and each mode. */
export interface Scenario {
  key: string;
  without: Set<string> | "all";
}

/** Purpose: the scenarios for a network: "all", "none", "-line:<id>" and "-mode:<mode>" (when it has 2+ modes or lines). */
export function scenarios(net: Net): Scenario[] {
  const out: Scenario[] = [
    { key: "all", without: new Set() },
    { key: "none", without: "all" },
  ];
  if (net.lines.length > 1)
    for (const l of net.lines) out.push({ key: `-line:${l.id}`, without: new Set([l.id]) });
  const modes = [...new Set(net.lines.map((l) => l.mode))];
  if (modes.length > 1)
    for (const m of modes)
      out.push({
        key: `-mode:${m}`,
        without: new Set(net.lines.filter((l) => l.mode === m).map((l) => l.id)),
      });
  return out;
}

/** Purpose: the timetable of a scenario, or null when it has no transit. */
export function scenarioTimetable(tt: Timetable, s: Scenario): Timetable | null {
  if (s.without === "all") return null;
  return s.without.size ? withoutRoutes(tt, s.without) : tt;
}

/** Walking speed and detour factor of an estimate (`demand.walk_speed_kmh`, `journey.walk_detour_factor`). */
export interface Walk {
  kmh: number;
  detour: number;
}

/** Purpose: minutes on foot between two stations (door to door is added by `matrix`). */
export function walkMin(a: LonLat, b: LonLat, walk: Walk): number {
  return (distanceM(a, b) * walk.detour) / (walk.kmh / 3.6) / 60;
}

/**
 * Purpose: door-to-door minutes between every pair of zones: the walk within each zone, plus the faster of
 * walking and public transport between the stations, averaged over the peak departures.
 * Inputs: `reach` from a compiled scenario timetable, or null for walking only.
 */
export function matrix(
  zones: Zone[],
  stationStops: string[][],
  reach: ReachFn | null,
  walking: Walk,
): Matrix {
  return zones.map((_, i) => matrixRow(i, zones, stationStops, reach, walking));
}

/** Purpose: one row of `matrix`: door-to-door minutes from zone `i` to every zone. */
export function matrixRow(
  i: number,
  zones: Zone[],
  stationStops: string[][],
  reach: ReachFn | null,
  walking: Walk,
): number[] {
  const n = zones.length;
  const sums = new Array<number>(n).fill(0);
  const answers = reach ? DEPARTURES_S.map((t0) => ({ t0, at: reach(zones[i]!.at, t0) })) : [];
  for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const walk = walkMin(zones[i]!.at, zones[j]!.at, walking);
    if (!answers.length) {
      sums[j] = walk;
      continue;
    }
    let total = 0;
    for (const { t0, at } of answers) {
      let best = Infinity;
      for (const sid of stationStops[j]!) {
        const a = at.get(sid);
        if (a !== null && a !== undefined) best = Math.min(best, (a - t0) / 60);
      }
      total += Math.min(walk, best);
    }
    sums[j] = total / answers.length;
  }
  const own = zones[i]!.accessMin;
  return zones.map((z, j) => (i === j ? own : own + sums[j]! + z.accessMin));
}

/** What a zone can reach in one scenario. */
export interface ZoneAccess {
  cum: Record<AccessKind, number>;
  /** Jobs weighted by exp(−β t). */
  expJobs: number;
  /** Effective density: jobs weighted by 1 / t^α. */
  ed: number;
}

/** Purpose: what each zone reaches with the given travel times. */
export function access(zones: Zone[], m: Matrix, prefs: PrepareInput["prefs"]): ZoneAccess[] {
  const limit = Object.fromEntries(
    PLACE_KINDS.map((k) => [k, central(`benefit.time_limit.${k}`, "*", prefs)]),
  ) as Record<PlaceKind, number>;
  const jobsLimit = central("benefit.time_limit.jobs", "*", prefs);
  const beta = central("benefit.access_decay_per_min", "*", prefs);
  const alpha = central("benefit.ed_decay", "*", prefs);
  return zones.map((_, i) => {
    const cum = { jobs: 0, school: 0, university: 0, hospital: 0, clinic: 0 } as Record<AccessKind, number>;
    let expJobs = 0;
    let ed = 0;
    zones.forEach((z, j) => {
      const t = m[i]![j]!;
      if (t <= jobsLimit) cum.jobs += z.jobs;
      for (const k of PLACE_KINDS) if (t <= limit[k]) cum[k] += z.places[k];
      expJobs += z.jobs * Math.exp(-beta * t);
      ed += z.jobs / Math.max(1, t) ** alpha;
    });
    return { cum, expJobs, ed };
  });
}

// ---------------------------------------------------------------------------------------------------
// The estimate.

export type Metric = FormulaId;
export const METRICS: Metric[] = FORMULAS.map((f) => f.id);

/** People and places for one row (not money, no range: they follow from the travel times). */
export interface AccessRow {
  /** People living near the row's stations. */
  pop: number;
  jobsNear: number;
  /** Average reachable per person in the relevant group (children for schools, 18–24 for universities). */
  before: Record<AccessKind, number>;
  after: Record<AccessKind, number>;
  /** People in the relevant group who could reach none before and can now. */
  gaining: Record<AccessKind, number>;
}

export interface Row {
  id: string;
  scope: "line" | "mode" | "total";
  name: string;
  mode: string | null;
  color: string;
  values: Record<Metric, Triple>;
  access: AccessRow;
}

export interface Estimate {
  rows: Row[];
  notes: Note[];
  draws: number;
  /**
   * Weekday boardings of each line at each of its stations with the central parameter values, by line id
   * and station name (the fare revenue table spreads a line's trips between its stations with them).
   */
  stations: Record<string, Record<string, number>>;
}

export interface EstimateInput {
  prepared: Prepared;
  /** Access per scenario key (see `scenarios`). */
  access: Map<string, ZoneAccess[]>;
  /** Spending by line id, and by `:<mode>` for a mode's shared items. */
  spending: Map<string, Spending>;
  country: CountryFigures;
  prefs: Record<string, number> | undefined;
  doc: BenefitsDoc | null | undefined;
  draws?: number;
  seed?: number;
}

const ZERO: Triple = [0, 0, 0];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Purpose: weight of the land value uplift at a distance: 1 near the station, 0 at the catchment edge. */
export function decay(d: number, r: number, inner: number): number {
  const a = r * inner;
  if (d <= a) return 1;
  if (d >= r) return 0;
  return (r - d) / (r - a);
}

/** Purpose: the estimate per line, per mode and in total. */
/**
 * Purpose: split a network's total between its lines in proportion to what each adds on its own (the network
 * with and without the line), so the lines add up to the total. Negative own values count as nothing.
 * Output: one value per line; all 0 when no line adds anything.
 */
export function shareOfTotal(own: readonly number[], total: number): number[] {
  const sum = own.reduce((s, v) => s + Math.max(0, v), 0);
  return own.map((v) => (sum > 0 ? (total * Math.max(0, v)) / sum : 0));
}

export function estimate(input: EstimateInput): Estimate {
  const { prepared: P, prefs, country } = input;
  const notes = [...P.notes];
  const draws = Math.max(20, input.draws ?? 200);
  const fns = Object.fromEntries(
    FORMULAS.map((f) => [
      f.id,
      compile(
        formulaText(input.doc, f.id),
        f.vars.map((x) => x.name),
      ).fn,
    ]),
  ) as Record<FormulaId, Compiled>;
  const all = input.access.get("all");
  const none = input.access.get("none");
  if (!all || !none) throw new Error("access for the whole network and for no network is needed");
  const zoneIdx = new Map(P.zones.map((z, i) => [z.id, i]));
  const lines = P.net.lines;
  const modes = [...new Set(lines.map((l) => l.mode))];
  const inner = central("benefit.uplift_inner_share", "*", prefs);
  const nationalWorkers =
    country.employmentRatio15 !== null ? country.employmentRatio15 * (1 - (country.under15 ?? 0.18)) : 0.45;
  const nationalGdpPerWorker = (country.gdpPerCapita ?? 0) / Math.max(0.05, nationalWorkers);

  interface Scope {
    id: string;
    scope: Row["scope"];
    name: string;
    mode: string | null;
    color: string;
    lines: NetLine[];
    before: ZoneAccess[];
    spendKeys: string[];
  }
  const scopes: Scope[] = [];
  for (const l of lines)
    scopes.push({
      id: l.id,
      scope: "line",
      name: l.name,
      mode: l.mode,
      color: l.color,
      lines: [l],
      before: input.access.get(`-line:${l.id}`) ?? none,
      spendKeys: [l.id],
    });
  for (const m of modes) {
    const ls = lines.filter((l) => l.mode === m);
    scopes.push({
      id: `mode:${m}`,
      scope: "mode",
      name: m,
      mode: m,
      color: ls[0]?.color ?? "#475569",
      lines: ls,
      before: input.access.get(`-mode:${m}`) ?? none,
      spendKeys: [...ls.map((l) => l.id), `:${m}`],
    });
  }
  scopes.push({
    id: "total",
    scope: "total",
    name: "All lines",
    mode: null,
    color: "#0f172a",
    lines,
    before: none,
    spendKeys: [...input.spending.keys()],
  });

  // People and places (no draws).
  const group = (z: (typeof P.zones)[number], k: AccessKind) =>
    k === "school" ? z.children : k === "university" ? z.students : z.pop;
  const accessRow = (s: Scope): AccessRow => {
    const stations = new Set(s.lines.flatMap((l) => l.stations));
    const before = {} as Record<AccessKind, number>;
    const after = {} as Record<AccessKind, number>;
    const gaining = {} as Record<AccessKind, number>;
    for (const k of ACCESS_KINDS) {
      let w = 0;
      let b = 0;
      let a = 0;
      let g = 0;
      P.zones.forEach((z, i) => {
        const people = group(z, k);
        w += people;
        b += people * s.before[i]!.cum[k];
        a += people * all[i]!.cum[k];
        if (s.before[i]!.cum[k] <= 0 && all[i]!.cum[k] > 0) g += people;
      });
      before[k] = w ? b / w : 0;
      after[k] = w ? a / w : 0;
      gaining[k] = g;
    }
    let pop = 0;
    let jobsNear = 0;
    for (const id of stations) {
      const z = P.zones[zoneIdx.get(id) ?? -1];
      if (z) {
        pop += z.pop;
        jobsNear += z.jobs;
      }
    }
    return { pop, jobsNear, before, after, gaining };
  };

  // For land value: per scope, each building's best line (by central uplift × decay).
  const upKey = (homes: boolean) => (homes ? "benefit.uplift.residential" : "benefit.uplift.commercial");
  const bestNear = (s: Scope) => {
    const ids = new Set(s.lines.map((l) => l.id));
    const mode = new Map(s.lines.map((l) => [l.id, l.mode]));
    const out: { b: BuildingRec; mode: string; d: number; r: number }[] = [];
    for (const b of P.buildings) {
      let best: { mode: string; d: number; r: number; w: number } | null = null;
      for (const n of b.near) {
        if (!ids.has(n.line)) continue;
        const m = mode.get(n.line)!;
        const w =
          decay(n.d, n.r, inner) *
          (b.homes * central(upKey(true), m, prefs) + (1 - b.homes) * central(upKey(false), m, prefs));
        if (!best || w > best.w) best = { mode: m, d: n.d, r: n.r, w };
      }
      if (best) out.push({ b, mode: best.mode, d: best.d, r: best.r });
    }
    return out;
  };
  const near = scopes.map(bestNear);

  // Station shares of each line (a station served by k lines gives each 1/k of its people).
  const stationLines = new Map(P.zones.map((z) => [z.id, z.lines.length || 1]));

  const results = scopes.map(
    () => Object.fromEntries(METRICS.map((m) => [m, [] as number[]])) as Record<Metric, number[]>,
  );
  for (let d = 0; d < draws; d++) {
    const memo = new Map<string, number>();
    const p = (key: string, mode = "*") => {
      const k = `${key}|${mode}`;
      let v = memo.get(k);
      if (v === undefined) {
        v = triangular(paramValue(key, mode, prefs), seeded(hash(k) ^ Math.imul(d + 1, 2654435761))());
        memo.set(k, v);
      }
      return v;
    };
    const uCost = seeded(0x5eed ^ Math.imul(d + 1, 40503))();
    const cost = (t: Triple) => triangular(t, uCost);
    const labour = p("benefit.labour_income_share");
    const ratio = p("benefit.value_per_m2_gdp_ratio");
    const commercial = p("benefit.commercial_value_factor");
    const taxRate = p("benefit.property_tax_rate");
    // Effective tax rate of regions with a tax revenue: revenue ÷ estimated value of the whole region.
    const regionRate = new Map<string, number>();
    const valuePerM2 = (b: BuildingRec, homes: boolean) => {
      const own = b.region?.values.landValuePerM2;
      if (usable(own)) return own;
      return b.gdpPerCapita * ratio * (homes ? 1 : commercial);
    };
    for (const [id, k] of P.regionStock) {
      const r = P.buildings.find((b) => b.region?.id === id)?.region;
      if (!r || !usable(r.values.taxRevenuePerYear) || k.covered <= 0) continue;
      const own = r.values.landValuePerM2;
      const vh = usable(own) ? own : (r.values.gdpPerCapita ?? country.gdpPerCapita ?? 0) * ratio;
      const vw = usable(own) ? own : vh * commercial;
      const value = (k.homes * vh + k.work * vw) / Math.min(1, k.covered);
      if (value > 0) regionRate.set(id, r.values.taxRevenuePerYear / value);
    }

    scopes.forEach((s, si) => {
      const R = results[si]!;
      // Ridership.
      let daily = 0;
      let annual = 0;
      for (const l of s.lines) {
        let ld = 0;
        for (const id of l.stations) {
          const z = P.zones[zoneIdx.get(id) ?? -1];
          if (!z) continue;
          const k = stationLines.get(id) ?? 1;
          ld += fns.ridership_daily({
            pop: z.pop / k,
            jobs: z.jobs / k,
            students: z.students / k,
            resident_share: p("benefit.ridership.resident_share", l.mode),
            trips_per_user: p("benefit.ridership.trips_per_user", l.mode),
          });
        }
        daily += ld;
        annual += fns.ridership_annual({
          daily: ld,
          days_per_year: p("benefit.ridership.days_per_year", l.mode),
        });
      }
      R.ridership_daily.push(daily);
      R.ridership_annual.push(annual);
      // GDP growth and earnings, over every zone.
      let gdp = 0;
      let earn = 0;
      P.zones.forEach((z, i) => {
        const b = s.before[i]!;
        const a = all[i]!;
        if (z.jobs > 0 && b.ed > 0 && a.ed > 0)
          gdp += fns.gdp({
            gdp: z.jobs * z.gdpPerWorker,
            ed_before: b.ed,
            ed_after: a.ed,
            elasticity: p("benefit.elasticity_agglomeration"),
          });
        if (z.workers > 0 && b.expJobs > 0 && a.expJobs > 0)
          earn += fns.earnings({
            workers: z.workers,
            wage: z.gdpPerWorker * labour,
            access_before: b.expJobs,
            access_after: a.expJobs,
            elasticity: p("benefit.elasticity_job_access"),
          });
      });
      R.gdp.push(gdp);
      R.earnings.push(earn);
      // Land value and property tax.
      let land = 0;
      let tax = 0;
      for (const { b, mode, d: dist, r } of near[si]!) {
        const w = decay(dist, r, inner);
        for (const homes of [true, false]) {
          const share = homes ? b.homes : 1 - b.homes;
          if (share <= 0) continue;
          const vars: Vars = {
            floor_area: b.floor * share,
            value_per_m2: valuePerM2(b, homes),
            uplift: p(upKey(homes), mode),
            decay: w,
            distance: dist,
          };
          const up = fns.land_value(vars);
          land += up;
          tax += fns.property_tax({
            uplift_value: up,
            tax_rate: (b.region && regionRate.get(b.region.id)) ?? taxRate,
          });
        }
      }
      R.land_value.push(land);
      R.property_tax.push(tax);
      // Stimulated economy.
      let cg = 0;
      let og = 0;
      for (const key of s.spendKeys) {
        const sp = input.spending.get(key);
        if (!sp) continue;
        cg += fns.construction_gdp({
          civil: cost(sp.civil),
          systems: cost(sp.systems),
          vehicles: cost(sp.vehicles),
          domestic_civil: p("benefit.domestic_share.civil"),
          domestic_systems: p("benefit.domestic_share.systems"),
          domestic_vehicles: p("benefit.domestic_share.vehicles"),
          multiplier: p("benefit.va_multiplier.construction"),
        });
        og += fns.operation_gdp({
          operating: cost(sp.operating),
          domestic_operating: p("benefit.domestic_share.operating"),
          multiplier: p("benefit.va_multiplier.operation"),
        });
      }
      R.construction_gdp.push(cg);
      R.operation_gdp.push(og);
      const gpw = nationalGdpPerWorker;
      R.construction_jobs.push(
        gpw > 0
          ? fns.construction_jobs({
              construction_gdp: cg,
              gdp_per_worker: gpw,
              productivity: p("benefit.construction_productivity_ratio"),
            })
          : 0,
      );
      R.operation_jobs.push(gpw > 0 ? fns.operation_jobs({ operation_gdp: og, gdp_per_worker: gpw }) : 0);
    });
  }

  // GDP growth of the lines adds up to the network's: each draw's total is split between the lines by what each
  // adds on its own (the network with and without it), and a mode gets the sum of its lines.
  const totalAt = scopes.findIndex((s) => s.scope === "total");
  const lineAt = scopes.flatMap((s, i) => (s.scope === "line" ? [i] : []));
  if (totalAt >= 0 && lineAt.length)
    for (let d = 0; d < draws; d++) {
      const split = shareOfTotal(
        lineAt.map((i) => results[i]!.gdp[d] ?? 0),
        results[totalAt]!.gdp[d] ?? 0,
      );
      lineAt.forEach((i, k) => (results[i]!.gdp[d] = split[k]!));
      scopes.forEach((s, i) => {
        if (s.scope !== "mode") return;
        results[i]!.gdp[d] = lineAt
          .filter((j) => scopes[j]!.mode === s.mode)
          .reduce((sum, j) => sum + results[j]!.gdp[d]!, 0);
      });
    }

  const rows: Row[] = scopes.map((s, i) => ({
    id: s.id,
    scope: s.scope,
    name: s.name,
    mode: s.mode,
    color: s.color,
    values: Object.fromEntries(
      METRICS.map((m) => [m, results[i]![m].length ? p10p50p90(results[i]![m]) : ZERO]),
    ) as Record<Metric, Triple>,
    access: accessRow(s),
  }));
  if (!nationalGdpPerWorker) notes.push({ key: "ben.note.noJobYears" });
  const stationName = new Map(P.net.stations.map((s) => [s.id, s.name]));
  const stations: Estimate["stations"] = {};
  for (const l of lines) {
    const out: Record<string, number> = {};
    for (const id of l.stations) {
      const z = P.zones[zoneIdx.get(id) ?? -1];
      if (!z) continue;
      const k = stationLines.get(id) ?? 1;
      const v = fns.ridership_daily({
        pop: z.pop / k,
        jobs: z.jobs / k,
        students: z.students / k,
        resident_share: central("benefit.ridership.resident_share", l.mode, prefs),
        trips_per_user: central("benefit.ridership.trips_per_user", l.mode, prefs),
      });
      const name = stationName.get(id) ?? id;
      if (Number.isFinite(v)) out[name] = (out[name] ?? 0) + Math.max(0, v);
    }
    stations[l.id] = out;
  }
  return { rows, notes, draws, stations };
}

/** Purpose: the formula definition of a metric (for labels and units). */
export const metricDef = (m: Metric) => FORMULA_BY_ID[m];

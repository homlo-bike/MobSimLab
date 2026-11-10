/**
 * The construction and operating cost estimate of a project (ADR-0039, 09-planning-models §3.1):
 * quantities from the railway design and the street lines, times unit costs from the assumption library
 * (low, central, high), converted to the project's country and today's prices.
 */
import { lineMode, trainById } from "../railways/serviceLines";
import type { Level, LineReport, Network, RailMode, RailView, Track } from "../railways/types";
import type { SavedStreetLine } from "../street-lines/saved";
import { lineStats } from "../street-lines/summary";
import type { Prices } from "./economy";
import { paramValue, type Triple } from "./params";

/** Kinds of construction cost; the first seven are the alignment by construction type. */
export type Category =
  | "at_grade"
  | "elevated"
  | "viaduct"
  | "bridge"
  | "ramp"
  | "cut_and_cover"
  | "tbm"
  | "systems"
  | "switches"
  | "stations"
  | "street_works"
  | "depots"
  | "vehicles"
  | "engineering"
  | "contingency"
  | "service"
  | "maintenance"
  | "overheads";

export const CATEGORY_LABEL: Record<Category, string> = {
  at_grade: "Track at street level",
  elevated: "Elevated guideway",
  viaduct: "Viaduct",
  bridge: "Bridge",
  ramp: "Ramp between levels",
  cut_and_cover: "Tunnel, cut and cover",
  tbm: "Tunnel, bored (TBM)",
  systems: "Track, power and signalling",
  switches: "Switches and crossings",
  stations: "Stations and stops",
  street_works: "Bus lanes and trolley wires",
  depots: "Depots",
  vehicles: "Vehicles",
  engineering: "Design and management",
  contingency: "Contingency",
  service: "Running the service",
  maintenance: "Infrastructure upkeep",
  overheads: "Administration and overheads",
};

/** Construction categories in table order. */
export const CONSTRUCTION: Category[] = [
  "at_grade",
  "elevated",
  "viaduct",
  "bridge",
  "ramp",
  "cut_and_cover",
  "tbm",
  "systems",
  "switches",
  "stations",
  "street_works",
  "depots",
  "vehicles",
  "engineering",
  "contingency",
];
export const OPERATING: Category[] = ["service", "maintenance", "overheads"];

/** Construction structures of a track stretch. */
export type StructureCategory =
  "at_grade" | "elevated" | "viaduct" | "bridge" | "ramp" | "cut_and_cover" | "tbm";

/** One line of the estimate. Money is in the project's currency, today's prices. */
export interface CostItem {
  category: Category;
  /** Rail mode or street mode. */
  mode: string;
  /** Line id ("rail:<id>", "street:<index>") when the item belongs to one line, else null (shared). */
  line: string | null;
  label: string;
  quantity: number;
  unit: string;
  /** Unit cost in the project's currency, low/central/high. */
  rate: Triple;
  amount: Triple;
  /** Assumption the rate comes from. */
  param: string | null;
}

/** A line of the project with what it runs. */
export interface LineSummary {
  id: string;
  name: string;
  mode: string;
  color: string;
  lengthKm: number;
  /** Vehicles or trains in service at the peak, without reserves. */
  inService: number;
  /** Fleet with reserves (units for rail: trains × units coupled). */
  fleet: number;
  /** Vehicle- or train-hours and km per year. */
  hoursPerYear: number;
  kmPerYear: number;
}

export interface Estimate {
  items: CostItem[];
  lines: LineSummary[];
  /** Modes in the order they first appear. */
  modes: string[];
  /** Notes on what was left out or assumed. */
  notes: string[];
}

export interface EstimateInput {
  railway: Network | null;
  /** The design as the rail engine built it. */
  view: RailView | null;
  /** What publishing the service lines found, by line id; absent lines have no fleet or service. */
  reports: Record<string, LineReport>;
  streetLines: SavedStreetLine[];
  prefs: Record<string, number> | undefined;
  prices: Prices;
}

const URBAN: RailMode[] = ["tram", "light_rail", "metro"];
const STREET_COLOR: Record<string, string> = {
  bus: "#d2392c",
  brt: "#a3358c",
  trolleybus: "#1e8a4f",
  intercity_bus: "#cf7f00",
};
/** Car length the per-car-km running cost refers to, m. */
export const CAR_M = 25;

const mul = (a: Triple, k: number): Triple => [a[0] * k, a[1] * k, a[2] * k];
const prod = (a: Triple, b: Triple): Triple => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const sum = (xs: Triple[]): Triple =>
  xs.reduce<Triple>((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2]], [0, 0, 0]);

/**
 * Purpose: what a stretch of track at a level is built as: the track's choice in the railway editor, else
 * cut and cover on the first underground level and TBM on the second, an elevated guideway for tram,
 * light rail and metro and a viaduct for main lines.
 */
export function structureOf(
  level: Level | "ramp",
  track: Pick<Track, "tunnel" | "structure">,
  mode: RailMode,
): StructureCategory {
  if (level === "ramp") return "ramp";
  if (level === "street") return "at_grade";
  if (level === "underground" || level === "underground2") {
    if (track.tunnel === "cut_and_cover" || track.tunnel === "tbm") return track.tunnel;
    return level === "underground2" ? "tbm" : "cut_and_cover";
  }
  if (track.structure && track.structure !== "auto") return track.structure;
  return URBAN.includes(mode) ? "elevated" : "viaduct";
}

const CIVIL_PARAM: Record<StructureCategory, string> = {
  at_grade: "cost.civil.at_grade_per_km",
  elevated: "cost.civil.elevated_per_km",
  viaduct: "cost.civil.viaduct_per_km",
  bridge: "cost.civil.bridge_per_km",
  ramp: "cost.civil.ramp_per_km",
  cut_and_cover: "cost.civil.cut_and_cover_per_km",
  tbm: "cost.civil.tbm_per_km",
};

const STATION_PARAM: Record<Level, string> = {
  street: "cost.station.at_grade",
  elevated: "cost.station.elevated",
  elevated2: "cost.station.elevated",
  underground: "cost.station.underground",
  underground2: "cost.station.underground_deep",
};

const STATION_LABEL: Record<Level, string> = {
  street: "at street level",
  elevated: "elevated",
  elevated2: "elevated",
  underground: "underground",
  underground2: "underground, deep",
};

/** Purpose: great-circle distance in km. */
export function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * r) / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Purpose: the cost estimate of the project.
 * Inputs: the railway design and its build, the publication reports of its service lines, the street
 * lines, the project's own values and the price conversion.
 * Output: every cost item with low, central and high amounts, the lines, and notes.
 */
export function estimate(input: EstimateInput): Estimate {
  const { railway, view, reports, streetLines, prefs, prices } = input;
  const items: CostItem[] = [];
  const lines: LineSummary[] = [];
  const notes: string[] = [];
  // Unit costs: millions of base-year dollars to the project's currency today.
  const ppp = prices.ppp * prices.escalation;
  const market = prices.fx * prices.escalation;
  const v = (key: string, mode: string) => paramValue(key, mode, prefs);
  const add = (
    category: Category,
    mode: string,
    line: string | null,
    label: string,
    quantity: number,
    unit: string,
    param: string | null,
    rate: Triple,
  ) => {
    if (!(quantity > 0)) return;
    items.push({ category, mode, line, label, quantity, unit, rate, amount: mul(rate, quantity), param });
  };
  const days = v("cost.days_per_year", "*");

  // Railway infrastructure.
  if (railway && view) {
    const single = v("cost.single_track_share", "*");
    for (const tv of view.tracks) {
      const doc = railway.tracks.find((t) => t.id === tv.id);
      if (!doc) continue;
      const mode = tv.mode;
      const factor: Triple = tv.tracks === 2 ? [1, 1, 1] : single;
      const name = doc.name || `Track ${doc.id}`;
      const what = `${name}, ${tv.tracks === 2 ? "double" : "single"} track`;
      const byStructure = new Map<StructureCategory, number>();
      for (const z of tv.levels) {
        const s = structureOf(z.level, doc, mode);
        byStructure.set(s, (byStructure.get(s) ?? 0) + Math.max(0, z.to_m - z.from_m) / 1000);
      }
      if (!tv.levels.length) byStructure.set(structureOf(doc.level, doc, mode), tv.length_m / 1000);
      for (const [s, lenKm] of byStructure) {
        const p = CIVIL_PARAM[s];
        add(s, mode, null, what, lenKm, "km", p, mul(prod(v(p, mode), factor), ppp * 1e6));
      }
      add(
        "systems",
        mode,
        null,
        what,
        tv.length_m / 1000,
        "km",
        "cost.systems_per_km",
        mul(prod(v("cost.systems_per_km", mode), factor), ppp * 1e6),
      );
    }
    const switchesByMode = new Map<string, number>();
    for (const sw of view.switches) {
      const mode = view.tracks.find((t) => t.id === sw.track)?.mode ?? railway.mode;
      switchesByMode.set(mode, (switchesByMode.get(mode) ?? 0) + 1);
    }
    for (const [mode, n] of switchesByMode)
      add(
        "switches",
        mode,
        null,
        "Switches and crossings",
        n,
        "each",
        "cost.switch_each",
        mul(v("cost.switch_each", mode), ppp * 1e6),
      );
    const stationsBy = new Map<string, { mode: string; level: Level; n: number }>();
    for (const sv of view.stations) {
      const st = railway.stations.find((s) => s.id === sv.id);
      const level = st?.level ?? "street";
      const key = `${sv.mode}|${level}`;
      const e = stationsBy.get(key) ?? { mode: sv.mode, level, n: 0 };
      e.n += 1;
      stationsBy.set(key, e);
    }
    for (const e of stationsBy.values()) {
      const p = STATION_PARAM[e.level];
      add(
        "stations",
        e.mode,
        null,
        `Stations ${STATION_LABEL[e.level]}`,
        e.n,
        "each",
        p,
        mul(v(p, e.mode), ppp * 1e6),
      );
    }
  }

  // Rail service lines: fleet, depots and service.
  if (railway && view) {
    const pos = new Map(view.stations.map((s) => [s.id, s.lonlat] as const));
    for (const l of railway.lines ?? []) {
      const r = reports[l.id];
      const train = trainById(l.vehicle);
      const mode = lineMode(railway, l);
      const stops = l.stations.map((id) => pos.get(id)).filter((p): p is [number, number] => !!p);
      let lengthKm = 0;
      for (let i = 1; i < stops.length; i++) lengthKm += km(stops[i - 1]!, stops[i]!);
      const id = `rail:${l.id}`;
      const name = l.name || l.id;
      if (!r || !train || r.trains === 0) {
        const why = r?.issues[0] ?? "the line could not be published.";
        notes.push(`${name}: no trains, depot or service costed yet: ${why}`);
        lines.push({
          id,
          name,
          mode,
          color: l.color,
          lengthKm,
          inService: 0,
          fleet: 0,
          hoursPerYear: 0,
          kmPerYear: 0,
        });
        continue;
      }
      const units = Math.max(1, Math.round(l.units));
      const trainM = train.length_m * units;
      const spare = v("mode.spare_share", mode);
      const fleet: Triple = [
        r.trains * (1 + spare[0]),
        r.trains * (1 + spare[1]),
        r.trains * (1 + spare[2]),
      ].map(Math.ceil) as Triple;
      const runS = ((r.outbound_s ?? 0) + (r.return_s ?? r.outbound_s ?? 0)) / 2;
      const trainHours: Triple = mul(days, (r.trips * runS) / 3600);
      const trainKm: Triple = mul(days, r.trips * lengthKm);
      lines.push({
        id,
        name,
        mode,
        color: l.color,
        lengthKm,
        inService: r.trains,
        fleet: fleet[1] * units,
        hoursPerYear: trainHours[1],
        kmPerYear: trainKm[1],
      });
      const vehicleRate = mul(v("cost.vehicle_per_train_m", mode), market * 1e6 * trainM);
      items.push({
        category: "vehicles",
        mode,
        line: id,
        label: `${train.name} × ${units}, ${trainM.toFixed(0)} m trains`,
        quantity: fleet[1],
        unit: "trains",
        rate: vehicleRate,
        amount: prod(vehicleRate, fleet),
        param: "cost.vehicle_per_train_m",
      });
      const depotRate = mul(v("cost.depot_per_train_m", mode), ppp * 1e6 * trainM);
      items.push({
        category: "depots",
        mode,
        line: id,
        label: "Depot and stabling for the fleet",
        quantity: fleet[1],
        unit: "trains",
        rate: depotRate,
        amount: prod(depotRate, fleet),
        param: "cost.depot_per_train_m",
      });
      const hourRate = mul(v("cost.opex.train_hour", mode), ppp);
      items.push({
        category: "service",
        mode,
        line: id,
        label: "Crew, per train-hour",
        quantity: trainHours[1],
        unit: "train-h / year",
        rate: hourRate,
        amount: prod(hourRate, trainHours),
        param: "cost.opex.train_hour",
      });
      const carKmRate = mul(v("cost.opex.car_km", mode), ppp);
      const cars = trainM / CAR_M;
      items.push({
        category: "service",
        mode,
        line: id,
        label: `Energy and vehicle upkeep, ${cars.toFixed(1)} cars of ${CAR_M} m`,
        quantity: trainKm[1] * cars,
        unit: "car-km / year",
        rate: carKmRate,
        amount: prod(carKmRate, mul(trainKm, cars)),
        param: "cost.opex.car_km",
      });
    }
  }

  // Street lines.
  streetLines.forEach((l, i) => {
    if (l.view.points.length < 2) return;
    const mode = l.profile.mode;
    const id = `street:${i}`;
    const name = l.name || `Street line ${i + 1}`;
    const stats = lineStats(l.view, l.timing);
    const routeKm = l.view.length_m / 2000;
    const spare = v("mode.spare_share", mode);
    const fleet = spare.map((s) => Math.ceil(stats.vehicles * (1 + s))) as Triple;
    const serviceHours = v("cost.service_hours_per_day", mode);
    const vehHours = prod(mul(serviceHours, stats.vehicles), days);
    const kmh = stats.cycleMin > 0 ? l.view.length_m / 1000 / (stats.cycleMin / 60) : 0;
    lines.push({
      id,
      name,
      mode,
      color: STREET_COLOR[mode] ?? "#d2392c",
      lengthKm: routeKm,
      inService: stats.vehicles,
      fleet: fleet[1],
      hoursPerYear: vehHours[1],
      kmPerYear: vehHours[1] * kmh,
    });
    add(
      "stations",
      mode,
      id,
      "Stops",
      stats.stops,
      "each",
      "cost.street.stop_each",
      mul(v("cost.street.stop_each", mode), ppp * 1e6),
    );
    const laneKm = (l.view.bus_lane_m ?? 0) / 1000;
    add(
      "street_works",
      mode,
      id,
      mode === "brt" ? "Busway the line uses" : "Bus lanes the line uses",
      laneKm,
      "lane-km",
      "cost.street.bus_lane_per_km",
      mul(v("cost.street.bus_lane_per_km", mode), ppp * 1e6),
    );
    if (mode === "trolleybus")
      add(
        "street_works",
        mode,
        id,
        "Trolley wires",
        routeKm,
        "route-km",
        "cost.street.trolley_wire_per_km",
        mul(v("cost.street.trolley_wire_per_km", mode), ppp * 1e6),
      );
    const vehicleRate = mul(v("cost.vehicle_each", mode), market * 1e6);
    items.push({
      category: "vehicles",
      mode,
      line: id,
      label: "Vehicles with reserves",
      quantity: fleet[1],
      unit: "vehicles",
      rate: vehicleRate,
      amount: prod(vehicleRate, fleet),
      param: "cost.vehicle_each",
    });
    const depotRate = mul(v("cost.depot_per_bus", mode), ppp * 1e6);
    items.push({
      category: "depots",
      mode,
      line: id,
      label: "Depot places",
      quantity: fleet[1],
      unit: "vehicles",
      rate: depotRate,
      amount: prod(depotRate, fleet),
      param: "cost.depot_per_bus",
    });
    const hourRate = mul(v("cost.opex.vehicle_hour", mode), ppp);
    items.push({
      category: "service",
      mode,
      line: id,
      label: `${stats.vehicles} vehicles in service, ${serviceHours[1]} h a day`,
      quantity: vehHours[1],
      unit: "vehicle-h / year",
      rate: hourRate,
      amount: prod(hourRate, vehHours),
      param: "cost.opex.vehicle_hour",
    });
  });

  // Shares per mode: design and contingency on the infrastructure, upkeep and overheads a year.
  const modes = [...new Set([...items.map((x) => x.mode), ...lines.map((l) => l.mode)])];
  const eng = v("cost.engineering_share", "*");
  const cont = v("cost.contingency_share", "*");
  const upkeep = v("cost.opex.infrastructure_share", "*");
  const overhead = v("cost.opex.overhead_share", "*");
  const INFRA = new Set<Category>([
    "at_grade",
    "elevated",
    "viaduct",
    "bridge",
    "ramp",
    "cut_and_cover",
    "tbm",
    "systems",
    "switches",
    "stations",
    "street_works",
    "depots",
  ]);
  for (const mode of modes) {
    // Per line where the infrastructure is the line's own (street lines), else for the mode.
    const groups = new Map<string | null, CostItem[]>();
    for (const x of items)
      if (x.mode === mode && INFRA.has(x.category)) {
        const g = x.line?.startsWith("street:") ? x.line : null;
        groups.set(g, [...(groups.get(g) ?? []), x]);
      }
    for (const [line, xs] of groups) {
      const base = sum(xs.map((x) => x.amount));
      const pct = (s: Triple) => s.map((p) => Math.round(p * 1000) / 10).join("–");
      items.push({
        category: "engineering",
        mode,
        line,
        label: `${pct(eng)} % of the infrastructure`,
        quantity: 1,
        unit: "",
        rate: prod(base, eng),
        amount: prod(base, eng),
        param: "cost.engineering_share",
      });
      items.push({
        category: "contingency",
        mode,
        line,
        label: `${pct(cont)} % of the infrastructure`,
        quantity: 1,
        unit: "",
        rate: prod(base, cont),
        amount: prod(base, cont),
        param: "cost.contingency_share",
      });
      items.push({
        category: "maintenance",
        mode,
        line,
        label: `${pct(upkeep)} % of the infrastructure a year`,
        quantity: 1,
        unit: "",
        rate: prod(base, upkeep),
        amount: prod(base, upkeep),
        param: "cost.opex.infrastructure_share",
      });
    }
    const running = sum(
      items
        .filter((x) => x.mode === mode && (x.category === "service" || x.category === "maintenance"))
        .map((x) => x.amount),
    );
    if (running[2] > 0)
      items.push({
        category: "overheads",
        mode,
        line: null,
        label: "Share of the operating cost",
        quantity: 1,
        unit: "",
        rate: prod(running, overhead),
        amount: prod(running, overhead),
        param: "cost.opex.overhead_share",
      });
  }
  if (railway && view && !(railway.lines ?? []).length && view.tracks.length)
    notes.push("The railway has no service lines yet, so it has no fleet, depot or service costs.");
  return { items, lines, modes, notes };
}

/** Purpose: whether a category is a construction (one-off) cost; the others are operating costs a year. */
export function isConstruction(c: Category): boolean {
  return CONSTRUCTION.includes(c);
}

/**
 * Purpose: totals per line. Items of one line count for it; infrastructure shared by the lines of a mode
 * (and a mode's overheads) is split between its lines by vehicle- or train-km; a mode without lines keeps
 * its share unassigned.
 * Output: by line id ("" for unassigned per mode, keyed `:<mode>`), construction and operating a year.
 */
export function perLine(e: Estimate): Map<string, { construction: Triple; operating: Triple }> {
  const out = new Map<string, { construction: Triple; operating: Triple }>();
  const bump = (id: string, x: CostItem, share: number) => {
    const row = out.get(id) ?? { construction: [0, 0, 0] as Triple, operating: [0, 0, 0] as Triple };
    const a = mul(x.amount, share);
    if (isConstruction(x.category)) row.construction = sum([row.construction, a]);
    else row.operating = sum([row.operating, a]);
    out.set(id, row);
  };
  for (const x of e.items) {
    if (x.line) {
      bump(x.line, x, 1);
      continue;
    }
    const users = e.lines.filter((l) => l.mode === x.mode && l.kmPerYear > 0);
    const total = users.reduce((s, l) => s + l.kmPerYear, 0);
    if (!total) {
      bump(`:${x.mode}`, x, 1);
      continue;
    }
    for (const l of users) bump(l.id, x, l.kmPerYear / total);
  }
  return out;
}

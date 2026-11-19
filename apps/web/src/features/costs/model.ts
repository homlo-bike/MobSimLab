/**
 * The construction and operating cost estimate of a project (ADR-0039, 09-planning-models §3.1):
 * quantities from the railway design and the street lines, times unit costs from the assumption library
 * (low, central, high), converted to the project's country and today's prices.
 */
import { hhmm, lineMode, trainById } from "../railways/serviceLines";
import type { Level, LineReport, Network, RailMode, RailView, Track } from "../railways/types";
import { lineInput, type SavedStreetLine } from "../street-lines/saved";
import { streetBlocks } from "../timetables/blocks";
import { fullTiming } from "../street-lines/modes";
import { dayService } from "../street-lines/service";
import { lineStats } from "../street-lines/summary";
import type { Prices } from "./economy";
import { paramValue, prefId, type Triple } from "./params";
import { type Translate, translate } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { distanceKm } from "../../map/geo";
import { activePlugins } from "../../plugins/registry";
import type { FerryLine } from "../tables/ferries";
import { ropewayParam, type RopewayLine } from "../tables/ropeways";

/** Kinds of construction cost; the first seven are the alignment by construction type. */
export type Category =
  | "at_grade"
  | "elevated"
  | "viaduct"
  | "bridge"
  | "ramp"
  | "cutting"
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

/** Message key of each category's name. */
export const CATEGORY_LABEL: Record<Category, MessageKey> = {
  at_grade: "cost.cat.at_grade",
  elevated: "cost.cat.elevated",
  viaduct: "cost.cat.viaduct",
  bridge: "cost.cat.bridge",
  ramp: "cost.cat.ramp",
  cutting: "cost.cat.cutting",
  cut_and_cover: "cost.cat.cut_and_cover",
  tbm: "cost.cat.tbm",
  systems: "cost.cat.systems",
  switches: "cost.cat.switches",
  stations: "cost.cat.stations",
  street_works: "cost.cat.street_works",
  depots: "cost.cat.depots",
  vehicles: "cost.cat.vehicles",
  engineering: "cost.cat.engineering",
  contingency: "cost.cat.contingency",
  service: "cost.cat.service",
  maintenance: "cost.cat.maintenance",
  overheads: "cost.cat.overheads",
};

/** Construction categories in table order. */
export const CONSTRUCTION: Category[] = [
  "at_grade",
  "elevated",
  "viaduct",
  "bridge",
  "ramp",
  "cutting",
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
  "at_grade" | "elevated" | "viaduct" | "bridge" | "ramp" | "cutting" | "cut_and_cover" | "tbm";

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
  /**
   * A parameter from a plugin's assumptions rather than the cost library: its name, unit and the plugin's
   * low, central and high values (before the project's own value), for the table of unit costs.
   */
  library?: { label: string; unit: string; values: Triple };
  /**
   * Shared items (`line` null) only: which lines run on which part of the quantity, such as a track's
   * kilometres or one station of a station count. A part no line runs through, and an item without parts, is
   * shared by all of its mode's lines.
   */
  parts?: { quantity: number; lines: string[] }[];
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
  /** The cable car lines of the plugin tools, with their service. */
  ropeways?: readonly RopewayLine[];
  /** The ferry lines of the plugin tools, with their service. */
  ferries?: readonly FerryLine[];
  /** Translates the labels and notes; English when absent. */
  t?: Translate;
}

const URBAN: RailMode[] = ["tram", "light_rail", "metro"];
const STREET_COLOR: Record<string, string> = {
  bus: "#d2392c",
  brt: "#a3358c",
  trolleybus: "#1e8a4f",
  intercity_bus: "#cf7f00",
};

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
  if (level === "cutting") return "cutting";
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
  cutting: "cost.civil.cutting_per_km",
  cut_and_cover: "cost.civil.cut_and_cover_per_km",
  tbm: "cost.civil.tbm_per_km",
};

/** Refurbishing an existing tunnel, bridge or viaduct a track re-uses, per route-km. */
const REFURBISH_STRUCTURE = "cost.civil.refurbish_structure_per_km";
/** Refurbishing and fitting out an existing station structure, per station. */
const REFURBISH_STATION = "cost.station.refurbish";

const STATION_PARAM: Record<Level, string> = {
  street: "cost.station.at_grade",
  elevated: "cost.station.elevated",
  elevated2: "cost.station.elevated",
  underground: "cost.station.underground",
  underground2: "cost.station.underground_deep",
  cutting: "cost.station.cutting",
};

const STATION_LABEL: Record<Level, MessageKey> = {
  street: "cost.x.stations.street",
  elevated: "cost.x.stations.elevated",
  elevated2: "cost.x.stations.elevated",
  underground: "cost.x.stations.underground",
  underground2: "cost.x.stations.underground2",
  cutting: "cost.x.stations.cutting",
};

/**
 * Purpose: the cost estimate of the project.
 * Inputs: the railway design and its build, the publication reports of its service lines, the street
 * lines, the project's own values and the price conversion.
 * Output: every cost item with low, central and high amounts, the lines, and notes.
 */
/**
 * Purpose: the tracks each rail service line runs on: between each pair of its stations, the shortest way
 * through the drawing's tracks, stations and switches (a switch joins the track it sits on to the tracks
 * drawn from its legs).
 * Inputs: the railway drawing and the engine's view (track lengths). Output: line id ("rail:<id>") → track ids.
 */
export function lineTracks(railway: Network, view: RailView): Map<string, Set<number>> {
  const lengthOf = new Map(view.tracks.map((tv) => [tv.id, tv.length_m] as const));
  type Edge = { to: string; m: number; track: number };
  const graph = new Map<string, Edge[]>();
  const join = (a: string, b: string, m: number, track: number) => {
    if (a === b) return;
    graph.set(a, [...(graph.get(a) ?? []), { to: b, m, track }]);
    graph.set(b, [...(graph.get(b) ?? []), { to: a, m, track }]);
  };
  const node = (a: Network["tracks"][number]["start"] | null, track: number, end: number) =>
    a?.type === "station"
      ? `st:${a.station}`
      : a?.type === "switch"
        ? `sw:${a.switch}`
        : `free:${track}:${end}`;
  for (const tr of railway.tracks) {
    const len = lengthOf.get(tr.id) ?? 0;
    // The track's ends and the switches standing on it, in order along it.
    const stops = [
      { at: node(tr.start, tr.id, 0), s: 0 },
      ...railway.switches.filter((sw) => sw.track === tr.id).map((sw) => ({ at: `sw:${sw.id}`, s: sw.s })),
      { at: node(tr.end, tr.id, 1), s: len },
    ].sort((a, b) => a.s - b.s);
    for (let i = 1; i < stops.length; i++)
      join(stops[i - 1]!.at, stops[i]!.at, Math.max(0, stops[i]!.s - stops[i - 1]!.s), tr.id);
  }
  const path = (from: string, to: string): number[] => {
    const dist = new Map<string, number>([[from, 0]]);
    const via = new Map<string, Edge & { from: string }>();
    const open = new Set([from]);
    while (open.size) {
      let cur = "";
      for (const n of open) if (!cur || dist.get(n)! < dist.get(cur)!) cur = n;
      open.delete(cur);
      if (cur === to) break;
      for (const e of graph.get(cur) ?? []) {
        const d = dist.get(cur)! + e.m;
        if (d < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, d);
          via.set(e.to, { ...e, from: cur });
          open.add(e.to);
        }
      }
    }
    const out: number[] = [];
    for (let n = to; via.has(n); n = via.get(n)!.from) out.push(via.get(n)!.track);
    return out;
  };
  const out = new Map<string, Set<number>>();
  for (const l of railway.lines ?? []) {
    const used = new Set<number>();
    for (let i = 1; i < l.stations.length; i++)
      for (const t of path(`st:${l.stations[i - 1]}`, `st:${l.stations[i]}`)) used.add(t);
    out.set(`rail:${l.id}`, used);
  }
  return out;
}

/**
 * Purpose: a street line's vehicles in service on a weekday: its vehicle blocks, chained as in the Timetables
 * tab (layover at each end, depot runs when the line has a depot).
 * Output: the number of blocks, or null when the line has no timetable (then the circuit time over the headway
 * stands in).
 */
function streetVehicles(l: SavedStreetLine, layoverMin: number, maxWaitMin: number): number | null {
  const input = lineInput(l);
  // A route saved before directions were kept has no timetable to chain.
  if (!input || !Array.isArray(l.view.directions)) return null;
  const blocks = streetBlocks({ line: input, layoverMin, hasDepot: !!(l.depotId || l.depot), maxWaitMin });
  return blocks.length ? blocks.length : null;
}

/**
 * Purpose: the hours each line's vehicles run on a weekday, worked out as the estimate does but without the
 * prices, so the calendar runs can count heating and air conditioning before the Tables tab has been opened.
 * Inputs: the railway (its service lines), their weekday publication reports, the street lines and the
 * project's values. Output: one entry per line with a service: its mode and vehicle-hours (trains for rail).
 */
export function weekdayServiceHours(
  railway: Network | null,
  reports: readonly LineReport[],
  streetLines: readonly SavedStreetLine[],
  prefs: Record<string, number> | undefined,
): { mode: string; hours: number }[] {
  const out: { mode: string; hours: number }[] = [];
  const byId = new Map(reports.map((r) => [r.id, r] as const));
  for (const l of railway?.lines ?? []) {
    const r = byId.get(l.id);
    if (!r || !trainById(l.vehicle) || r.trains === 0) continue;
    const runS = ((r.outbound_s ?? 0) + (r.return_s ?? r.outbound_s ?? 0)) / 2;
    out.push({ mode: lineMode(railway!, l), hours: (r.trips * runS) / 3600 });
  }
  for (const l of streetLines) {
    if (l.view.points.length < 2) continue;
    const timing = fullTiming(l.timing);
    const stats = lineStats(l.view, timing);
    const vehicles =
      streetVehicles(l, timing.layoverMin, paramValue("timetable.max_terminal_wait_min", "*", prefs)[1]) ??
      stats.vehicles;
    if (vehicles > 0)
      out.push({ mode: l.profile.mode, hours: dayService(timing, stats.cycleMin).vehicleHours });
  }
  return out;
}

export function estimate(input: EstimateInput): Estimate {
  const { railway, view, reports, streetLines, prefs, prices } = input;
  const t: Translate = input.t ?? ((key, vars) => translate("en", key, vars));
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
    parts?: CostItem["parts"],
  ) => {
    if (!(quantity > 0)) return;
    items.push({
      category,
      mode,
      line,
      label,
      quantity,
      unit,
      rate,
      amount: mul(rate, quantity),
      param,
      ...(parts && { parts }),
    });
  };
  const days = v("cost.days_per_year", "*");

  // Railway infrastructure.
  const tracksOf = railway && view ? lineTracks(railway, view) : new Map<string, Set<number>>();
  /** The rail service lines that run on a track. */
  const trackUsers = (id: number) => [...tracksOf].filter(([, ts]) => ts.has(id)).map(([l]) => l);
  if (railway && view) {
    const single = v("cost.single_track_share", "*");
    for (const tv of view.tracks) {
      const doc = railway.tracks.find((t) => t.id === tv.id);
      if (!doc) continue;
      const mode = tv.mode;
      const factor: Triple = tv.tracks === 2 ? [1, 1, 1] : single;
      const name = doc.name || t("tbl.trackName", { id: doc.id });
      const what = t("cost.x.track", {
        name,
        kind: t(tv.tracks === 2 ? "cost.x.double" : "cost.x.single"),
      });
      const byStructure = new Map<StructureCategory, number>();
      for (const z of tv.levels) {
        const s = structureOf(z.level, doc, mode);
        byStructure.set(s, (byStructure.get(s) ?? 0) + Math.max(0, z.to_m - z.from_m) / 1000);
      }
      if (!tv.levels.length) byStructure.set(structureOf(doc.level, doc, mode), tv.length_m / 1000);
      // A track through an existing tunnel, bridge or viaduct pays for refurbishing it, not for a new one.
      const reused = t("cost.x.refurbished", { what });
      for (const [s, lenKm] of byStructure) {
        const p = doc.existing && s !== "at_grade" ? REFURBISH_STRUCTURE : CIVIL_PARAM[s];
        add(
          s,
          mode,
          null,
          p === REFURBISH_STRUCTURE ? reused : what,
          lenKm,
          t("cost.unit.km"),
          p,
          mul(prod(v(p, mode), factor), ppp * 1e6),
          [{ quantity: lenKm, lines: trackUsers(tv.id) }],
        );
      }
      add(
        "systems",
        mode,
        null,
        what,
        tv.length_m / 1000,
        t("cost.unit.km"),
        "cost.systems_per_km",
        mul(prod(v("cost.systems_per_km", mode), factor), ppp * 1e6),
        [{ quantity: tv.length_m / 1000, lines: trackUsers(tv.id) }],
      );
    }
    const switchesByMode = new Map<string, { n: number; parts: { quantity: number; lines: string[] }[] }>();
    for (const sw of view.switches) {
      const mode = view.tracks.find((t) => t.id === sw.track)?.mode ?? railway.mode;
      const e = switchesByMode.get(mode) ?? { n: 0, parts: [] };
      e.n += 1;
      e.parts.push({ quantity: 1, lines: trackUsers(sw.track) });
      switchesByMode.set(mode, e);
    }
    for (const [mode, e] of switchesByMode)
      add(
        "switches",
        mode,
        null,
        t("cost.cat.switches"),
        e.n,
        t("cost.unit.each"),
        "cost.switch_each",
        mul(v("cost.switch_each", mode), ppp * 1e6),
        e.parts,
      );
    const stationsBy = new Map<
      string,
      {
        mode: string;
        level: Level;
        existing: boolean;
        n: number;
        parts: { quantity: number; lines: string[] }[];
      }
    >();
    for (const sv of view.stations) {
      const st = railway.stations.find((s) => s.id === sv.id);
      const level = st?.level ?? "street";
      const existing = !!st?.existing;
      const key = `${sv.mode}|${level}|${existing}`;
      const e = stationsBy.get(key) ?? { mode: sv.mode, level, existing, n: 0, parts: [] };
      e.n += 1;
      e.parts.push({
        quantity: 1,
        lines: (railway.lines ?? []).filter((l) => l.stations.includes(sv.id)).map((l) => `rail:${l.id}`),
      });
      stationsBy.set(key, e);
    }
    for (const e of stationsBy.values()) {
      // A station in an existing structure pays for refurbishing and fitting it out, not for a new one.
      const p = e.existing ? REFURBISH_STATION : STATION_PARAM[e.level];
      const label = t(STATION_LABEL[e.level]);
      add(
        "stations",
        e.mode,
        null,
        e.existing ? t("cost.x.refurbished", { what: label }) : label,
        e.n,
        t("cost.unit.each"),
        p,
        mul(v(p, e.mode), ppp * 1e6),
        e.parts,
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
      for (let i = 1; i < stops.length; i++) lengthKm += distanceKm(stops[i - 1]!, stops[i]!);
      const id = `rail:${l.id}`;
      const name = l.name || l.id;
      if (!r || !train || r.trains === 0) {
        const why = r?.issues[0] ?? t("cost.note.unpublished");
        notes.push(t("cost.note.noTrains", { name, why }));
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
        label: t("cost.x.trains", { train: train.name, units, m: trainM.toFixed(0) }),
        quantity: fleet[1],
        unit: t("cost.unit.trains"),
        rate: vehicleRate,
        amount: prod(vehicleRate, fleet),
        param: "cost.vehicle_per_train_m",
      });
      const depotRate = mul(v("cost.depot_per_train_m", mode), ppp * 1e6 * trainM);
      items.push({
        category: "depots",
        mode,
        line: id,
        label: t("cost.x.depotFleet"),
        quantity: fleet[1],
        unit: t("cost.unit.trains"),
        rate: depotRate,
        amount: prod(depotRate, fleet),
        param: "cost.depot_per_train_m",
      });
      const hourRate = mul(v("cost.opex.train_hour", mode), ppp);
      items.push({
        category: "service",
        mode,
        line: id,
        label: t("cost.x.crew"),
        quantity: trainHours[1],
        unit: t("cost.unit.trainHours"),
        rate: hourRate,
        amount: prod(hourRate, trainHours),
        param: "cost.opex.train_hour",
      });
      const carKmRate = mul(v("cost.opex.car_km", mode), ppp);
      // The per car-km rate is for cars of `cost.opex.car_length_m`; the train's length sets how many.
      const carM = Math.max(1, v("cost.opex.car_length_m", mode)[1]);
      const cars = trainM / carM;
      items.push({
        category: "service",
        mode,
        line: id,
        label: t("cost.x.carKm", { cars: cars.toFixed(1), m: carM }),
        quantity: trainKm[1] * cars,
        unit: t("cost.unit.carKm"),
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
    const name = l.name || t("tbl.streetLineName", { n: i + 1 });
    const timing = fullTiming(l.timing);
    const stats = lineStats(l.view, timing);
    const routeKm = l.view.length_m / 2000;
    const spare = v("mode.spare_share", mode);
    // Vehicles in service: one per vehicle block of the weekday timetable, as the Timetables tab counts them
    // (the circuit time over the headway leaves out the time a vehicle waits for its next departure).
    const vehicles =
      streetVehicles(l, timing.layoverMin, v("timetable.max_terminal_wait_min", "*")[1]) ?? stats.vehicles;
    // A small tolerance keeps 20 × 1.15 at 23, not 24 (as the vehicle blocks' fleet).
    const fleet = spare.map((s) => Math.ceil(vehicles * (1 + s) - 1e-9)) as Triple;
    // Vehicle-hours a weekday from the line's own service day: peak and off-peak headways, first to last.
    const vehHours = mul(days, vehicles > 0 ? dayService(timing, stats.cycleMin).vehicleHours : 0);
    const kmh = stats.cycleMin > 0 ? l.view.length_m / 1000 / (stats.cycleMin / 60) : 0;
    lines.push({
      id,
      name,
      mode,
      color: STREET_COLOR[mode] ?? "#d2392c",
      lengthKm: routeKm,
      inService: vehicles,
      fleet: fleet[1],
      hoursPerYear: vehHours[1],
      kmPerYear: vehHours[1] * kmh,
    });
    add(
      "stations",
      mode,
      id,
      t("tbl.stops"),
      stats.stops,
      t("cost.unit.each"),
      "cost.street.stop_each",
      mul(v("cost.street.stop_each", mode), ppp * 1e6),
    );
    const laneKm = (l.view.bus_lane_m ?? 0) / 1000;
    add(
      "street_works",
      mode,
      id,
      t(mode === "brt" ? "cost.x.busway" : "cost.x.busLanes"),
      laneKm,
      t("cost.unit.laneKm"),
      "cost.street.bus_lane_per_km",
      mul(v("cost.street.bus_lane_per_km", mode), ppp * 1e6),
    );
    if (mode === "trolleybus")
      add(
        "street_works",
        mode,
        id,
        t("cost.x.trolleyWires"),
        routeKm,
        t("cost.unit.routeKm"),
        "cost.street.trolley_wire_per_km",
        mul(v("cost.street.trolley_wire_per_km", mode), ppp * 1e6),
      );
    const vehicleRate = mul(v("cost.vehicle_each", mode), market * 1e6);
    items.push({
      category: "vehicles",
      mode,
      line: id,
      label: t("cost.x.vehicles"),
      quantity: fleet[1],
      unit: t("cost.unit.vehicles"),
      rate: vehicleRate,
      amount: prod(vehicleRate, fleet),
      param: "cost.vehicle_each",
    });
    const depotRate = mul(v("cost.depot_per_bus", mode), ppp * 1e6);
    items.push({
      category: "depots",
      mode,
      line: id,
      label: t("cost.x.depotPlaces"),
      quantity: fleet[1],
      unit: t("cost.unit.vehicles"),
      rate: depotRate,
      amount: prod(depotRate, fleet),
      param: "cost.depot_per_bus",
    });
    const hourRate = mul(v("cost.opex.vehicle_hour", mode), ppp);
    items.push({
      category: "service",
      mode,
      line: id,
      label: t("cost.x.vehicleHours", {
        n: vehicles,
        from: hhmm(timing.firstMin),
        to: hhmm(timing.lastMin),
      }),
      quantity: vehHours[1],
      unit: t("cost.unit.vehicleHours"),
      rate: hourRate,
      amount: prod(hourRate, vehHours),
      param: "cost.opex.vehicle_hour",
    });
  });

  /** A plugin cost parameter for a mode and context, with the project's own value on top; null when unknown. */
  const pluginRate = (
    key: string,
    mode: string,
    context: string,
  ): { rate: Triple; library: CostItem["library"] } | null => {
    const lib = ropewayParam(key, mode, context);
    if (!lib) return null;
    const meta = ropewayParamMeta(key);
    const values: Triple = [lib.low, lib.central, lib.high];
    const own = ownPref(prefs, prefId(key, mode)) ?? ownPref(prefs, prefId(key, "*"));
    const k = own === undefined ? 1 : lib.central !== 0 ? own / lib.central : 1;
    const rate: Triple =
      own !== undefined && lib.central === 0 ? [own, own, own] : (values.map((x) => x * k) as Triple);
    return { rate, library: { label: meta?.label ?? key, unit: meta?.unit ?? "", values } };
  };
  /** Purpose: a cost item of a plugin line (cable car, ferry) priced from a plugin parameter. */
  const pluginItem = (
    line: { id: string; mode: string; context: string },
    category: Category,
    key: string,
    label: string,
    quantity: number,
    unit: string,
    scale: number,
    amountOf: (rate: Triple) => Triple = (rate) => mul(rate, quantity),
  ) => {
    const p = pluginRate(key, line.mode, line.context);
    if (!p || !(quantity > 0)) return;
    const rate = mul(p.rate, scale);
    items.push({
      category,
      mode: line.mode,
      line: line.id,
      label,
      quantity,
      unit,
      rate,
      amount: amountOf(rate),
      param: key,
      library: p.library,
    });
  };

  // Cable cars: stations, rope and towers, cabins and the staff of the stations while the line is open.
  for (const r of input.ropeways ?? []) {
    const mode = r.mode;
    const id = r.id;
    const serviceH = Math.max(0, r.lastS - r.firstS) / 3600;
    const fleet: Triple = [r.fleet, r.fleet, r.fleet];
    lines.push({
      id,
      name: r.name,
      mode,
      color: r.color,
      lengthKm: r.lengthKm,
      inService: r.inService,
      fleet: r.fleet,
      hoursPerYear: days[1] * r.cabinHoursPerDay,
      kmPerYear: days[1] * r.cabinKmPerDay,
    });
    const rope = { id, mode, context: r.system };
    pluginItem(
      rope,
      "stations",
      "ropeway.cost.station_each",
      t("cost.cat.stations"),
      r.stations,
      t("cost.unit.each"),
      ppp * 1e6,
    );
    pluginItem(
      rope,
      "systems",
      "ropeway.cost.line_per_km",
      t("cost.x.ropeway"),
      r.lengthKm,
      t("cost.unit.km"),
      ppp * 1e6,
    );
    pluginItem(
      rope,
      "vehicles",
      "ropeway.cost.cabin_each",
      t("cost.x.vehicles"),
      r.fleet,
      t("cost.unit.vehicles"),
      market * 1e6,
      (rate) => prod(rate, fleet),
    );
    const stationHours: Triple = mul(days, r.stations * serviceH);
    pluginItem(
      rope,
      "service",
      "ropeway.cost.station_hour",
      t("cost.x.stationHours", { n: r.stations, from: hhmm(r.firstS / 60), to: hhmm(r.lastS / 60) }),
      stationHours[1],
      t("cost.unit.stationHours"),
      ppp,
      (rate) => prod(rate, stationHours),
    );
  }

  // Ferries: piers, vessels with the reserve, and crew, fuel and running repairs per vessel-hour.
  for (const f of input.ferries ?? []) {
    const line = { id: f.id, mode: f.mode, context: f.vessel };
    const fleet: Triple = [f.fleet, f.fleet, f.fleet];
    lines.push({
      id: f.id,
      name: f.name,
      mode: f.mode,
      color: f.color,
      lengthKm: f.lengthKm,
      inService: f.inService,
      fleet: f.fleet,
      hoursPerYear: days[1] * f.vesselHoursPerDay,
      kmPerYear: days[1] * f.vesselKmPerDay,
    });
    pluginItem(
      line,
      "stations",
      "ferry.cost.pier_each",
      t("cost.x.piers"),
      f.piers,
      t("cost.unit.each"),
      ppp * 1e6,
    );
    pluginItem(
      line,
      "vehicles",
      "ferry.cost.vessel_each",
      t("cost.x.vessels"),
      f.fleet,
      t("cost.unit.vehicles"),
      market * 1e6,
      (rate) => prod(rate, fleet),
    );
    const vesselHours: Triple = mul(days, f.vesselHoursPerDay);
    pluginItem(
      line,
      "service",
      "ferry.cost.vessel_hour",
      t("cost.x.vesselHours", { n: f.inService, from: hhmm(f.firstS / 60), to: hhmm(f.lastS / 60) }),
      vesselHours[1],
      t("cost.unit.vehicleHours"),
      ppp,
      (rate) => prod(rate, vesselHours),
    );
  }

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
    // Per line where the infrastructure is the line's own (street lines, cable cars), else for the mode.
    const groups = new Map<string | null, CostItem[]>();
    for (const x of items)
      if (x.mode === mode && INFRA.has(x.category)) {
        const g = x.line && !x.line.startsWith("rail:") ? x.line : null;
        groups.set(g, [...(groups.get(g) ?? []), x]);
      }
    for (const [line, xs] of groups) {
      const base = sum(xs.map((x) => x.amount));
      const pct = (s: Triple) => s.map((p) => Math.round(p * 1000) / 10).join("–");
      // Shared shares follow the infrastructure they are on: each part's share of the central amount.
      const modeLines = lines.filter((l) => l.mode === mode).map((l) => l.id);
      const parts =
        line === null && base[1] > 0
          ? xs.flatMap((x) =>
              (x.parts ?? [{ quantity: x.quantity, lines: x.line ? [x.line] : modeLines }]).map((q) => ({
                quantity: (x.amount[1] * (x.quantity > 0 ? q.quantity / x.quantity : 0)) / base[1],
                lines: q.lines,
              })),
            )
          : undefined;
      const shared = parts ? { parts } : {};
      items.push({
        category: "engineering",
        mode,
        line,
        label: t("cost.x.ofInfra", { pct: pct(eng) }),
        quantity: 1,
        unit: "",
        rate: prod(base, eng),
        amount: prod(base, eng),
        param: "cost.engineering_share",
        ...shared,
      });
      items.push({
        category: "contingency",
        mode,
        line,
        label: t("cost.x.ofInfra", { pct: pct(cont) }),
        quantity: 1,
        unit: "",
        rate: prod(base, cont),
        amount: prod(base, cont),
        param: "cost.contingency_share",
        ...shared,
      });
      items.push({
        category: "maintenance",
        mode,
        line,
        label: t("cost.x.ofInfraYear", { pct: pct(upkeep) }),
        quantity: 1,
        unit: "",
        rate: prod(base, upkeep),
        amount: prod(base, upkeep),
        param: "cost.opex.infrastructure_share",
        ...shared,
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
        label: t("cost.x.ofOperating"),
        quantity: 1,
        unit: "",
        rate: prod(running, overhead),
        amount: prod(running, overhead),
        param: "cost.opex.overhead_share",
      });
  }
  if (railway && view && !(railway.lines ?? []).length && view.tracks.length)
    notes.push(t("cost.note.noLines"));
  return { items, lines, modes, notes };
}

/** Purpose: whether a category is a construction (one-off) cost; the others are operating costs a year. */
export function isConstruction(c: Category): boolean {
  return CONSTRUCTION.includes(c);
}

/**
 * Purpose: totals per line. Items of one line count for it; a track, station or switch is split between the
 * lines that run on it by vehicle- or train-km, and a mode's other shared items (overheads, depot and storage
 * tracks no line runs through) between all of its lines; a mode without lines keeps its share unassigned.
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
    const modeLines = e.lines.filter((l) => l.mode === x.mode && l.kmPerYear > 0);
    // Each part goes to the lines that run on it, by their km; without parts, to every line of the mode.
    const parts = x.parts ?? [{ quantity: x.quantity, lines: modeLines.map((l) => l.id) }];
    for (const part of parts) {
      const share = x.quantity > 0 ? part.quantity / x.quantity : 0;
      if (!(share > 0)) continue;
      // A part no line runs through (a depot or storage track, a siding) serves all of the mode's lines.
      const own = modeLines.filter((l) => part.lines.includes(l.id));
      const users = own.length ? own : modeLines;
      const total = users.reduce((s, l) => s + l.kmPerYear, 0);
      if (!total) {
        bump(`:${x.mode}`, x, share);
        continue;
      }
      for (const l of users) bump(l.id, x, (share * l.kmPerYear) / total);
    }
  }
  return out;
}

function ownPref(prefs: Record<string, number> | undefined, id: string): number | undefined {
  const v = prefs?.[id];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** Purpose: the label and unit of a plugin parameter, from the plugin that has it. */
function ropewayParamMeta(key: string): { label: string; unit: string } | null {
  for (const p of activePlugins()) if (p.parameters[key]) return p.parameters[key]!;
  return null;
}

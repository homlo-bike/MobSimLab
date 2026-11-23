import { tNow } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/en";
import type { DelayShares } from "../street-lines/types";
import { layoutOf, type Layout } from "./sections";
import type { JunctionSetup, StreetInfo, StreetSetup, TramShare } from "./types";

/** Assumption `street.mixed_traffic_delay_share` (central): extra running time in a main road's traffic. */
export const MIXED_DELAY = 0.25;
/** Assumption `street.bus_lane_delay_share` (central): extra running time in a painted bus or tram lane. */
export const PAINTED_DELAY = 0.08;

/** The assumption library's delays in traffic, used where the project's preferences do not change them. */
export const DEFAULT_DELAYS: DelayShares = { mixed_traffic: MIXED_DELAY, bus_lane: PAINTED_DELAY };

/** What a street is after the planner's setup: each value from the setup, else from OpenStreetMap. */
export interface Effective {
  /** Road traffic runs one way only. */
  oneway: boolean;
  trafficLanes: number;
  busLane: boolean;
  bikeLane: boolean;
  separated: boolean;
  /** `null`: no tram, or the railway editor infers it from the street's width. */
  tram: TramShare | null;
  /** The street has tram rails, or the planner said how a tram shares it. */
  hasTram: boolean;
  /** Cars per hour in each direction in the morning and evening peak. */
  carsMorningPeak: number;
  carsEveningPeak: number;
  /** What the custom layout means for traffic; `null` when the street keeps OSM's lanes. */
  layout: Layout | null;
}

/** Purpose: general traffic lanes as OSM gives them (OSM `lanes` counts bus lanes too). */
export function osmTrafficLanes(info: StreetInfo): number {
  const busLanes = info.bus_lane ? (info.oneway ? 1 : 2) : 0;
  if (info.lanes != null) return Math.max(1, Math.round(info.lanes) - busLanes);
  return info.oneway ? 1 : 2;
}

/** Purpose: the street's values with the setup applied. */
export function effective(info: StreetInfo, setup: StreetSetup | undefined): Effective {
  const s = setup ?? { way: info.way };
  if (s.sections) {
    const l = layoutOf(s.sections);
    const cars = l.carsForward + l.carsBackward;
    return {
      oneway: cars > 0 ? l.carsForward === 0 || l.carsBackward === 0 : !(l.busForward && l.busBackward),
      trafficLanes: cars,
      busLane: l.busLanes > 0,
      bikeLane: l.bikeLane,
      separated: l.separated,
      tram: l.tram ? (l.tramOwnLane ? "own_lane" : "mixed") : null,
      hasTram: l.tram,
      carsMorningPeak: cars ? (s.cars_morning_peak ?? peakCarsDefault(info.class)) : 0,
      carsEveningPeak: cars ? (s.cars_evening_peak ?? peakCarsDefault(info.class)) : 0,
      layout: l,
    };
  }
  const tram = s.tram ?? null;
  return {
    oneway: s.oneway ?? info.oneway,
    trafficLanes: s.traffic_lanes ?? osmTrafficLanes(info),
    busLane: s.bus_lane ?? info.bus_lane,
    bikeLane: s.bike_lane ?? info.bike_lane,
    separated: s.separated ?? info.class === "busway",
    tram,
    hasTram: info.tram || tram !== null,
    carsMorningPeak: s.cars_morning_peak ?? peakCarsDefault(info.class),
    carsEveningPeak: s.cars_evening_peak ?? peakCarsDefault(info.class),
    layout: null,
  };
}

/** Purpose: whether a setup changes anything. */
export function isEmpty(s: StreetSetup): boolean {
  return (
    s.sections == null &&
    s.oneway == null &&
    s.traffic_lanes == null &&
    s.bus_lane == null &&
    s.bike_lane == null &&
    s.separated == null &&
    s.tram == null &&
    s.cars_morning_peak == null &&
    s.cars_evening_peak == null
  );
}

/**
 * Assumptions `street.peak_cars_*_vph` (central): cars per hour in each direction at peak where the
 * planner sets none, by road type. The same value applies to the morning and the evening peak.
 */
export const PEAK_CARS_DEFAULT = {
  trunk: 1500,
  primary: 900,
  secondary: 600,
  tertiary: 300,
  local: 50,
} as const;

/** Largest traffic peak accepted, cars per hour in one direction (about four busy lanes). */
export const MAX_PEAK_CARS = 8000;

/** Purpose: the default cars per hour in each direction at peak for an OSM highway class. */
export function peakCarsDefault(cls: string): number {
  switch (cls) {
    case "trunk":
    case "trunk_link":
    case "motorway_link":
      return PEAK_CARS_DEFAULT.trunk;
    case "primary":
    case "primary_link":
      return PEAK_CARS_DEFAULT.primary;
    case "secondary":
    case "secondary_link":
      return PEAK_CARS_DEFAULT.secondary;
    case "tertiary":
    case "tertiary_link":
      return PEAK_CARS_DEFAULT.tertiary;
    // No general traffic: buses only, or people on foot.
    case "busway":
    case "pedestrian":
      return 0;
    default:
      return PEAK_CARS_DEFAULT.local;
  }
}

/** Purpose: a typed traffic peak as a value to save: a whole number of cars, `null` when empty or invalid. */
export function parsePeakCars(text: string): number | null {
  const v = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(v) || v < 0) return null;
  return Math.min(MAX_PEAK_CARS, Math.round(v));
}

/** Purpose: the list with one street's setup replaced (removed when it changes nothing). */
export function upsert(list: readonly StreetSetup[], s: StreetSetup): StreetSetup[] {
  const rest = list.filter((x) => x.way !== s.way);
  return isEmpty(s) ? rest : [...rest, s];
}

/** Purpose: the planner's setup of the junction made of these OSM nodes, if any (any node in common). */
export function junctionSetupOf(
  list: readonly JunctionSetup[],
  nodes: readonly number[],
): JunctionSetup | undefined {
  return list.find((j) => j.nodes.some((n) => nodes.includes(n)));
}

/**
 * Purpose: the list with one junction's traffic lights set (`true`/`false`), or back to what OSM maps
 * (`null`: its setup is removed).
 */
export function setJunction(
  list: readonly JunctionSetup[],
  junction: Omit<JunctionSetup, "signals">,
  signals: boolean | null,
): JunctionSetup[] {
  const rest = list.filter((j) => !j.nodes.some((n) => junction.nodes.includes(n)));
  return signals === null ? rest : [...rest, { ...junction, signals }];
}

/** One line of what the setup means for service and safety. */
export interface Verdict {
  level: "ok" | "info" | "warning";
  /** Who it is about. */
  who: "Buses" | "Trams" | "Cyclists" | "Cars";
  text: string;
}

const pct = (x: number) => ({ pct: Math.round(x * 100) });

/**
 * Purpose: what the street's setup means for the reliability of buses and trams and for the safety of
 * cyclists, by the same rules the street line tool and the railway editor apply.
 */
export function verdicts(info: StreetInfo, e: Effective, delays: DelayShares = DEFAULT_DELAYS): Verdict[] {
  const out: Verdict[] = [];
  const main = info.main_road;
  const l = e.layout;
  if (l) {
    const up = l.carsForward;
    const down = l.carsBackward;
    out.push(
      up + down === 0
        ? { level: "info", who: "Cars", text: tNow("setup.v.carsClosed") }
        : {
            level: "ok",
            who: "Cars",
            text: tNow(up && down ? "setup.v.carsTwoWay" : "setup.v.carsOneWay", { up, down }),
          },
    );
  }
  if (l && !l.busForward && !l.busBackward) {
    out.push({ level: "info", who: "Buses", text: tNow("setup.v.busBanned") });
  } else if (l && !l.carsForward && !l.carsBackward) {
    out.push({ level: "ok", who: "Buses", text: tNow("setup.v.busNoCars") });
  } else if (!main) {
    out.push({
      level: "ok",
      who: "Buses",
      text: tNow("setup.v.busNoDelay"),
    });
  } else if (e.busLane && e.separated) {
    out.push({ level: "ok", who: "Buses", text: tNow("setup.v.busSeparated") });
  } else if (e.busLane) {
    out.push({
      level: "info",
      who: "Buses",
      text: tNow("setup.v.busPainted", pct(delays.bus_lane)),
    });
  } else {
    out.push({
      level: "warning",
      who: "Buses",
      text: tNow("setup.v.busMixed", pct(delays.mixed_traffic)),
    });
  }
  if (e.hasTram) {
    if (e.tram === "own_lane" && e.separated) {
      out.push({ level: "ok", who: "Trams", text: tNow("setup.v.tramSeparated") });
    } else if (e.tram === "own_lane") {
      out.push({
        level: "info",
        who: "Trams",
        text: main ? tNow("setup.v.tramPaintedMain", pct(delays.bus_lane)) : tNow("setup.v.tramPainted"),
      });
    } else if (e.tram === "mixed") {
      out.push({
        level: main ? "warning" : "info",
        who: "Trams",
        text: main ? tNow("setup.v.tramMixedMain", pct(delays.mixed_traffic)) : tNow("setup.v.tramMixed"),
      });
    } else {
      out.push({
        level: "info",
        who: "Trams",
        text: tNow("setup.v.tramInferred"),
      });
    }
    if (e.tram === "mixed" && !e.bikeLane) {
      out.push({
        level: main ? "warning" : "info",
        who: "Cyclists",
        text: tNow("setup.v.bikeRails"),
      });
    }
  }
  const noCars = !!l && l.carsForward + l.carsBackward === 0;
  if (main && !noCars && !e.bikeLane && !(e.hasTram && e.tram === "mixed")) {
    out.push({
      level: "info",
      who: "Cyclists",
      text: e.busLane ? tNow("setup.v.bikeBusLane") : tNow("setup.v.bikeTraffic"),
    });
  }
  return out;
}

/** Purpose: where the street's colour on the map comes from: transit priority and how it is protected. */
export function priority(info: StreetInfo, e: Effective): "separated" | "painted" | "mixed" | "other" {
  const lane = e.busLane || e.tram === "own_lane";
  if (lane && e.separated) return "separated";
  if (lane) return "painted";
  if (info.main_road || e.tram === "mixed") return "mixed";
  return "other";
}

const key = (projectId: string) => `mobsimlab.streetSetups.${projectId}`;

/** Purpose: street setups an older release kept in this browser (empty when storage is unavailable). */
export function loadSetups(projectId: string): StreetSetup[] {
  try {
    const raw = localStorage.getItem(key(projectId));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as StreetSetup[]).filter((s) => typeof s?.way === "number") : [];
  } catch {
    return [];
  }
}

/** Purpose: forget the street setups kept in this browser, once they are saved with the project. */
export function forgetSetups(projectId: string): void {
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** Message keys of the labels of OSM highway classes. */
export const CLASS_LABEL: Record<string, MessageKey> = {
  trunk: "setup.class.trunk",
  trunk_link: "setup.class.trunk_link",
  primary: "setup.class.primary",
  primary_link: "setup.class.primary_link",
  secondary: "setup.class.secondary",
  secondary_link: "setup.class.primary_link",
  tertiary: "setup.class.tertiary",
  tertiary_link: "setup.class.tertiary_link",
  unclassified: "setup.class.unclassified",
  residential: "setup.class.residential",
  living_street: "setup.class.living_street",
  service: "setup.class.service",
  busway: "setup.class.busway",
  road: "setup.class.road",
  pedestrian: "setup.class.pedestrian",
  motorway_link: "setup.class.motorway_link",
};

import { tNow } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/en";
import type { DelayShares } from "../street-lines/types";
import type { StreetInfo, StreetSetup, TramShare } from "./types";

/** Assumption `street.mixed_traffic_delay_share` (central): extra running time in a main road's traffic. */
export const MIXED_DELAY = 0.25;
/** Assumption `street.bus_lane_delay_share` (central): extra running time in a painted bus or tram lane. */
export const PAINTED_DELAY = 0.08;

/** The assumption library's delays in traffic, used where the project's preferences do not change them. */
export const DEFAULT_DELAYS: DelayShares = { mixed_traffic: MIXED_DELAY, bus_lane: PAINTED_DELAY };

/** What a street is after the planner's setup: each value from the setup, else from OpenStreetMap. */
export interface Effective {
  trafficLanes: number;
  busLane: boolean;
  bikeLane: boolean;
  separated: boolean;
  /** `null`: no tram, or the railway editor infers it from the street's width. */
  tram: TramShare | null;
  /** The street has tram rails, or the planner said how a tram shares it. */
  hasTram: boolean;
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
  const tram = s.tram ?? null;
  return {
    trafficLanes: s.traffic_lanes ?? osmTrafficLanes(info),
    busLane: s.bus_lane ?? info.bus_lane,
    bikeLane: s.bike_lane ?? info.bike_lane,
    separated: s.separated ?? info.class === "busway",
    tram,
    hasTram: info.tram || tram !== null,
  };
}

/** Purpose: whether a setup changes anything. */
export function isEmpty(s: StreetSetup): boolean {
  return (
    s.traffic_lanes == null &&
    s.bus_lane == null &&
    s.bike_lane == null &&
    s.separated == null &&
    s.tram == null
  );
}

/** Purpose: the list with one street's setup replaced (removed when it changes nothing). */
export function upsert(list: readonly StreetSetup[], s: StreetSetup): StreetSetup[] {
  const rest = list.filter((x) => x.way !== s.way);
  return isEmpty(s) ? rest : [...rest, s];
}

/** One line of what the setup means for service and safety. */
export interface Verdict {
  level: "ok" | "info" | "warning";
  /** Who it is about. */
  who: "Buses" | "Trams" | "Cyclists";
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
  if (!main) {
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
  if (main && !e.bikeLane && !(e.hasTram && e.tram === "mixed")) {
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

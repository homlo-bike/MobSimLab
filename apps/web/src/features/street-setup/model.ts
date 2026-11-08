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

const pct = (x: number) => `${Math.round(x * 100)} %`;

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
      text: "No delay in traffic is assumed on this kind of street; it counts on main roads.",
    });
  } else if (e.busLane && e.separated) {
    out.push({ level: "ok", who: "Buses", text: "Separated bus lane: traffic jams do not hold buses up." });
  } else if (e.busLane) {
    out.push({
      level: "info",
      who: "Buses",
      text: `Painted bus lane: turning and parking cars still get in the way, about ${pct(delays.bus_lane)} longer running time for buses and trolleybuses at peak. Separate it to keep cars out.`,
    });
  } else {
    out.push({
      level: "warning",
      who: "Buses",
      text: `Buses and trolleybuses run in the traffic of a main road: about ${pct(delays.mixed_traffic)} longer running time at peak, and late when traffic jams. A bus lane fixes it.`,
    });
  }
  if (e.hasTram) {
    if (e.tram === "own_lane" && e.separated) {
      out.push({ level: "ok", who: "Trams", text: "Own lane, separated from the traffic: reliable." });
    } else if (e.tram === "own_lane") {
      out.push({
        level: "info",
        who: "Trams",
        text: main
          ? `Own lane, painted only: cars still cross and stop in it, about ${pct(delays.bus_lane)} longer at peak. Separate it with a kerb or track bed.`
          : "Own lane, painted only.",
      });
    } else if (e.tram === "mixed") {
      out.push({
        level: main ? "warning" : "info",
        who: "Trams",
        text: main
          ? `Mixed traffic on a main road: the tram is held up in traffic jams and can be stuck in gridlock, about ${pct(delays.mixed_traffic)} longer at peak. The tram timetable counts it in the running time. Give it its own lane, separated.`
          : "Mixed traffic: the tram runs in the traffic lanes.",
      });
    } else {
      out.push({
        level: "info",
        who: "Trams",
        text: "Inferred from the street's width in the railway editor: own lane where the street is wide enough, else mixed traffic. Set it here to decide.",
      });
    }
    if (e.tram === "mixed" && !e.bikeLane) {
      out.push({
        level: main ? "warning" : "info",
        who: "Cyclists",
        text: "Cyclists ride along the tram rails: a wheel caught in the groove is a common cause of falls. Add a bike lane.",
      });
    }
  }
  if (main && !e.bikeLane && !(e.hasTram && e.tram === "mixed")) {
    out.push({
      level: "info",
      who: "Cyclists",
      text: e.busLane
        ? "No bike lane: cyclists share the bus lane with buses."
        : "No bike lane: cyclists ride in the traffic of a main road.",
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

/** Human labels of OSM highway classes. */
export const CLASS_LABEL: Record<string, string> = {
  trunk: "Trunk road",
  trunk_link: "Trunk road link",
  primary: "Main road",
  primary_link: "Main road link",
  secondary: "Main road (secondary)",
  secondary_link: "Main road link",
  tertiary: "Local main street",
  tertiary_link: "Local main street link",
  unclassified: "Minor road",
  residential: "Residential street",
  living_street: "Living street",
  service: "Service road",
  busway: "Busway",
  road: "Road",
  pedestrian: "Pedestrian zone",
  motorway_link: "Motorway link",
};

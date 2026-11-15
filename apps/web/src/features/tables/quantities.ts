/**
 * The infrastructure quantities of a project for the Tables tab: track by construction type, stations,
 * switches, level crossings, street running, the steepest gradients, and the street lines' stops and lanes.
 * Construction types follow the cost estimate (ADR-0039), so the quantities match the cost tables.
 */
import { CATEGORY_LABEL, type StructureCategory, structureOf } from "../costs/model";
import type { Level, Network, RailView } from "../railways/types";
import type { SavedStreetLine } from "../street-lines/saved";
import { lineStats } from "../street-lines/summary";

export const STRUCTURES: StructureCategory[] = [
  "at_grade",
  "elevated",
  "viaduct",
  "bridge",
  "ramp",
  "cut_and_cover",
  "tbm",
];
export const STRUCTURE_LABEL: Record<StructureCategory, string> = {
  ...(CATEGORY_LABEL as Record<StructureCategory, string>),
  at_grade: "At street level or on its own formation",
};
/** Construction types counted as tunnels and as bridges or viaducts in the summary. */
export const TUNNELS: StructureCategory[] = ["cut_and_cover", "tbm"];
export const BRIDGES: StructureCategory[] = ["viaduct", "bridge"];

export const LEVELS: Level[] = ["underground2", "underground", "street", "elevated", "elevated2"];
export const LEVEL_LABEL: Record<Level, string> = {
  underground2: "Underground, deep",
  underground: "Underground",
  street: "At street level",
  elevated: "Elevated",
  elevated2: "Elevated, upper level",
};

/** Quantities of one rail mode. */
export interface RailQuantities {
  mode: string;
  /** Route length (centre line) and track length (route × tracks), km. */
  routeKm: number;
  trackKm: number;
  /** Route km on single and on double track. */
  singleKm: number;
  doubleKm: number;
  /** Route km by construction type. */
  byStructure: Record<StructureCategory, number>;
  /** Stations by level, and platform edges. */
  stations: Record<Level, number>;
  platformEdges: number;
  switches: number;
  /** Level crossings with streets and with footpaths or cycle paths. */
  crossingsStreet: number;
  crossingsPath: number;
  /** Km in streets: own lane, in road traffic, shared with people on foot. */
  street: { reserved: number; mixed: number; pedestrian_zone: number };
  signals: number;
  /** Steepest gradient of any track, ‰ (absolute), the track it is on, and the mode's limit; null without terrain. */
  steepest: { permille: number; track: string; limit: number } | null;
}

/** Quantities of one street line. */
export interface StreetQuantities {
  id: string;
  name: string;
  mode: string;
  /** One direction, km. */
  routeKm: number;
  stops: number;
  /** Over the circuit (both directions): km in a bus lane or busway and km in general traffic. */
  busLaneKm: number;
  mixedKm: number;
  levelCrossings: number;
}

export interface Quantities {
  rail: RailQuantities[];
  street: StreetQuantities[];
}

const zeroStructures = () =>
  Object.fromEntries(STRUCTURES.map((s) => [s, 0])) as Record<StructureCategory, number>;
const zeroLevels = () => Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;

/**
 * Purpose: the infrastructure quantities of the railway (by mode) and of the street lines.
 * Inputs: the railway document and its build, the street lines.
 * Output: per rail mode in order of first appearance, and per street line.
 */
export function quantities(
  railway: Network | null,
  view: RailView | null,
  streetLines: SavedStreetLine[],
): Quantities {
  const byMode = new Map<string, RailQuantities>();
  const of = (mode: string) => {
    let q = byMode.get(mode);
    if (!q) {
      q = {
        mode,
        routeKm: 0,
        trackKm: 0,
        singleKm: 0,
        doubleKm: 0,
        byStructure: zeroStructures(),
        stations: zeroLevels(),
        platformEdges: 0,
        switches: 0,
        crossingsStreet: 0,
        crossingsPath: 0,
        street: { reserved: 0, mixed: 0, pedestrian_zone: 0 },
        signals: 0,
        steepest: null,
      };
      byMode.set(mode, q);
    }
    return q;
  };
  if (railway && view) {
    const trackMode = new Map(view.tracks.map((t) => [t.id, t.mode] as const));
    for (const tv of view.tracks) {
      const doc = railway.tracks.find((t) => t.id === tv.id);
      if (!doc) continue;
      const q = of(tv.mode);
      const km = tv.length_m / 1000;
      q.routeKm += km;
      q.trackKm += km * tv.tracks;
      if (tv.tracks >= 2) q.doubleKm += km;
      else q.singleKm += km;
      if (tv.levels.length)
        for (const z of tv.levels)
          q.byStructure[structureOf(z.level, doc, tv.mode)] += Math.max(0, z.to_m - z.from_m) / 1000;
      else q.byStructure[structureOf(doc.level, doc, tv.mode)] += km;
      const e = tv.elevation;
      if (e && (!q.steepest || Math.abs(e.steepest_permille) > q.steepest.permille))
        q.steepest = {
          permille: Math.abs(e.steepest_permille),
          track: doc.name || `Track ${doc.id}`,
          limit: e.max_permille,
        };
    }
    for (const sv of view.stations) {
      const q = of(sv.mode);
      const level = railway.stations.find((s) => s.id === sv.id)?.level ?? "street";
      q.stations[level] += 1;
      q.platformEdges += sv.platform_edges ?? 0;
    }
    for (const sw of view.switches) of(trackMode.get(sw.track) ?? railway.mode).switches += 1;
    for (const lc of view.level_crossings ?? []) {
      const q = of(lc.mode);
      if (lc.path) q.crossingsPath += 1;
      else q.crossingsStreet += 1;
    }
    for (const sr of view.street_running ?? [])
      of(trackMode.get(sr.track) ?? railway.mode).street[sr.running] += sr.length_m / 1000;
    const stationMode = new Map(view.stations.map((s) => [s.id, s.mode] as const));
    const switchTrack = new Map(view.switches.map((s) => [s.id, s.track] as const));
    for (const sg of view.signals ?? []) {
      if (!sg.lineside) continue;
      const a = sg.at;
      const mode =
        a.type === "track"
          ? trackMode.get(a.track)
          : a.type === "station"
            ? stationMode.get(a.station)
            : trackMode.get(switchTrack.get(a.switch) ?? -1);
      of(mode ?? railway.mode).signals += 1;
    }
  }
  const street: StreetQuantities[] = [];
  streetLines.forEach((l, i) => {
    if (l.view.points.length < 2) return;
    const stats = lineStats(l.view, l.timing);
    street.push({
      id: `street:${i}`,
      name: l.name || `Street line ${i + 1}`,
      mode: l.profile.mode,
      routeKm: l.view.length_m / 2000,
      stops: stats.stops,
      busLaneKm: (l.view.bus_lane_m ?? 0) / 1000,
      mixedKm: (l.view.mixed_traffic_m ?? 0) / 1000,
      levelCrossings: l.view.level_crossings?.length ?? 0,
    });
  });
  return { rail: [...byMode.values()], street };
}

/**
 * The lines a schematic draws (ADR-0025, FR-SCH-01): every service line in the project with its stops in
 * order, from the railway tool's service lines, the street line tool's lines and the plugin tools' lines.
 * Stops of different lines that are one station (same name close together, or almost the same place) are
 * merged, so the diagram shows where lines meet and the strip map can list the connections.
 */
import { offset, type PluginLineInput } from "../journey-planner/network";
import { findMode } from "../../plugins/registry";
import type { Level, Network, RailMode } from "../railways/types";
import { cleanFeatures, type StationFeature } from "../stations/features";
import { lineStats } from "../street-lines/summary";
import { lineMode } from "../railways/serviceLines";
import { MODES } from "../street-lines/modes";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { LonLat } from "../street-lines/types";

/** The mode layers of the diagram (FR-SCH-01), plus one for the plugin modes (cable car, ferry and so on). */
export const LAYERS = ["bus", "brt", "tram", "metro", "regional", "long_distance", "other"] as const;
export type Layer = (typeof LAYERS)[number];

/** Purpose: the diagram layer of a mode id (street, rail or plugin mode). */
export function layerOf(mode: string): Layer {
  switch (mode) {
    case "bus":
    case "trolleybus":
    case "intercity_bus":
      return "bus";
    case "brt":
      return "brt";
    case "tram":
    case "light_rail":
      return "tram";
    case "metro":
      return "metro";
    case "commuter_rail":
    case "regional_rail":
      return "regional";
    case "long_distance_rail":
    case "high_speed_rail":
      return "long_distance";
    default:
      return "other";
  }
}

/** One stop or station of a tool that is part of a diagram station. */
export interface StationPart {
  /** Unique per drawn stop: `rail:<station id>`, `street:<line>:<point>`, `plugin:<line>:<stop>`. */
  id: string;
  source: "rail" | "street" | "plugin";
  mode: string;
  /** Platforms (rail: side plus island platforms); null for a street or plugin stop. */
  platforms: number | null;
  /** Rail station level; null elsewhere. */
  level: Level | null;
  features: StationFeature[];
  /** Where the stop or platform is. */
  lonlat: LonLat;
}

/** One station of the diagram: one or more stops of lines merged into one place. */
export interface SchematicStation {
  /** Stable key, used to keep the planner's dragged positions: the name, or the name and a place. */
  key: string;
  name: string;
  lonlat: LonLat;
  /** The drawn stops and stations it is made of. */
  parts: StationPart[];
}

/** How the line runs, as far as the drawings say (null: not known without the engines). */
export interface LineService {
  /** Minutes between departures in the peak and the rest of the day. */
  peakMin: number | null;
  offPeakMin: number | null;
  /** First and last departure, minutes after midnight (rail lines). */
  firstMin: number | null;
  lastMin: number | null;
  /** Vehicles (trains, buses, cabins, vessels) in service at the peak. */
  vehicles: number | null;
  /** Round trip with stops, minutes. */
  roundTripMin: number | null;
  /** Length one way, km. */
  lengthKm: number;
}

/** What a stretch of a line runs on. */
export type SectionLevel = Level | "ramp" | "aerial" | "water";

/** One line of the diagram: its stations in running order. */
export interface SchematicLine {
  id: string;
  name: string;
  /** Mode id (street, rail or plugin mode). */
  mode: string;
  layer: Layer;
  /** "#rrggbb". */
  color: string;
  /** Index into the stations list, first terminal to last. */
  stops: number[];
  service: LineService;
  /**
   * Per section (between stops `i` and `i + 1`): what it runs on, as shares that add up to 1. Rail sections
   * start from the two stations' levels and are refined from the built tracks (`details.ts`).
   */
  levels: { level: SectionLevel; share: number }[][];
  /**
   * Per section: the estimated running time between the two stops, seconds, without the stop itself; null
   * where it is not known yet (rail lines until the engine has run, `details.ts`).
   */
  runS: (number | null)[];
  /**
   * Per section: the distance between the two stops, m: along the routed street for street lines, else in a
   * straight line between the stops.
   */
  distM: number[];
  /**
   * Per section: a rough driving time from the distance and the mode's usual top speed and acceleration, s, for
   * where `runS` is not known yet.
   */
  runEstS: number[];
  /** Per stop: the drawn stop or station it comes from (`StationPart.id`). */
  partIds: string[];
  /**
   * Per section: the way the line runs between the two stops: the routed street for street lines, the built
   * track for rail lines once the engine has run (`details.ts`), else the straight line between the stops.
   */
  paths: LonLat[][];
}

export interface SchematicNetwork {
  stations: SchematicStation[];
  lines: SchematicLine[];
}

/** Stops with the same name within this distance are one station. */
export const SAME_NAME_M = 400;
/** Stops closer than this are one station, whatever their names. */
export const SAME_PLACE_M = 40;

/** Purpose: the distance in metres between two points (equirectangular, fine at city scale). */
export function distanceM(a: LonLat, b: LonLat): number {
  const k = 111_320;
  const dx = (b[0] - a[0]) * k * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = (b[1] - a[1]) * k;
  return Math.hypot(dx, dy);
}

const norm = (s: string) => s.trim().toLocaleLowerCase();

/** A line before its stops are merged into stations. */
interface RawLine {
  id: string;
  name: string;
  mode: string;
  color: string;
  /** `t`: running time from the first stop, s; `d`: distance along the route from the first stop, m (null when
   * not known). */
  stops: {
    name: string;
    lonlat: LonLat;
    part: StationPart;
    t: number | null;
    d?: number | null;
    /** The routed way from the previous stop to this one, when known. */
    path?: LonLat[];
  }[];
  service: LineService;
}

/** Purpose: the length in km of a path through points. */
function pathKm(pts: readonly LonLat[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += distanceM(pts[i - 1]!, pts[i]!);
  return m / 1000;
}

/**
 * Purpose: the raw lines of a project. Inputs: the railway design (its service lines), the saved street lines,
 * and the plugin tools' lines. Output: one entry per line with two or more stops; consecutive repeats of the
 * same stop are dropped.
 */
function rawLines(
  railway: Network | null | undefined,
  streetLines: StreetLinesDoc | null | undefined,
  pluginLines: readonly PluginLineInput[],
): RawLine[] {
  const out: RawLine[] = [];
  if (railway?.lines?.length) {
    const byId = new Map(railway.stations.map((s) => [s.id, s]));
    for (const l of railway.lines) {
      const mode = lineMode(railway, l);
      const stops = l.stations.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        const part: StationPart = {
          id: `rail:${s.id}`,
          source: "rail",
          mode: s.mode ?? railway.mode,
          platforms: s.side_platforms + s.island_platforms,
          level: s.level,
          features: cleanFeatures(s.features),
          lonlat: offset(railway.origin, s.x, s.y),
        };
        return [{ name: s.name, lonlat: part.lonlat, part, t: null }];
      });
      out.push({
        id: `rail:${l.id}`,
        name: l.name,
        mode: mode satisfies RailMode,
        color: l.color,
        stops,
        service: {
          peakMin: l.peak_headway_min,
          offPeakMin: l.offpeak_headway_min,
          firstMin: l.first_min,
          lastMin: l.last_min,
          vehicles: null,
          roundTripMin: null,
          lengthKm: pathKm(stops.map((x) => x.lonlat)),
        },
      });
    }
  }
  (streetLines?.lines ?? []).forEach((l, i) => {
    const pts = l.view?.points ?? [];
    // Running time from the first point to each point, s, along the routed legs (the first pass only).
    const at = new Map<number, number>();
    const along = new Map<number, number>();
    if (pts[0]) {
      at.set(pts[0].id, 0);
      along.set(pts[0].id, 0);
    }
    for (const leg of [...(l.view?.legs ?? [])].sort((a, b) => a.index - b.index)) {
      const from = at.get(leg.from);
      if (from !== undefined && !at.has(leg.to)) {
        at.set(leg.to, from + leg.time_s);
        along.set(leg.to, (along.get(leg.from) ?? 0) + (leg.length_m ?? 0));
      }
    }
    // The routed way into each stop from the stop before it, through the via points.
    const into = new Map<number, LonLat[]>();
    for (const leg of [...(l.view?.legs ?? [])].sort((a, b) => a.index - b.index))
      if (!into.has(leg.to)) into.set(leg.to, leg.coords);
    const pathTo: (LonLat[] | undefined)[] = [];
    let pending: LonLat[] | undefined = [];
    pts.forEach((p, k) => {
      const c = k === 0 ? [] : into.get(p.id);
      pending = pending && c ? [...pending, ...c] : undefined;
      if (p.kind !== "via") {
        pathTo[k] = k === 0 || !pending?.length ? undefined : pending;
        pending = [];
      }
    });
    // The saved points are in the same order as the routed ones; they carry the stops' facilities.
    const stops = pts.flatMap((p, k) =>
      p.kind === "via"
        ? []
        : [
            {
              name: p.name || `Stop ${p.seq + 1}`,
              lonlat: p.lonlat,
              part: {
                id: `street:${i}:${k}`,
                source: "street" as const,
                mode: l.profile.mode,
                platforms: null,
                level: null,
                features: cleanFeatures(l.points?.[k]?.features),
                lonlat: p.lonlat,
              },
              t: at.get(p.id) ?? null,
              d: l.view?.legs?.some((g) => g.length_m) ? (along.get(p.id) ?? null) : null,
              path: pathTo[k],
            },
          ],
    );
    const stats = l.view?.legs && l.timing ? lineStats(l.view, l.timing) : null;
    const headway = l.timing?.headwayMin ?? null;
    out.push({
      id: `street:${i}`,
      name: l.name,
      mode: l.profile.mode,
      color: MODES[l.profile.mode]?.color ?? MODES.bus.color,
      stops,
      service: {
        // The journey planner runs street lines at half their headway in the peak.
        peakMin: headway !== null ? Math.max(1, Math.round(headway / 2)) : null,
        offPeakMin: headway,
        firstMin: null,
        lastMin: null,
        vehicles: stats ? stats.vehicles : null,
        roundTripMin: stats ? Math.round(stats.cycleMin) : null,
        lengthKm: (l.view?.length_m ?? 0) / 2000,
      },
    });
  });
  for (const l of pluginLines) {
    const dir = l.directions[0];
    const order = dir?.map((d) => d.stop) ?? l.stops.map((_, i) => i);
    // Running time from the first stop: the runs before each stop (stops not counted).
    const times: (number | null)[] = [];
    let run = 0;
    dir?.forEach((d, j) => {
      run += j === 0 ? 0 : d.run_s;
      times.push(run);
    });
    const stops = order.flatMap((k, j) => {
      const s = l.stops[k];
      if (!s) return [];
      const part: StationPart = {
        id: `plugin:${l.id}:${k}`,
        source: "plugin",
        mode: l.mode,
        platforms: null,
        level: null,
        features: [],
        lonlat: s.lonlat,
      };
      return [{ name: s.name, lonlat: s.lonlat, part, t: times[j] ?? null }];
    });
    const cycleS = l.directions.reduce((a, d) => a + d.reduce((b, x) => b + x.run_s + x.dwell_s, 0), 0);
    const headwayMin = Math.max(1, l.headwayS) / 60;
    const rounded = Math.round(headwayMin * 10) / 10;
    out.push({
      id: `plugin:${l.id}`,
      name: l.name,
      mode: l.mode,
      color: l.color,
      stops,
      service: {
        peakMin: rounded,
        offPeakMin: rounded,
        firstMin: null,
        lastMin: null,
        vehicles: cycleS > 0 ? Math.ceil(cycleS / 60 / headwayMin) : null,
        roundTripMin: cycleS > 0 ? Math.round(cycleS / 60) : null,
        lengthKm: pathKm(stops.map((x) => x.lonlat)),
      },
    });
  }
  return out
    .map((l) => {
      // A stop repeated right after itself is dropped; its way in joins the next stop's.
      const stops: RawLine["stops"] = [];
      let carry: LonLat[] | undefined = [];
      l.stops.forEach((s, i) => {
        const prev = l.stops[i - 1];
        const repeat = prev && norm(s.name) === norm(prev.name) && distanceM(s.lonlat, prev.lonlat) <= 1;
        const path = i === 0 ? [] : carry && s.path ? [...carry, ...s.path] : undefined;
        if (repeat) carry = path;
        else {
          stops.push({ ...s, path: i === 0 ? undefined : path });
          carry = [];
        }
      });
      return { ...l, stops };
    })
    .filter((l) => l.stops.length >= 2);
}

/**
 * Purpose: the project's lines as a diagram network. Inputs: the railway design, the saved street lines and
 * the plugin tools' lines (any may be missing). Output: merged stations and lines that refer to them. A stop
 * joins an existing station when it has the same name within `SAME_NAME_M`, or lies within `SAME_PLACE_M`.
 */
export function schematicNetwork(
  railway: Network | null | undefined,
  streetLines: StreetLinesDoc | null | undefined,
  pluginLines: readonly PluginLineInput[] = [],
): SchematicNetwork {
  const stations: (SchematicStation & { n: number })[] = [];
  const lines: SchematicLine[] = [];
  const keys = new Set<string>();
  const stationFor = (name: string, lonlat: LonLat, part: StationPart): number => {
    const add = (i: number) => {
      const st = stations[i]!;
      if (!st.parts.some((p) => p.id === part.id)) st.parts.push(part);
      return i;
    };
    let best = -1;
    let bestD = Infinity;
    stations.forEach((s, i) => {
      const d = distanceM(s.lonlat, lonlat);
      const same = norm(s.name) === norm(name);
      if ((same && d <= SAME_NAME_M) || d <= SAME_PLACE_M) {
        const score = same ? d : d + SAME_NAME_M;
        if (score < bestD) {
          bestD = score;
          best = i;
        }
      }
    });
    if (best >= 0) {
      const s = stations[best]!;
      // The station sits at the mean of its stops.
      s.lonlat = [(s.lonlat[0] * s.n + lonlat[0]) / (s.n + 1), (s.lonlat[1] * s.n + lonlat[1]) / (s.n + 1)];
      s.n += 1;
      return add(best);
    }
    let key = norm(name);
    if (keys.has(key)) key = `${key}@${lonlat[0].toFixed(4)},${lonlat[1].toFixed(4)}`;
    keys.add(key);
    stations.push({ key, name, lonlat, n: 1, parts: [] });
    return add(stations.length - 1);
  };
  for (const l of rawLines(railway, streetLines, pluginLines)) {
    const at = l.stops.map((s) => ({
      st: stationFor(s.name, s.lonlat, s.part),
      part: s.part,
      t: s.t,
      d: s.d ?? null,
      lonlat: s.lonlat,
      path: s.path,
    }));
    const keptAt = at.flatMap((x, i) => (i === 0 || x.st !== at[i - 1]!.st ? [i] : []));
    const kept = keptAt.map((i) => at[i]!);
    if (kept.length < 2) continue;
    lines.push({
      id: l.id,
      name: l.name,
      mode: l.mode,
      layer: layerOf(l.mode),
      color: l.color,
      stops: kept.map((x) => x.st),
      service: l.service,
      levels: kept.slice(1).map((x, i) => baseLevels(l.mode, kept[i]!.part, x.part)),
      runS: kept.slice(1).map((x, i) => {
        const a = kept[i]!.t;
        return a !== null && x.t !== null && x.t > a ? x.t - a : null;
      }),
      runEstS: [],
      distM: kept.slice(1).map((x, i) => {
        const a = kept[i]!;
        return a.d !== null && x.d !== null && x.d > a.d ? x.d - a.d : distanceM(a.lonlat, x.lonlat);
      }),
      partIds: kept.map((x) => x.part.id),
      paths: keptAt.slice(1).map((i, k) => {
        // The routed ways of the stops from the previous kept one, or the straight line.
        const from = keptAt[k]!;
        const parts = at.slice(from + 1, i + 1).map((x) => x.path);
        return parts.every((x) => x?.length)
          ? (parts as LonLat[][]).flat()
          : [at[from]!.lonlat, at[i]!.lonlat];
      }),
    });
    const last = lines[lines.length - 1]!;
    last.runEstS = last.distM.map((m) => estimateRunS(l.mode, m));
  }
  return { stations: stations.map(({ key, name, lonlat, parts }) => ({ key, name, lonlat, parts })), lines };
}

/**
 * Purpose: what a section runs on before the tracks are known: street lines on the street, cable cars in the
 * air, ferries on the water; rail sections half at each end station's level (all at one level when equal).
 */
export function baseLevels(
  mode: string,
  a: StationPart,
  b: StationPart,
): { level: SectionLevel; share: number }[] {
  if (a.source === "rail" && a.level && b.level)
    return a.level === b.level
      ? [{ level: a.level, share: 1 }]
      : [
          { level: a.level, share: 0.5 },
          { level: b.level, share: 0.5 },
        ];
  if (a.source === "plugin") {
    const family = findMode(mode)?.mode.family;
    if (family === "aerial") return [{ level: "aerial", share: 1 }];
    if (family === "water") return [{ level: "water", share: 1 }];
  }
  return [{ level: "street", share: 1 }];
}

/** Purpose: the lines that call at a station, in the order of the network's lines. */
export function linesAt(net: SchematicNetwork, station: number): SchematicLine[] {
  return net.lines.filter((l) => l.stops.includes(station));
}

/** Walking as the journey planner assumes it (crates/journey-planner settings). */
export const WALK = { speedKmh: 4.5, detour: 1.3, minChangeS: 60, levelChangeS: 60 } as const;

const LEVEL_NUMBER: Record<string, number> = {
  underground2: -2,
  underground: -1,
  street: 0,
  elevated: 1,
  elevated2: 2,
};

/**
 * Purpose: the estimated walk to change from one stop or platform to another at an interchange, s: the
 * straight distance times the detour factor at walking speed, at least the minimum change time, plus a minute per
 * level climbed or descended (street and plugin stops count as street level).
 */
export function transferS(a: StationPart, b: StationPart): number {
  const walk = (distanceM(a.lonlat, b.lonlat) * WALK.detour) / (WALK.speedKmh / 3.6);
  const levels = Math.abs(
    (LEVEL_NUMBER[a.level ?? "street"] ?? 0) - (LEVEL_NUMBER[b.level ?? "street"] ?? 0),
  );
  return Math.max(WALK.minChangeS, walk) + levels * WALK.levelChangeS;
}

/** Features that make a stop reachable without steps. */
const STEP_FREE: readonly StationFeature[] = ["step_free", "elevator", "ramp"];

/**
 * Purpose: whether a station is step-free as recorded in Create: every stop or platform of it has step-free
 * access, a lift or a ramp.
 */
export function isStepFree(st: SchematicStation): boolean {
  return st.parts.length > 0 && st.parts.every((p) => p.features.some((f) => STEP_FREE.includes(f)));
}

/** Usual top speed (km/h) and acceleration (m/s²) per mode: the central values of the assumption library. */
const MOTION: Record<string, [number, number]> = {
  bus: [60, 1.2],
  brt: [70, 1.2],
  trolleybus: [60, 1.2],
  intercity_bus: [100, 0.8],
  tram: [60, 1.2],
  light_rail: [80, 1.1],
  metro: [80, 1.1],
  commuter_rail: [120, 0.9],
  regional_rail: [160, 0.8],
  long_distance_rail: [200, 0.5],
  high_speed_rail: [300, 0.4],
};

/** Track or road is longer than the straight line between stops by about this much. */
const DETOUR = 1.15;

/**
 * Purpose: a rough driving time between two stops, s: accelerate to the mode's usual top speed, run, and brake
 * at the same rate, over the straight distance times 1.15 (shorter sections never reach top speed).
 */
export function estimateRunS(mode: string, straightM: number): number {
  const [kmh, a] = MOTION[mode] ?? [80, 1.0];
  const v = kmh / 3.6;
  const d = straightM * DETOUR;
  return d >= (v * v) / a ? d / v + v / a : 2 * Math.sqrt(d / a);
}

/**
 * The lines a schematic draws (ADR-0025, FR-SCH-01): every service line in the project with its stops in
 * order, from the railway tool's service lines, the street line tool's lines and the plugin tools' lines.
 * Stops of different lines that are one station (same name close together, or almost the same place) are
 * merged, so the diagram shows where lines meet and the strip map can list the connections.
 */
import { offset, type PluginLineInput } from "../journey-planner/network";
import type { Network, RailMode } from "../railways/types";
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

/** One station of the diagram: one or more stops of lines merged into one place. */
export interface SchematicStation {
  /** Stable key, used to keep the planner's dragged positions: the name, or the name and a place. */
  key: string;
  name: string;
  lonlat: LonLat;
}

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
  stops: { name: string; lonlat: LonLat }[];
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
      const stops = l.stations.flatMap((id) => {
        const s = byId.get(id);
        return s ? [{ name: s.name, lonlat: offset(railway.origin, s.x, s.y) }] : [];
      });
      out.push({
        id: `rail:${l.id}`,
        name: l.name,
        mode: lineMode(railway, l) satisfies RailMode,
        color: l.color,
        stops,
      });
    }
  }
  (streetLines?.lines ?? []).forEach((l, i) => {
    const stops = (l.view?.points ?? [])
      .filter((p) => p.kind !== "via")
      .map((p) => ({ name: p.name || `Stop ${p.seq + 1}`, lonlat: p.lonlat }));
    out.push({
      id: `street:${i}`,
      name: l.name,
      mode: l.profile.mode,
      color: MODES[l.profile.mode]?.color ?? MODES.bus.color,
      stops,
    });
  });
  for (const l of pluginLines) {
    const order = l.directions[0]?.map((d) => d.stop) ?? l.stops.map((_, i) => i);
    const stops = order.flatMap((k) => {
      const s = l.stops[k];
      return s ? [{ name: s.name, lonlat: s.lonlat }] : [];
    });
    out.push({ id: `plugin:${l.id}`, name: l.name, mode: l.mode, color: l.color, stops });
  }
  return out
    .map((l) => ({
      ...l,
      stops: l.stops.filter(
        (s, i, a) =>
          i === 0 || norm(s.name) !== norm(a[i - 1]!.name) || distanceM(s.lonlat, a[i - 1]!.lonlat) > 1,
      ),
    }))
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
  const stationFor = (name: string, lonlat: LonLat): number => {
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
      return best;
    }
    let key = norm(name);
    if (keys.has(key)) key = `${key}@${lonlat[0].toFixed(4)},${lonlat[1].toFixed(4)}`;
    keys.add(key);
    stations.push({ key, name, lonlat, n: 1 });
    return stations.length - 1;
  };
  for (const l of rawLines(railway, streetLines, pluginLines)) {
    const stops = l.stops
      .map((s) => stationFor(s.name, s.lonlat))
      .filter((s, i, a) => i === 0 || s !== a[i - 1]);
    if (stops.length < 2) continue;
    lines.push({ id: l.id, name: l.name, mode: l.mode, layer: layerOf(l.mode), color: l.color, stops });
  }
  return { stations: stations.map(({ key, name, lonlat }) => ({ key, name, lonlat })), lines };
}

/** Purpose: the lines that call at a station, in the order of the network's lines. */
export function linesAt(net: SchematicNetwork, station: number): SchematicLine[] {
  return net.lines.filter((l) => l.stops.includes(station));
}

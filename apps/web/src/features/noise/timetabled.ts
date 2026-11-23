/**
 * Timetabled noise input (ADR-0038 §4, step N3): vehicles in each clock hour on each piece of line, from
 * the trips the project actually runs instead of a headway and sample flows. Street lines run their
 * departures of the day (peak and off-peak headways between the first and last departure) round their
 * circuit; railway tracks carry the trains of each published service line, counted per section of the
 * track by the timetable planner.
 */
import { tNow } from "../../i18n/i18n";
import { distanceM } from "../../map/geo";
import { lineMode, engineLines, trainById } from "../railways/serviceLines";
import type { Network, RailEngine, RailView, SectionTrains, ServiceLine } from "../railways/types";
import { lineEnergy, roadLine } from "../road-sim/scenario";
import type { RoadLine } from "../road-sim/types";
import type { SavedStreetLine } from "../street-lines/saved";
import type { LonLat } from "../street-lines/types";
import { railSources } from "./sources";
import type { NoiseLine, NoiseMode, NoiseRange } from "./types";
import { engineErrorText } from "../../i18n/engine";

/** Vehicles in each clock hour 0–23. */
export type Hourly = number[];

/** The service day reaches past midnight; departures up to this late are counted, s. */
const DAY_END_S = 30 * 3600;

/** Purpose: the clock hour 0–23 of a time in seconds after the service day's midnight (25:10 is hour 1). */
export function clockHour(s: number): number {
  return ((Math.floor(s / 3600) % 24) + 24) % 24;
}

/** Purpose: 24 zeros. */
export function noHours(): Hourly {
  return new Array<number>(24).fill(0);
}

/**
 * Purpose: when each departure of a road line enters each leg of its circuit: the departure time plus the
 * running times of the legs before it, the dwell at each stop passed and the layover at an end stop.
 * Output: per leg of `line.legs`, the entry times, s.
 */
export function legEntryTimes(line: RoadLine, departures: readonly number[] = line.departures): number[][] {
  const offsets: number[] = [];
  let t = 0;
  for (let k = 0; k < line.legs.length; k++) {
    if (k > 0) {
      const kind = line.points[k]?.kind;
      if (kind === "stop") t += line.dwell_s;
      else if (kind === "end_stop") t += line.layover_s;
    }
    offsets.push(t);
    t += line.legs[k]!.time_s;
  }
  return offsets.map((o) => departures.map((d) => d + o));
}

/** Purpose: count times into clock hours. */
export function byHour(times: readonly number[]): Hourly {
  const h = noHours();
  for (const t of times) h[clockHour(t)]! += 1;
  return h;
}

/**
 * Purpose: a road line as noise sources, one per leg of its circuit with the vehicles entering it in each
 * clock hour. Speed is the leg's planned mean speed unless `speedKmh` gives one per leg; a leg that starts or
 * ends at a stop gets the acceleration zone there.
 */
export function roadLineSources(
  line: RoadLine,
  hourly: readonly Hourly[],
  idPrefix: string,
  speedKmh?: readonly (number | null)[],
): NoiseLine[] {
  const n = line.legs.length;
  const out: NoiseLine[] = [];
  line.legs.forEach((leg, k) => {
    if (leg.coords.length < 2) return;
    const length = polylineLength(leg.coords);
    if (length <= 0) return;
    const stops: number[] = [];
    if (line.points[k]?.kind !== "via") stops.push(0);
    if (line.points[(k + 1) % n]?.kind !== "via") stops.push(length);
    const planned = leg.time_s > 0 ? (length / leg.time_s) * 3.6 : 30;
    const speed = speedKmh?.[k] ?? planned;
    out.push({
      id: `${idPrefix}-leg-${k}`,
      label: line.name,
      mode: line.mode as NoiseMode,
      electric: line.vehicle.energy !== "other",
      vehicle_length_m: line.vehicle.length_m,
      flows: { day: 0, evening: 0, night: 0 },
      hourly: [...(hourly[k] ?? noHours())],
      points: leg.coords,
      speed_kmh: Math.min(Math.max(speed, 5), line.vehicle.max_speed_kmh || 100),
      stops_m: stops,
    });
  });
  return out;
}

/**
 * Purpose: a saved street line's circuit for the noise map, with all its departures of the day, or null when
 * it is not routed or has no service.
 */
export function streetRoadLine(line: SavedStreetLine, index: number): RoadLine | null {
  const r = roadLine(line, index, 0, DAY_END_S, undefined, new Set());
  if (typeof r === "string") return null;
  // `roadLine` takes the battery from the preferences; the noise map needs only whether it is electric.
  return { ...r, vehicle: { ...r.vehicle, energy: lineEnergy(line) } };
}

/** Purpose: the timetabled noise sources of saved street lines: every leg, its vehicles in each clock hour. */
export function timetabledStreetSources(lines: readonly SavedStreetLine[]): NoiseLine[] {
  return lines.flatMap((l, i) => {
    const r = streetRoadLine(l, i);
    if (!r) return [];
    const hourly = legEntryTimes(r).map(byHour);
    return roadLineSources(r, hourly, `street-${i}`);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Railway

/** The parts of the topology export (contracts/rail-topology.schema.json) the noise map reads. */
interface TopologySection {
  id: string;
  source: {
    kind: "track" | "station" | "switch";
    ref: number;
    index: number;
    chainage_m: [number, number] | null;
  };
}

/** Trains of one service line in each clock hour on a stretch of a design track. */
interface Stretch {
  from_m: number;
  to_m: number;
  hourly: Hourly;
}

/**
 * Purpose: the trains of one service line along one design track, from its trains on the track's sections.
 * Each line of a double track has its own sections; at each chainage the trains of all of them add up. A gap
 * between two sections of the same line of track (through a station or a switch, which are sections of their
 * own) takes the trains of the section before it.
 * Inputs: the sections with their trains, chainages on the track's centre line.
 * Output: stretches in chainage order, neighbours with the same trains merged.
 */
export function trackStretches(
  sections: readonly { index: number; from_m: number; to_m: number; hourly: Hourly }[],
): Stretch[] {
  const byIndex = new Map<number, Stretch[]>();
  for (const s of sections) {
    const list = byIndex.get(s.index) ?? [];
    list.push({ from_m: Math.min(s.from_m, s.to_m), to_m: Math.max(s.from_m, s.to_m), hourly: s.hourly });
    byIndex.set(s.index, list);
  }
  // Fill the gaps inside each line of track.
  const filled: Stretch[][] = [];
  for (const list of byIndex.values()) {
    list.sort((a, b) => a.from_m - b.from_m);
    const out: Stretch[] = [];
    for (const s of list) {
      const prev = out[out.length - 1];
      if (prev && s.from_m > prev.to_m) out.push({ from_m: prev.to_m, to_m: s.from_m, hourly: prev.hourly });
      out.push(s);
    }
    filled.push(out);
  }
  const cuts = [...new Set(filled.flat().flatMap((s) => [s.from_m, s.to_m]))].sort((a, b) => a - b);
  const out: Stretch[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i]!, cuts[i + 1]!];
    if (b - a < 0.5) continue;
    const mid = (a + b) / 2;
    const hourly = noHours();
    let any = false;
    for (const list of filled)
      for (const s of list)
        if (s.from_m <= mid && mid < s.to_m) {
          any = true;
          s.hourly.forEach((n, h) => (hourly[h]! += n));
        }
    if (!any || hourly.every((n) => n === 0)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.to_m - a) < 0.5 && prev.hourly.every((n, h) => n === hourly[h])) prev.to_m = b;
    else out.push({ from_m: a, to_m: b, hourly });
  }
  return out;
}

/** Purpose: length of a polyline in [lon, lat], m. */
export function polylineLength(points: readonly LonLat[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distanceM(points[i - 1]!, points[i]!);
  return s;
}

/**
 * Purpose: the part of a polyline between two chainages, with chainages measured on a line of `length_m`
 * (the engine's chainage), scaled onto the polyline's own length.
 */
export function cutPolyline(
  points: readonly LonLat[],
  from_m: number,
  to_m: number,
  length_m: number,
): LonLat[] {
  const own = polylineLength(points);
  if (own <= 0 || points.length < 2) return [];
  const k = length_m > 0 ? own / length_m : 1;
  const [a, b] = [Math.max(0, from_m * k), Math.min(own, to_m * k)];
  if (b - a <= 0) return [];
  const at = (s: number, i: number, s0: number, d: number): LonLat => {
    const p = points[i - 1]!;
    const q = points[i]!;
    const f = d > 0 ? (s - s0) / d : 0;
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  };
  const out: LonLat[] = [];
  let s0 = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceM(points[i - 1]!, points[i]!);
    const s1 = s0 + d;
    if (s1 >= a && s0 <= b) {
      if (!out.length) out.push(s0 >= a ? points[i - 1]! : at(a, i, s0, d));
      if (s1 <= b) out.push(points[i]!);
      else {
        out.push(at(b, i, s0, d));
        break;
      }
    }
    s0 = s1;
  }
  return out.length >= 2 ? out : [];
}

/** Purpose: the part of a line's ranges and speed profile between two chainages, measured from `from_m`. */
function shiftRanges(ranges: readonly NoiseRange[] | undefined, from_m: number, to_m: number): NoiseRange[] {
  return (ranges ?? [])
    .filter((r) => r.to_m > from_m && r.from_m < to_m)
    .map((r) => ({
      ...r,
      from_m: Math.max(r.from_m, from_m) - from_m,
      to_m: Math.min(r.to_m, to_m) - from_m,
    }));
}

function shiftSpeed(
  speed: readonly [number, number][] | undefined,
  from_m: number,
  to_m: number,
): [number, number][] | undefined {
  if (!speed?.length) return undefined;
  const at = (s: number): number => {
    if (s <= speed[0]![0]) return speed[0]![1];
    for (let i = 1; i < speed.length; i++) {
      const [s0, v0] = speed[i - 1]!;
      const [s1, v1] = speed[i]!;
      if (s <= s1) return s1 > s0 ? v0 + ((v1 - v0) * (s - s0)) / (s1 - s0) : v1;
    }
    return speed[speed.length - 1]![1];
  };
  const inside = speed.filter(([s]) => s > from_m && s < to_m);
  return [
    [0, at(from_m)],
    ...inside.map(([s, v]) => [s - from_m, v] as [number, number]),
    [to_m - from_m, at(to_m)],
  ];
}

/**
 * Purpose: the timetabled noise sources of a railway design: for each running track and each service line on
 * it, the stretches the line's trains run on with their trains in each clock hour, at the track's speed profile
 * and with its tunnels, viaducts and switches; the train is the line's catalogue train times its units.
 * Inputs: the document, its build, the trains per section and hour from publishing its lines (`section_trains`)
 * and the topology export of the same build.
 * Output: the sources, and the names of lines that have no trains on the drawn track.
 */
export function timetabledRailSources(
  doc: Network,
  view: RailView,
  sectionTrains: readonly SectionTrains[],
  topology: { sections?: TopologySection[] } | null,
): NoiseLine[] {
  const sections = new Map((topology?.sections ?? []).map((s) => [s.id, s]));
  const lines = new Map<string, ServiceLine>((doc.lines ?? []).map((l) => [l.id, l]));
  // Per design track and service line: its sections with trains.
  const per = new Map<
    string,
    { track: number; line: string; parts: { index: number; from_m: number; to_m: number; hourly: Hourly }[] }
  >();
  for (const st of sectionTrains) {
    const sec = sections.get(st.section);
    if (!sec || sec.source.kind !== "track" || !sec.source.chainage_m) continue;
    const key = `${sec.source.ref}|${st.line}`;
    const entry = per.get(key) ?? { track: sec.source.ref, line: st.line, parts: [] };
    const [a, b] = sec.source.chainage_m;
    entry.parts.push({ index: sec.source.index, from_m: a, to_m: b, hourly: [...st.hours] });
    per.set(key, entry);
  }
  // The track's own sources give the geometry, speed and corrections (with any flows: replaced below).
  const base = new Map(railSources(doc, view, { day: 0, evening: 0, night: 0 }).map((s) => [s.id, s]));
  const out: NoiseLine[] = [];
  for (const { track, line, parts } of per.values()) {
    const src = base.get(`track-${track}`);
    const t = view.tracks.find((x) => x.id === track);
    const l = lines.get(line);
    if (!src || !t || !l) continue;
    const train = trainById(l.vehicle);
    const length = (train?.length_m ?? view.train_length_m ?? 100) * Math.max(1, Math.round(l.units));
    for (const [i, s] of trackStretches(parts).entries()) {
      const points = cutPolyline(src.points, s.from_m, s.to_m, t.length_m);
      if (points.length < 2) continue;
      out.push({
        ...src,
        id: `track-${track}-${line}-${i}`,
        label: [src.label, l.name || l.id].filter(Boolean).join(" · "),
        mode: lineMode(doc, l) as NoiseMode,
        vehicle_length_m: length,
        flows: { day: 0, evening: 0, night: 0 },
        hourly: s.hourly,
        points,
        speed: shiftSpeed(src.speed, s.from_m, s.to_m),
        ranges: shiftRanges(src.ranges, s.from_m, s.to_m),
      });
    }
  }
  return out;
}

/**
 * Purpose: publish a railway's service lines and turn them into timetabled sources with the engine that built
 * `view` (its last build). Lines that cannot be published leave the railway without sources and say why.
 * Output: the sources and notes for the map.
 */
export function publishedRailSources(
  engine: RailEngine,
  doc: Network,
  view: RailView,
): { lines: NoiseLine[]; notes: string[] } {
  const ready = engineLines(doc);
  if (!ready.length)
    return {
      lines: [],
      notes: (doc.lines ?? []).length || doc.tracks.length ? [tNow("noise.noRailService")] : [],
    };
  try {
    const pub = engine.publishLines(ready, "weekday");
    const lines = timetabledRailSources(
      doc,
      view,
      pub.section_trains ?? [],
      engine.topology() as { sections?: TopologySection[] } | null,
    );
    return { lines, notes: lines.length ? [] : [tNow("noise.noRailService")] };
  } catch (err) {
    return {
      lines: [],
      notes: [tNow("noise.railNotPublished", { error: engineErrorText(err) })],
    };
  }
}

/**
 * The replay of a system test on the map: every drawn line's vehicles, trains and street line vehicles, moving
 * together on one clock through the test's period with its warm-up and recovery. It is a replay in the road
 * simulation's format (road-sim/types.ts `Replay`), so the road simulation's player and colours show it.
 *
 * Trains come from the rail engine's replay of the period without random delays (`RailReplay`): the head of
 * each train on a track, placed on the map along the drawn track (place.ts). Street line vehicles run their
 * timetable as in the test's first run with traffic (streetRun.ts `runTrips`), at constant speed along each
 * leg's route and standing at each stop for as long as they stood there. A vehicle is in service from its first
 * departure until it is back after its last trip; before and after, it is parked at its depot (else at the
 * first stop).
 */
import type { Replay } from "../road-sim/types";
import type { SavedStreetLine } from "../street-lines/saved";
import type { LonLat } from "../street-lines/types";
import type { Locate } from "./place";
import {
  circuit,
  departures,
  plannedOffsets,
  random,
  runTrips,
  type Step,
  type StreetRunParams,
} from "./streetRun";
import type { RailReplay } from "./types";

type Vehicle = Replay["vehicles"][number];
type Line = Replay["lines"][number];

/** Time between frames of the replay, s. */
export const REPLAY_FRAME_S = 10;

const RAD = Math.PI / 180;

/** Purpose: the compass bearing from a to b, degrees. */
function bearing(a: LonLat, b: LonLat): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x =
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (((Math.atan2(y, x) / RAD) % 360) + 360) % 360;
}

/** Purpose: rough distance between two points, m (equirectangular). */
function distance(a: LonLat, b: LonLat): number {
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD);
  const y = b[1] - a[1];
  return Math.hypot(x, y) * 111_320;
}

/** Purpose: the point a share `k` (0 to 1) of the way along a polyline, and the bearing there. */
export function alongLine(coords: readonly LonLat[], k: number): { at: LonLat; heading: number } {
  if (coords.length === 0) return { at: [0, 0], heading: 0 };
  if (coords.length === 1) return { at: coords[0]!, heading: 0 };
  const seg = coords.slice(1).map((p, i) => distance(coords[i]!, p));
  const total = seg.reduce((a, b) => a + b, 0);
  let left = Math.max(0, Math.min(1, k)) * total;
  for (let i = 0; i < seg.length; i++) {
    const d = seg[i]!;
    const [a, b] = [coords[i]!, coords[i + 1]!];
    if (left <= d || i === seg.length - 1) {
      const f = d > 0 ? Math.min(1, left / d) : 0;
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b) };
    }
    left -= d;
  }
  return { at: coords.at(-1)!, heading: 0 };
}

/** Purpose: one replay sample: lon·1e5, lat·1e5, heading, speed km/h, no battery. */
const sample = (at: LonLat, heading: number, speedKmh: number) => [
  Math.round(at[0] * 1e5),
  Math.round(at[1] * 1e5),
  Math.round(heading),
  Math.round(speedKmh * 10) / 10,
  -1,
];

/**
 * Purpose: the trains of a rail replay as replay vehicles on a common clock.
 * Inputs: the rail replay, where a chainage of a topology section is on the map, the common first frame (a
 * whole number of frames before or at the rail replay's), the index of its first line in the combined replay.
 * Output: one vehicle per train that has a place on the map.
 */
export function railVehicles(rail: RailReplay, locate: Locate, begin: number, lineBase: number): Vehicle[] {
  const shift = Math.round((rail.begin - begin) / rail.frame_s);
  const out: Vehicle[] = [];
  for (const tr of rail.trains) {
    const at: (LonLat | null)[] = [];
    for (let k = 0; k < rail.frames; k++) {
      const ti = tr.s[k * 3]!;
      const track = ti >= 0 ? rail.tracks[ti] : undefined;
      at.push(track ? locate(track[0], track[1] + tr.s[k * 3 + 1]!) : null);
    }
    const first = at.findIndex((p) => p !== null);
    if (first < 0) continue;
    const s: number[] = [];
    let last = at[first]!;
    let heading = 0;
    for (let k = first; k < rail.frames; k++) {
      const p = at[k] ?? last;
      const next = at.slice(k + 1).find((q) => q !== null && distance(p, q) > 1);
      if (next) heading = bearing(p, next);
      s.push(...sample(p, heading, at[k] ? tr.s[k * 3 + 2]! : 0));
      last = p;
    }
    out.push({
      id: `rail:${tr.vehicle}`,
      line: lineBase + tr.line,
      number: tr.vehicle + 1,
      slot_out: null,
      slot_in: null,
      f0: shift + first,
      s,
      st: tr.st,
    });
  }
  return out;
}

/**
 * Purpose: a street line's vehicles as replay vehicles: its timetable through the period as the test's first
 * run with traffic has it.
 * Inputs: the line, its index among the project's street lines (for the run's random source), its index in
 * the combined replay, the run's settings, and the replay's first frame and frame count.
 * Output: one vehicle per vehicle the timetable needs that runs a trip; none when the line cannot run.
 */
export function streetVehicles(
  line: SavedStreetLine,
  index: number,
  lineIndex: number,
  p: StreetRunParams,
  begin: number,
  frames: number,
): Vehicle[] {
  const steps = circuit(line);
  if (!steps) return [];
  const deps = departures(line, p.from_s - p.warmup_s, p.to_s + p.recovery_s);
  if (!deps.length) return [];
  const planned = plannedOffsets(steps);
  const headway = Math.min(...deps.map((d) => d.headway));
  const vehicles = Math.ceil(planned.at(-1)! / headway);
  const trips = runTrips(line, steps, deps, planned, vehicles, random(p.seed * 7919 + index * 31));
  const home: LonLat = steps.at(-1)!.at;
  const depot = line.view.depot ?? home;
  const out: Vehicle[] = [];
  for (let v = 0; v < vehicles; v++) {
    const mine = trips.filter((x) => x.vehicle === v);
    if (!mine.length) continue;
    const f0 = Math.max(0, Math.ceil((mine[0]!.start - begin) / REPLAY_FRAME_S));
    const end = mine.at(-1)!.arrive.at(-1)!;
    const f1 = Math.min(frames - 1, Math.floor((end - begin) / REPLAY_FRAME_S));
    if (f1 < f0) continue;
    const s: number[] = [];
    let heading = 0;
    for (let f = f0; f <= f1; f++) {
      const t = begin + f * REPLAY_FRAME_S;
      const placed = placeOnTrips(mine, steps, home, t);
      if (placed.moving) heading = placed.heading;
      s.push(...sample(placed.at, heading, placed.speed));
    }
    out.push({
      id: `street:${index}:${v}`,
      line: lineIndex,
      number: v + 1,
      slot_out: depot,
      slot_in: depot,
      f0,
      s,
      st: streetStops(mine, steps, planned),
    });
  }
  return out;
}

/** Purpose: where a street vehicle is at time `t` on its trips, and how fast it goes, km/h. */
function placeOnTrips(
  trips: ReturnType<typeof runTrips>,
  steps: Step[],
  home: LonLat,
  t: number,
): { at: LonLat; heading: number; speed: number; moving: boolean } {
  const still = (at: LonLat) => ({ at, heading: 0, speed: 0, moving: false });
  const trip = [...trips].reverse().find((x) => x.start <= t);
  if (!trip || t >= trip.arrive.at(-1)!) return still(home);
  let from = trip.start;
  for (let i = 0; i < steps.length; i++) {
    const arrive = trip.arrive[i]!;
    if (t < arrive) {
      const s = steps[i]!;
      // The leg's route, else straight from the point before.
      const path = s.coords.length >= 2 ? s.coords : [i === 0 ? home : steps[i - 1]!.at, s.at];
      const span = arrive - from;
      const { at, heading } = alongLine(path, span > 0 ? (t - from) / span : 1);
      const len = path.slice(1).reduce((a, q, j) => a + distance(path[j]!, q), 0);
      return { at, heading, speed: span > 0 ? (len / span) * 3.6 : 0, moving: true };
    }
    if (t < trip.depart[i]!) return still(steps[i]!.at);
    from = trip.depart[i]!;
  }
  return still(home);
}

/**
 * Purpose: a street vehicle's stops in the replay's form (four numbers each: planned departure, arrival,
 * departure, kind): the first stop of each trip (kind 1), its stops along the way (0), and the first stop
 * again after its last trip (2).
 */
function streetStops(trips: ReturnType<typeof runTrips>, steps: Step[], planned: number[]): number[] {
  const st: number[] = [];
  trips.forEach((trip, k) => {
    st.push(trip.at, trip.start, trip.start, 1);
    for (let i = 0; i < steps.length - 1; i++)
      if (steps[i]!.stop) st.push(trip.at + planned[i]!, trip.arrive[i]!, trip.depart[i]!, 0);
    if (k === trips.length - 1) {
      const back = trip.arrive.at(-1)!;
      st.push(trip.at + planned.at(-1)!, back, back, 2);
    }
  });
  return st;
}

/**
 * Purpose: the combined replay of a system test: the trains of the rail replay and the vehicles of the street
 * lines, on one clock from the earlier of the two starts to the later of the two ends.
 * Inputs: the rail replay (null without rail lines) with where a topology chainage is on the map and each rail
 * line's colour by id, the street lines that ran with their index among the project's street lines and their
 * colour, and the street run's settings.
 * Output: the replay, or null when nothing runs.
 */
export function systemReplay(
  rail: { replay: RailReplay; locate: Locate; colors: Record<string, string> } | null,
  streets: readonly { line: SavedStreetLine; index: number; color: string }[],
  p: StreetRunParams,
): Replay | null {
  const streetBegin = p.from_s - p.warmup_s;
  const streetEnd = p.to_s + p.recovery_s;
  const railSpan = rail
    ? [rail.replay.begin, rail.replay.begin + (rail.replay.frames - 1) * rail.replay.frame_s]
    : null;
  const begin = Math.min(streetBegin, railSpan?.[0] ?? Infinity);
  const end = Math.max(streetEnd, railSpan?.[1] ?? -Infinity);
  const frames = Math.floor((end - begin) / REPLAY_FRAME_S) + 1;
  const lines: Line[] = [];
  const vehicles: Vehicle[] = [];
  if (rail) {
    rail.replay.lines.forEach(([id, name], i) =>
      lines.push({ index: i, name, color: rail.colors[id] ?? "#64748b", mode: "rail" }),
    );
    vehicles.push(...railVehicles(rail.replay, rail.locate, begin, 0));
  }
  for (const { line, index, color } of streets) {
    const li = lines.length;
    const own = streetVehicles(line, index, li, p, begin, frames);
    if (!own.length) continue;
    lines.push({ index: li, name: line.name, color, mode: line.profile.mode });
    vehicles.push(...own);
  }
  if (!vehicles.length) return null;
  return { version: 1, begin, frame_s: REPLAY_FRAME_S, frames, lines, vehicles, events: [] };
}

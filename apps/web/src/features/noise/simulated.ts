/**
 * Simulated noise input (ADR-0038 §4, step N3): the street line vehicles of a saved road run. Each vehicle's
 * track in the replay is matched to the legs of its line's circuit; a vehicle entering a leg counts in the clock
 * hour it enters, and the leg's speed is the mean of the vehicles' speeds on it while moving. Hours the run
 * does not cover in full keep the timetable (product owner, 2026-11-16); railways keep their timetable, as the rail
 * capacity run keeps no train positions.
 */
import type { Replay, RoadLine, RoadParams, RoadScenario } from "../road-sim/types";
import type { SavedStreetLine } from "../street-lines/saved";
import type { LonLat } from "../street-lines/types";
import {
  byHour,
  clockHour,
  type Hourly,
  legEntryTimes,
  noHours,
  roadLineSources,
  streetRoadLine,
} from "./timetabled";
import type { NoiseLine } from "./types";

/** A replay sample matches a leg within this distance, m (a lane or two off the routed centre line). */
const MATCH_M = 30;
/** …and when the vehicle heads within this angle of the leg's direction there, degrees. */
const MATCH_DEG = 60;
/** Leg points are this far apart, m. */
const STEP_M = 10;
/** Samples slower than this are standing (at a stop or a light) and left out of the mean speed, km/h. */
const MOVING_KMH = 1;

interface LegPoint {
  x: number;
  y: number;
  /** Compass bearing of the leg there, degrees clockwise from north. */
  bearing: number;
  leg: number;
}

/** Local metres round an origin (equirectangular, fine over a city). */
function projector(origin: LonLat) {
  const kx = Math.cos((origin[1] * Math.PI) / 180) * 111_320;
  return (p: LonLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * 111_320];
}

/** Purpose: points every `STEP_M` along each leg, with the leg's bearing, in a grid of `MATCH_M` cells. */
function legIndex(line: RoadLine, local: (p: LonLat) => [number, number]) {
  const cells = new Map<string, LegPoint[]>();
  const key = (x: number, y: number) => `${Math.floor(x / MATCH_M)},${Math.floor(y / MATCH_M)}`;
  line.legs.forEach((leg, k) => {
    for (let i = 1; i < leg.coords.length; i++) {
      const [x0, y0] = local(leg.coords[i - 1]!);
      const [x1, y1] = local(leg.coords[i]!);
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d <= 0) continue;
      const bearing = ((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI + 360) % 360;
      for (let s = 0; s <= d; s += STEP_M) {
        const p = { x: x0 + ((x1 - x0) * s) / d, y: y0 + ((y1 - y0) * s) / d, bearing, leg: k };
        const c = key(p.x, p.y);
        const list = cells.get(c) ?? [];
        list.push(p);
        cells.set(c, list);
      }
    }
  });
  return (x: number, y: number, heading: number): number | null => {
    const cx = Math.floor(x / MATCH_M);
    const cy = Math.floor(y / MATCH_M);
    let best: LegPoint | null = null;
    let bestD = MATCH_M;
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (const p of cells.get(`${i},${j}`) ?? []) {
          const turn = Math.abs(((heading - p.bearing + 540) % 360) - 180);
          if (turn > MATCH_DEG) continue;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) [best, bestD] = [p, d];
        }
    return best?.leg ?? null;
  };
}

/** What a run says about one of its lines. */
export interface RunLineCounts {
  /** Vehicles entering each leg in each clock hour the run covers in full. */
  hourly: Hourly[];
  /** Mean moving speed on each leg, km/h; null where no vehicle was seen moving. */
  speed: (number | null)[];
}

/**
 * Purpose: the clock hours a run covers in full: those inside both its period and its replay.
 * Output: hours 0–23 (a run past midnight covers early hours).
 */
export function coveredHours(replay: Replay, params: Pick<RoadParams, "from_s" | "to_s">): number[] {
  const begin = Math.max(params.from_s, replay.begin);
  const end = Math.min(params.to_s, replay.begin + Math.max(0, replay.frames - 1) * replay.frame_s);
  const out = new Set<number>();
  for (let h = Math.ceil(begin / 3600); (h + 1) * 3600 <= end; h++) out.add(clockHour(h * 3600));
  return [...out].sort((a, b) => a - b);
}

/**
 * Purpose: count the vehicles of one line of a run on each leg of its circuit by clock hour, and their mean
 * moving speed on each leg, from the replay.
 * Inputs: the run's line (its legs as routed for the run), the replay and the hours to count.
 */
export function countRunLine(line: RoadLine, replay: Replay, hours: readonly number[]): RunLineCounts {
  const legs = line.legs.length;
  const hourly = Array.from({ length: legs }, noHours);
  const sum = new Array<number>(legs).fill(0);
  const n = new Array<number>(legs).fill(0);
  const first = line.legs.find((l) => l.coords.length)?.coords[0];
  if (!first) return { hourly, speed: new Array(legs).fill(null) };
  const local = projector(first);
  const match = legIndex(line, local);
  const counted = new Set(hours);
  for (const v of replay.vehicles) {
    if (v.line !== line.index || v.f0 < 0) continue;
    let prev: number | null = null;
    for (let i = 0; i + 4 < v.s.length; i += 5) {
      const [x, y] = local([v.s[i]! / 1e5, v.s[i + 1]! / 1e5]);
      const leg = match(x, y, v.s[i + 2]!);
      if (leg === null) continue;
      const speed = v.s[i + 3]!;
      if (speed >= MOVING_KMH) {
        sum[leg]! += speed;
        n[leg]! += 1;
      }
      if (leg !== prev) {
        const t = replay.begin + (v.f0 + i / 5) * replay.frame_s;
        const h = clockHour(t);
        if (counted.has(h)) hourly[leg]![h]! += 1;
        prev = leg;
      }
    }
  }
  return { hourly, speed: sum.map((s, k) => (n[k]! ? s / n[k]! : null)) };
}

/** A road run as the noise map takes it. */
export interface RunInput {
  scenario: RoadScenario;
  replay: Replay;
  params: Pick<RoadParams, "from_s" | "to_s">;
}

/**
 * Purpose: the simulated noise sources of the street lines: the run's lines on their routed legs, with the
 * vehicles the run counted in the hours it covers and the timetable of the scenario's street line with the same
 * number in the other hours (none when the scenario has no such line).
 * Output: the sources, the hours the run covered, and the names of run lines without a timetable for the
 * other hours.
 */
export function simulatedStreetSources(
  run: RunInput,
  streetLines: readonly SavedStreetLine[],
): { lines: NoiseLine[]; hours: number[]; noTimetable: string[] } {
  const hours = coveredHours(run.replay, run.params);
  const covered = new Set(hours);
  const lines: NoiseLine[] = [];
  const noTimetable: string[] = [];
  for (const rl of run.scenario.lines) {
    const counts = countRunLine(rl, run.replay, hours);
    const saved = streetLines[rl.index];
    const planned = saved ? streetRoadLine(saved, rl.index) : null;
    if (!planned && covered.size < 24) noTimetable.push(rl.name);
    // The timetable's departures round the run's own circuit, for the hours the run does not cover.
    const timetable = planned
      ? legEntryTimes({ ...rl, departures: planned.departures }).map(byHour)
      : rl.legs.map(noHours);
    const hourly = counts.hourly.map((h, k) =>
      h.map((n, hour) => (covered.has(hour) ? n : (timetable[k]?.[hour] ?? 0))),
    );
    lines.push(...roadLineSources(rl, hourly, `run-${rl.index}`, counts.speed));
  }
  return { lines, hours, noTimetable };
}

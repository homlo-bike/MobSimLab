/**
 * The street line part of the system test: each street line's timetable run along its route, again and
 * again, with the delays of main-road traffic varying from trip to trip.
 *
 * The timetable is the one the journey planner rides (`streetLineTimetable`): a departure from the first
 * end stop every headway (half of it in the peak windows), the circuit's legs at their routed running times,
 * the line's dwell at every stop and its layover at every end stop. A vehicle runs the whole circuit and takes
 * the next departure that is due once it is back; at an end stop it waits for its scheduled departure, so the
 * layover soaks up delay. Each trip meets its own traffic: the routed delay in main-road traffic (from the
 * project's `street.mixed_traffic_delay_share` and `street.bus_lane_delay_share`) is scaled by a factor drawn
 * between the assumption's low and high ends (triangular, most likely the central value).
 */
import { DEFAULT_SERVICE_DAY, servicePeriods, type ServiceDay } from "../journey-planner/network";
import type { SavedStreetLine } from "../street-lines/saved";

/** Settings of the street run (the capacity run's names, so one settings panel serves both). */
export interface StreetRunParams {
  from_s: number;
  to_s: number;
  /** Service before the period, so the line is full when it starts, s. */
  warmup_s: number;
  /** Service after the period, to see whether delays die out, s. */
  recovery_s: number;
  /** Runs with varying traffic. */
  stability_runs: number;
  seed: number;
  /** A departure later than this is late, s. */
  late_threshold_s: number;
  /** Delays die out when less than this is left on average at the end, s. */
  residual_delay_s: number;
}

export const STREET_RUN_DEFAULTS: Omit<StreetRunParams, "from_s" | "to_s"> = {
  warmup_s: 1800,
  recovery_s: 1800,
  stability_runs: 8,
  seed: 1,
  late_threshold_s: 120,
  residual_delay_s: 30,
};

/**
 * Traffic delay of one trip as a multiple of the expected one: `street.mixed_traffic_delay_share` low 0.1,
 * central 0.25, high 0.5 (assumptions/parameters/streets-depots.yaml), so between 0.4 and 2 times.
 */
export const TRAFFIC_FACTOR: [number, number, number] = [0.1 / 0.25, 1, 0.5 / 0.25];

/** The result for one street line. */
export interface StreetLineResult {
  /** Index of the line in the project's street lines. */
  index: number;
  name: string;
  mode: string;
  /** Planned headway in the period (the shortest), s. */
  headway_s: number;
  /** Departures per hour in the period's busiest hour (each runs the whole circuit). */
  per_hour: number;
  /** Planned circuit time with dwell and layover, s. */
  cycle_s: number;
  /** Of the circuit's running time, the expected delay in traffic, s. */
  traffic_delay_s: number;
  /** Vehicles the timetable needs at the shortest headway. */
  vehicles: number;
  /** Trips that start in the period (one run). */
  trips: number;
  /** Share of stop departures in the period no later than the late threshold (all runs). */
  punctuality: number;
  /** Average delay of stop departures in the period, s. */
  mean_delay_s: number;
  /** 95th percentile of the delay of stop departures in the period, s. */
  p95_delay_s: number;
  /** Average circuit time as run, s (with traffic, without waiting at the first stop). */
  run_cycle_s: number;
  /** Share of gaps between following vehicles shorter than half the planned gap (bunching). */
  bunched_share: number;
  /** Average delay left at the end of the service after the period, s. */
  residual_delay_s: number;
  /** Delays die out after the period. */
  stable: boolean;
}

/** A stop or via point on the circuit as the run sees it. */
interface Step {
  /** Running time of the leg to this point: without traffic, and its expected traffic delay, s. */
  free_s: number;
  traffic_s: number;
  /** Planned stop time here (dwell, plus layover at an end stop), s; 0 at a via point. */
  stop_s: number;
  /** The vehicle waits here for its scheduled departure. */
  end: boolean;
  stop: boolean;
  name: string;
}

/** Purpose: a stop's name as the journey planner and the Tables tab give it. */
export function stopName(p: { name: string; seq: number }): string {
  return p.name || `Stop ${p.seq + 1}`;
}

/** Purpose: a seeded random source (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Purpose: a draw from the triangular distribution [low, mode, high]. */
export function triangular(u: number, [lo, mode, hi]: [number, number, number]): number {
  const c = (mode - lo) / (hi - lo);
  return u < c
    ? lo + Math.sqrt(u * (hi - lo) * (mode - lo))
    : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

/**
 * Purpose: the circuit from its first end stop (else its first point): each point after a leg, with the leg's
 * running time and what the vehicle does there. The first point is the last step (the vehicle comes back).
 * Output: the steps, or null when the line has fewer than two stops or no routed legs.
 */
export function circuit(line: SavedStreetLine): Step[] | null {
  const v = line.view;
  const n = v.points.length;
  if (n < 2 || v.legs.length < n) return null;
  if (v.points.filter((p) => p.kind !== "via").length < 2) return null;
  const startAt = Math.max(
    0,
    v.points.findIndex((p) => p.kind === "end_stop"),
  );
  const steps: Step[] = [];
  for (let k = 1; k <= n; k++) {
    const leg = v.legs[(startAt + k - 1) % n]!;
    const p = v.points[(startAt + k) % n]!;
    const traffic = Math.max(0, leg.traffic_delay_s ?? 0);
    const stop = p.kind !== "via";
    const end = p.kind === "end_stop";
    steps.push({
      free_s: Math.max(0, leg.time_s - traffic),
      traffic_s: traffic,
      stop_s: (stop ? line.timing.dwellS : 0) + (end ? line.timing.layoverMin * 60 : 0),
      end,
      stop,
      name: stopName(p),
    });
  }
  return steps;
}

/** Purpose: the departures from the first end stop in a window, as the journey planner's timetable has them. */
export function departures(
  line: SavedStreetLine,
  fromS: number,
  toS: number,
  day: ServiceDay = DEFAULT_SERVICE_DAY,
): { at: number; headway: number }[] {
  const off = Math.max(1, Math.round(line.timing.headwayMin * 60));
  const peak = Math.max(60, Math.round(off / 2));
  const out: { at: number; headway: number }[] = [];
  for (const p of servicePeriods(day, peak, off)) {
    for (let t = p.start_time; t < p.end_time; t += p.headway_secs)
      if (t >= fromS && t < toS) out.push({ at: t, headway: p.headway_secs });
  }
  return out;
}

/**
 * Purpose: run one street line's timetable through the period with traffic that varies from trip to trip.
 * Inputs: the line, its index among the project's street lines, the settings.
 * Output: the result, or null when the line cannot run (fewer than two stops, not routed, no service).
 */
export function runStreetLine(
  line: SavedStreetLine,
  index: number,
  p: StreetRunParams,
): StreetLineResult | null {
  const steps = circuit(line);
  if (!steps) return null;
  const start = p.from_s - p.warmup_s;
  const end = p.to_s + p.recovery_s;
  const deps = departures(line, start, end);
  const inPeriod = deps.filter((d) => d.at >= p.from_s && d.at < p.to_s);
  if (!inPeriod.length) return null;
  const firstStop = line.timing.dwellS + (steps.at(-1)!.end ? line.timing.layoverMin * 60 : 0);
  // The planned offset of each step's departure from the trip's start.
  const planned: number[] = [];
  let t = 0;
  for (const s of steps) {
    t += s.free_s + s.traffic_s + s.stop_s;
    planned.push(t);
  }
  const cycle = planned.at(-1)!;
  const headway = Math.min(...inPeriod.map((d) => d.headway));
  const vehicles = Math.ceil(cycle / headway);
  const runCycleBase = cycle - firstStop;
  // The busiest hour's departures.
  let perHour = 0;
  for (let h = Math.floor(p.from_s / 3600) * 3600; h < p.to_s; h += 3600)
    perHour = Math.max(perHour, inPeriod.filter((d) => d.at >= h && d.at < h + 3600).length);

  const delays: number[] = [];
  const residual: number[] = [];
  let gaps = 0;
  let bunched = 0;
  let cycles = 0;
  let cycleSum = 0;
  const runs = Math.max(1, Math.round(p.stability_runs));
  for (let r = 0; r < runs; r++) {
    const rnd = random(p.seed * 7919 + r * 104729 + index * 31);
    // When each vehicle is back at the first stop and ready.
    const free: number[] = new Array<number>(vehicles).fill(-Infinity);
    // Actual and planned departure times of every trip at every stop step.
    const act: number[][] = steps.map(() => []);
    const plan: number[][] = steps.map(() => []);
    for (const d of deps) {
      let v = 0;
      for (let i = 1; i < free.length; i++) if (free[i]! < free[v]!) v = i;
      const f = triangular(rnd(), TRAFFIC_FACTOR);
      let at = Math.max(d.at, free[v]!);
      const left = at;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        at += s.free_s + s.traffic_s * f;
        if (i === steps.length - 1) {
          cycles++;
          cycleSum += at - left;
          // Back at the first stop: ready after the dwell; the layover there is slack before the next trip.
          free[v] = at + line.timing.dwellS;
          break;
        }
        const dep = s.end ? Math.max(at + line.timing.dwellS, d.at + planned[i]!) : at + s.stop_s;
        at = dep;
        if (s.stop) {
          act[i]!.push(dep);
          plan[i]!.push(d.at + planned[i]!);
        }
      }
    }
    for (let i = 0; i < steps.length; i++) {
      const a = act[i]!;
      const pl = plan[i]!;
      for (let k = 0; k < a.length; k++) {
        const late = a[k]! - pl[k]!;
        if (pl[k]! >= p.from_s && pl[k]! < p.to_s) delays.push(late);
        if (pl[k]! >= end - 900 && pl[k]! < end) residual.push(Math.max(0, late));
      }
      const order = a.map((x, k) => [x, pl[k]!] as const).sort((x, y) => x[0] - y[0]);
      for (let k = 1; k < order.length; k++) {
        const [x, px] = order[k]!;
        const [y, py] = order[k - 1]!;
        if (px < p.from_s || px >= p.to_s) continue;
        gaps++;
        if (x - y < 0.5 * Math.abs(px - py)) bunched++;
      }
    }
  }
  const sorted = [...delays].sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const res = mean(residual);
  return {
    index,
    name: line.name,
    mode: line.profile.mode,
    headway_s: headway,
    per_hour: perHour,
    cycle_s: cycle,
    traffic_delay_s: steps.reduce((a, s) => a + s.traffic_s, 0),
    vehicles,
    trips: inPeriod.length,
    punctuality: delays.length ? delays.filter((d) => d <= p.late_threshold_s).length / delays.length : 1,
    mean_delay_s: Math.max(0, mean(delays)),
    p95_delay_s: Math.max(0, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
    run_cycle_s: cycles ? cycleSum / cycles : runCycleBase,
    bunched_share: gaps ? bunched / gaps : 0,
    residual_delay_s: res,
    stable: res < p.residual_delay_s,
  };
}

/**
 * Purpose: the stop names of a street line as passengers ride it: one list per direction when the router
 * found the line's directions (between its end stops), else the circuit as a loop from its first end stop.
 */
export function streetStops(line: SavedStreetLine): { sequences: string[][]; loop: boolean } {
  const v = line.view;
  const byId = new Map(v.points.map((p) => [p.id, p]));
  const dirs = v.directions
    .map((d) =>
      d.stops
        .map((id) => byId.get(id))
        .filter((p) => p && p.kind !== "via")
        .map((p) => stopName(p!)),
    )
    .filter((s) => s.length >= 2);
  if (dirs.length >= 2) return { sequences: dirs, loop: false };
  const steps = circuit(line) ?? [];
  const loop = steps.filter((s) => s.stop).map((s) => s.name);
  // The circuit's steps end with the first stop; passengers start there.
  if (loop.length) loop.unshift(loop.pop()!);
  return { sequences: loop.length >= 2 ? [loop] : [], loop: true };
}

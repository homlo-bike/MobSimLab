/**
 * Vehicle blocks (vehicle schedules, FR-TT-04, ADR-0032 §3 step 6): the runs one vehicle makes in a day, from
 * its pull-out to its pull-in, and the fleet the blocks need with the spare vehicles.
 *
 * Rail blocks come from the rail timetable planner (`rail_plan::VehicleBlock`). Street lines (bus, BRT,
 * trolleybus, intercity bus) are chained here: the line runs as a closed circuit, so a vehicle that finishes
 * direction `d` takes the next departure of direction `d + 1` that leaves at least the line's layover after its
 * arrival (the shortest layover first, as the rail planner does). A vehicle that would wait longer than the
 * project's longest terminal wait returns to the depot when the line has a depot run from that terminal, and
 * vehicles in the depot are pulled out again before new ones.
 */
import { streetLineTimetable, type StreetLineInput } from "../journey-planner/network";
import type { FrequencyPattern, Period, Timetable } from "../journey-planner/types";
import type { RailVehicleBlock } from "../railways/types";
import type { LineView } from "../street-lines/types";

export type BlockRunKind = "service" | "pull_out" | "pull_in";

/** One run of a block. */
export interface BlockRun {
  kind: BlockRunKind;
  /** Trip id (the journey planner's for a passenger trip). */
  trip: string;
  direction: number;
  /** Stop or station name; null for the depot. */
  from: string | null;
  to: string | null;
  departS: number;
  arriveS: number;
  km: number;
}

/** The runs one vehicle makes in a day. */
export interface VehicleBlock {
  /** Block number within its line, from 1, in order of the first departure. */
  n: number;
  /** Line name. */
  line: string;
  mode: string;
  runs: BlockRun[];
}

/** What a block amounts to. */
export interface BlockSummary {
  /** First departure (pull-out or trip), s after midnight. */
  startS: number;
  /** Last arrival, s after midnight. */
  endS: number;
  /** Passenger trips. */
  trips: number;
  /** Time on passenger trips, s. */
  serviceS: number;
  /** Time on depot runs, s. */
  emptyS: number;
  /** Distance on passenger trips, km. */
  serviceKm: number;
  /** Distance on depot runs, km. */
  emptyKm: number;
}

/** Purpose: the totals of a block. */
export function blockSummary(b: VehicleBlock): BlockSummary {
  const out: BlockSummary = {
    startS: b.runs[0]?.departS ?? 0,
    endS: b.runs[b.runs.length - 1]?.arriveS ?? 0,
    trips: 0,
    serviceS: 0,
    emptyS: 0,
    serviceKm: 0,
    emptyKm: 0,
  };
  for (const r of b.runs) {
    const s = Math.max(0, r.arriveS - r.departS);
    if (r.kind === "service") {
      out.trips++;
      out.serviceS += s;
      out.serviceKm += r.km;
    } else {
      out.emptyS += s;
      out.emptyKm += r.km;
    }
  }
  return out;
}

/** The fleet of one line. */
export interface FleetRow {
  line: string;
  mode: string;
  /** Vehicles in service: one per block (trains for rail). */
  blocks: number;
  /** Units coupled per train (1 for street vehicles). */
  units: number;
  /** Spare vehicles as a share of the vehicles in service. */
  spareShare: number;
  /** Vehicles to own: blocks plus spares, rounded up, times the units per train. */
  fleet: number;
  trips: number;
  /** Vehicle-hours from pull-out to pull-in (time in the depot between runs left out). */
  vehicleHours: number;
  serviceKm: number;
  emptyKm: number;
}

/** Purpose: a line's fleet: one vehicle per block, plus `spareShare` of them as spares (ADR-0032 §3 step 6). */
export function fleetRow(
  line: string,
  mode: string,
  blocks: readonly VehicleBlock[],
  spareShare: number,
  units = 1,
): FleetRow {
  let trips = 0;
  let seconds = 0;
  let serviceKm = 0;
  let emptyKm = 0;
  for (const b of blocks) {
    const s = blockSummary(b);
    trips += s.trips;
    seconds += s.serviceS + s.emptyS + layoverSeconds(b);
    serviceKm += s.serviceKm;
    emptyKm += s.emptyKm;
  }
  const share = Number.isFinite(spareShare) && spareShare > 0 ? spareShare : 0;
  return {
    line,
    mode,
    blocks: blocks.length,
    units: Math.max(1, Math.round(units)),
    spareShare: share,
    // A small tolerance keeps 20 × 1.15 at 23, not 24.
    fleet: blocks.length ? Math.ceil(blocks.length * (1 + share) - 1e-9) * Math.max(1, Math.round(units)) : 0,
    trips,
    vehicleHours: seconds / 3600,
    serviceKm,
    emptyKm,
  };
}

/** Purpose: time a block stands at terminals between runs, s (not time in the depot). */
function layoverSeconds(b: VehicleBlock): number {
  let s = 0;
  for (let i = 1; i < b.runs.length; i++) {
    const prev = b.runs[i - 1]!;
    const next = b.runs[i]!;
    // Between a pull-in and the next pull-out the vehicle is in the depot.
    if (prev.kind === "pull_in" && next.kind === "pull_out") continue;
    s += Math.max(0, next.departS - prev.arriveS);
  }
  return s;
}

/** Purpose: the rail planner's blocks of one line in this module's form, numbered by first departure. */
export function railBlocks(
  blocks: readonly RailVehicleBlock[],
  lineId: string,
  lineName: string,
  mode: string,
): VehicleBlock[] {
  return blocks
    .filter((b) => b.runs.some((r) => r.kind === "service" && r.line === lineId))
    .map((b) => b.runs)
    .sort((a, b) => (a[0]?.depart_s ?? 0) - (b[0]?.depart_s ?? 0))
    .map((runs, i) => ({
      n: i + 1,
      line: lineName,
      mode,
      runs: runs.map((r) => ({
        kind: r.kind,
        trip: r.trip,
        direction: r.direction,
        from: r.from,
        to: r.to,
        departS: r.depart_s,
        arriveS: r.arrive_s,
        km: r.km,
      })),
    }));
}

/** Purpose: departures at the first stop of a frequency pattern, as the journey planner expands them. */
export function patternDepartures(periods: readonly Period[]): number[] {
  const out: number[] = [];
  for (const p of periods) {
    const h = p.headway_secs;
    if (!(h > 0) || p.end_time <= p.start_time) continue;
    const off = (p.offset_secs ?? p.start_time) % h;
    let t = p.start_time + ((off + h - (p.start_time % h)) % h);
    for (; t < p.end_time; t += h) out.push(t);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Purpose: running time of a pattern from its first departure to the arrival at its last stop, s. */
export function patternRunS(p: FrequencyPattern): number {
  let t = 0;
  p.stops.forEach((s, i) => {
    if (i === 0) return;
    t += s.run_time;
    if (i < p.stops.length - 1) t += s.dwell_time;
  });
  return t;
}

/** A street line as the block builder needs it. */
export interface StreetBlockInput {
  line: StreetLineInput;
  /** Minimum layover at the end of each trip, min. */
  layoverMin: number;
  /** Whether the line has a depot (its depot runs start and end the blocks). */
  hasDepot: boolean;
  /** Longest a vehicle waits at a terminal before it returns to the depot, min. */
  maxWaitMin: number;
  /** The timetable to chain (the line's own when absent), so blocks match a day type's service. */
  timetable?: Timetable | null;
}

interface Waiting {
  block: number;
  /** Arrival at the terminal, s. */
  arriveS: number;
  /** Direction it can take next. */
  next: number;
}

/**
 * Purpose: chain a street line's trips into vehicle blocks.
 * Output: the blocks, numbered by first departure; empty for a line without service.
 */
export function streetBlocks(input: StreetBlockInput): VehicleBlock[] {
  const { line } = input;
  const tt = input.timetable ?? streetLineTimetable(line);
  if (!tt) return [];
  const prefix = `street-${line.name}`;
  const patterns = tt.frequency_patterns
    .filter((p) => p.route_id === prefix && p.stops.length >= 2)
    .sort((a, b) => (a.direction_id ?? 0) - (b.direction_id ?? 0));
  if (!patterns.length) return [];
  const v: LineView = line.view;
  const names = new Map(tt.stops.map((s) => [s.stop_id, s.stop_name]));
  const pointOf = (stopId: string) => Number(stopId.slice(prefix.length + 1));
  const dirKm = (d: number) => (v.directions.find((x) => x.direction === d)?.length_m ?? v.length_m) / 1000;
  const n = patterns.length;
  const layoverS = Math.max(0, input.layoverMin) * 60;
  const maxWaitS = Math.max(0, input.maxWaitMin) * 60;
  const depot = (kind: "pull_out" | "pull_in") =>
    input.hasDepot
      ? v.depot_trips.find((t) => t.kind === kind && t.status !== "error" && t.coords.length >= 2)
      : undefined;
  const pullOut = depot("pull_out");
  const pullIn = depot("pull_in");
  // Which pattern a depot run serves: the pull-out reaches a pattern's first stop, the pull-in leaves its last.
  const outTo = pullOut ? patterns.findIndex((p) => pointOf(p.stops[0]!.stop_id) === pullOut.stop) : -1;
  const inFrom = pullIn
    ? patterns.findIndex((p) => pointOf(p.stops[p.stops.length - 1]!.stop_id) === pullIn.stop)
    : -1;

  // Every trip, in order of departure.
  const trips = patterns
    .flatMap((p, i) => {
      const run = patternRunS(p);
      return patternDepartures(p.periods).map((dep) => ({ i, p, dep, arr: dep + run }));
    })
    .sort((a, b) => a.dep - b.dep || a.i - b.i);

  const runs: BlockRun[][] = [];
  let waiting: Waiting[] = [];
  /** Vehicles in the depot: block and when it is back. */
  const inDepot: { block: number; backS: number }[] = [];

  const sendIn = (w: Waiting) => {
    const from = patterns[(w.next - 1 + n) % n]!;
    const last = from.stops[from.stops.length - 1]!.stop_id;
    const dep = w.arriveS + Math.min(layoverS, 60);
    const arr = dep + pullIn!.time_s;
    runs[w.block]!.push({
      kind: "pull_in",
      trip: `${prefix}:pull-in@${Math.round(dep)}`,
      direction: from.direction_id ?? 0,
      from: names.get(last) ?? null,
      to: null,
      departS: dep,
      arriveS: arr,
      km: pullIn!.length_m / 1000,
    });
    inDepot.push({ block: w.block, backS: arr });
  };
  // Pull-ins are possible from the vehicle's terminal only, and only when vehicles can come out again: without a
  // usable pull-out (its run failed, or it reaches no terminal) a vehicle sent in would be lost for the day, and
  // every later trip would need a new one.
  const canPullIn = (w: Waiting) => inFrom >= 0 && outTo >= 0 && (w.next - 1 + n) % n === inFrom;

  for (const t of trips) {
    // Vehicles that would wait too long for their next trip go back to the depot.
    if (pullIn)
      waiting = waiting.filter((w) => {
        if (t.dep - w.arriveS <= maxWaitS || !canPullIn(w)) return true;
        sendIn(w);
        return false;
      });
    // The vehicle that arrived last and still makes its layover (the shortest layover).
    let pick = -1;
    for (let k = 0; k < waiting.length; k++) {
      const w = waiting[k]!;
      if (w.next !== t.i || w.arriveS + layoverS > t.dep) continue;
      if (pick < 0 || w.arriveS > waiting[pick]!.arriveS) pick = k;
    }
    let block: number;
    if (pick >= 0) {
      block = waiting[pick]!.block;
      waiting.splice(pick, 1);
    } else if (pullOut && outTo === t.i) {
      const leave = t.dep - pullOut.time_s;
      // A vehicle back in the depot in time, the one that has been there longest; else a new one.
      let k = -1;
      for (let j = 0; j < inDepot.length; j++)
        if (inDepot[j]!.backS <= leave && (k < 0 || inDepot[j]!.backS < inDepot[k]!.backS)) k = j;
      if (k >= 0) {
        block = inDepot[k]!.block;
        inDepot.splice(k, 1);
      } else {
        block = runs.length;
        runs.push([]);
      }
      runs[block]!.push({
        kind: "pull_out",
        trip: `${prefix}:pull-out@${Math.round(leave)}`,
        direction: t.p.direction_id ?? 0,
        from: null,
        to: names.get(t.p.stops[0]!.stop_id) ?? null,
        departS: leave,
        arriveS: t.dep,
        km: pullOut.length_m / 1000,
      });
    } else {
      block = runs.length;
      runs.push([]);
    }
    runs[block]!.push({
      kind: "service",
      trip: `${t.p.pattern_id}@${t.dep}`,
      direction: t.p.direction_id ?? 0,
      from: names.get(t.p.stops[0]!.stop_id) ?? null,
      to: names.get(t.p.stops[t.p.stops.length - 1]!.stop_id) ?? null,
      departS: t.dep,
      arriveS: t.arr,
      km: dirKm(t.p.direction_id ?? 0),
    });
    waiting.push({ block, arriveS: t.arr, next: (t.i + 1) % n });
  }
  // At the end of the day every vehicle that can goes back to the depot.
  if (pullIn) for (const w of waiting) if (canPullIn(w)) sendIn(w);

  return runs
    .filter((r) => r.length)
    .map((r) => r.sort((a, b) => a.departS - b.departS))
    .sort((a, b) => a[0]!.departS - b[0]!.departS)
    .map((r, i) => ({ n: i + 1, line: line.name, mode: line.mode, runs: r }));
}

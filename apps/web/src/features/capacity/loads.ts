/**
 * Passenger loads of a line in the system test: who rides where, how full the vehicles get at the busiest
 * point, and how many people are left behind when they are full.
 *
 * Boardings per stop are a weekday's, from the Tables tab's ridership estimate or the planner's own number
 * (ADR-0040). An hour in a peak window (07–09, 16–19) carries `benefit.ridership.peak_hour_share` of them;
 * the rest of the day is spread evenly over the other service hours. People who board at a stop ride to the
 * line's other stops in proportion to those stops' boardings (a gravity split within the line). In a peak
 * hour the busier direction carries `benefit.ridership.peak_direction_share` of the riders; a loop line is
 * not split. The load at the busiest link, divided by the vehicles that pass it in the hour, is compared with
 * a vehicle's places; whoever does not fit is left behind for the next one.
 */
import { projectServiceDay, type ServiceDay } from "../journey-planner/network";

/** A line as the load model sees it. */
export interface LoadLine {
  id: string;
  name: string;
  /** Stop names in riding order, one list per direction (a loop has one, ridden round). */
  sequences: string[][];
  loop: boolean;
  /** Weekday boardings at each stop of this line, by stop name. */
  boardings: Record<string, number>;
  /** Places per vehicle (seats and standing at the planning density). */
  capacity: number;
  /** Vehicles per hour on each link, in one direction, for the hour starting at `hourS`. */
  perHour: (hourS: number) => number;
}

export interface LoadShares {
  peakHour: number;
  peakDirection: number;
}

/** The busiest point of a line in one hour. */
export interface HourLoad {
  /** Start of the hour, s after midnight. */
  hour_s: number;
  from: string;
  to: string;
  /** Riders on the busiest link in the hour. */
  riders: number;
  /** Places on that link in the hour. */
  places: number;
  /** riders / places. */
  occupancy: number;
  /** Riders on the busiest link who could not board the first vehicle (vehicles full). */
  left_behind: number;
}

/** Riders on one link (stop to next stop, one direction) in one hour. */
export interface LinkLoad {
  from: string;
  to: string;
  riders: number;
  places: number;
  /** riders / places. */
  occupancy: number;
}

export interface LineLoad {
  id: string;
  name: string;
  /** Weekday boardings of the line. */
  daily: number;
  /** The busiest hour of the period (highest occupancy). */
  busiest: HourLoad | null;
  /** Riders left behind on the busiest links over the whole period. */
  left_behind: number;
  /** Every link of the busiest hour, both directions (for the crowding map; absent in older results). */
  links?: LinkLoad[];
  /** Stops without any boardings (no estimate and no number of the planner's). */
  missing: string[];
  /** A train line's longest stop, where busy stops make it longer than the line's usual dwell. */
  dwell?: { station: string; dwell_s: number; usual_s: number };
}

/** Purpose: the share of a weekday's boardings in the hour starting at `hourS`. */
export function hourShare(hourS: number, shares: LoadShares, day: ServiceDay = projectServiceDay()): number {
  const mid = hourS + 1800;
  const inService = mid >= day.firstS && mid < day.lastS;
  if (!inService) return 0;
  const peakHours = day.peaks.reduce((a, [x, y]) => a + (y - x) / 3600, 0);
  const serviceHours = (day.lastS - day.firstS) / 3600;
  if (day.peaks.some(([x, y]) => mid >= x && mid < y)) return shares.peakHour;
  return Math.max(0, 1 - peakHours * shares.peakHour) / Math.max(1, serviceHours - peakHours);
}

const isPeak = (hourS: number, day: ServiceDay) =>
  day.peaks.some(([x, y]) => hourS + 1800 >= x && hourS + 1800 < y);

/** Riders of one hour, per direction: on each link, and boarding and alighting at each stop. */
export interface HourFlows {
  /** `[d][i]`: riders on the link from stop i to stop i+1 (for a loop, the last is back to the first). */
  links: number[][];
  /** `[d][i]`: riders boarding at stop i of direction d. */
  on: number[][];
  /** `[d][i]`: riders alighting at stop i of direction d. */
  off: number[][];
}

/**
 * Purpose: who rides where in one hour (gravity split within the line): the riders on every link, and who
 * boards and alights at every stop, per direction.
 */
export function hourFlows(line: LoadLine, hourly: Record<string, number>): HourFlows {
  const seqs = line.sequences;
  const names = [...new Set(seqs.flat())];
  const links = seqs.map((s) => new Array<number>(line.loop ? s.length : Math.max(0, s.length - 1)).fill(0));
  const on = seqs.map((s) => new Array<number>(s.length).fill(0));
  const off = seqs.map((s) => new Array<number>(s.length).fill(0));
  const total = names.reduce((a, n) => a + (hourly[n] ?? 0), 0);
  for (const a of names) {
    const pa = hourly[a] ?? 0;
    const rest = total - pa;
    if (pa <= 0 || rest <= 0) continue;
    for (const b of names) {
      if (b === a) continue;
      const flow = (pa * (hourly[b] ?? 0)) / rest;
      if (flow <= 0) continue;
      // The direction that takes a to b in the fewest links.
      let best: { d: number; i: number; j: number; n: number } | null = null;
      seqs.forEach((s, d) => {
        const i = s.indexOf(a);
        const j = s.indexOf(b);
        if (i < 0 || j < 0) return;
        const n = j > i ? j - i : line.loop ? s.length - i + j : -1;
        if (n > 0 && (!best || n < best.n)) best = { d, i, j, n };
      });
      if (!best) continue;
      const { d, i, j, n } = best as { d: number; i: number; j: number; n: number };
      const l = links[d]!;
      for (let k = 0; k < n; k++) l[(i + k) % l.length]! += flow;
      on[d]![i]! += flow;
      off[d]![j]! += flow;
    }
  }
  return { links, on, off };
}

/**
 * Purpose: riders on every link of every direction in one hour (gravity split within the line).
 * Output: per direction, the riders on the link after each stop (`[i]` is stop i to stop i+1; for a loop,
 * the last is back to the first).
 */
export function linkRiders(line: LoadLine, hourly: Record<string, number>): number[][] {
  return hourFlows(line, hourly).links;
}

/**
 * Purpose: in a peak hour, scale the two directions of a line that is not a loop so that the busier carries
 * the peak direction share of the riders. Changes `f` in place.
 */
export function peakDirection(
  line: LoadLine,
  f: HourFlows,
  hourS: number,
  shares: LoadShares,
  day: ServiceDay,
): void {
  const links = f.links;
  if (line.loop || links.length !== 2 || !isPeak(hourS, day)) return;
  const sums = links.map((l) => l.reduce((a, b) => a + b, 0));
  const all = sums[0]! + sums[1]!;
  if (!(all > 0 && sums[0]! > 0 && sums[1]! > 0)) return;
  const busy = sums[0]! >= sums[1]! ? 0 : 1;
  const k = [0, 1].map((d) =>
    d === busy ? (shares.peakDirection * all) / sums[d]! : ((1 - shares.peakDirection) * all) / sums[d]!,
  );
  for (const part of [f.links, f.on, f.off])
    part.forEach((l, d) => l.forEach((_, i) => (l[i] = l[i]! * k[d]!)));
}

/** Purpose: the weekday boardings of a line's stops in the hour starting at `hourS`. */
export function hourBoardings(line: LoadLine, hourS: number, shares: LoadShares, day: ServiceDay) {
  const share = hourShare(hourS, shares, day);
  return Object.fromEntries(
    [...new Set(line.sequences.flat())].map((n) => [n, (line.boardings[n] ?? 0) * share]),
  );
}

/**
 * Purpose: the load of one line through a period: the busiest point of each hour, and who is left behind.
 * Inputs: the line, the period (s after midnight), the shares, the service day for the peak windows.
 */
export function lineLoad(
  line: LoadLine,
  fromS: number,
  toS: number,
  shares: LoadShares,
  day: ServiceDay = projectServiceDay(),
): LineLoad {
  const stops = [...new Set(line.sequences.flat())];
  const daily = stops.reduce((a, n) => a + (line.boardings[n] ?? 0), 0);
  const missing = stops.filter((n) => !(line.boardings[n] && line.boardings[n]! > 0));
  let busiest: HourLoad | null = null;
  let busiestLinks: LinkLoad[] = [];
  let leftBehind = 0;
  for (let h = Math.floor(fromS / 3600) * 3600; h < toS; h += 3600) {
    const part = (Math.min(toS, h + 3600) - Math.max(fromS, h)) / 3600;
    const f = hourFlows(line, hourBoardings(line, h, shares, day));
    // The busier direction carries the peak direction share in a peak hour.
    peakDirection(line, f, h, shares, day);
    const links = f.links;
    const places = line.perHour(h) * line.capacity;
    let best: HourLoad | null = null;
    const hourLinks: LinkLoad[] = [];
    links.forEach((l, d) => {
      const seq = line.sequences[d]!;
      l.forEach((riders, i) => {
        const occupancy = places > 0 ? riders / places : riders > 0 ? Infinity : 0;
        hourLinks.push({ from: seq[i]!, to: seq[(i + 1) % seq.length]!, riders, places, occupancy });
        if (!best || occupancy > best.occupancy)
          best = {
            hour_s: h,
            from: seq[i]!,
            to: seq[(i + 1) % seq.length]!,
            riders,
            places,
            occupancy,
            left_behind: Math.max(0, riders - places),
          };
      });
    });
    if (best) {
      const b = best as HourLoad;
      leftBehind += b.left_behind * part;
      if (!busiest || b.occupancy > busiest.occupancy) {
        busiest = b;
        busiestLinks = hourLinks;
      }
    }
  }
  return {
    id: line.id,
    name: line.name,
    daily,
    busiest,
    left_behind: leftBehind,
    missing,
    links: busiestLinks,
  };
}

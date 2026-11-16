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
import { DEFAULT_SERVICE_DAY, type ServiceDay } from "../journey-planner/network";

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

export interface LineLoad {
  id: string;
  name: string;
  /** Weekday boardings of the line. */
  daily: number;
  /** The busiest hour of the period (highest occupancy). */
  busiest: HourLoad | null;
  /** Riders left behind on the busiest links over the whole period. */
  left_behind: number;
  /** Stops without any boardings (no estimate and no number of the planner's). */
  missing: string[];
}

/** Purpose: the share of a weekday's boardings in the hour starting at `hourS`. */
export function hourShare(hourS: number, shares: LoadShares, day: ServiceDay = DEFAULT_SERVICE_DAY): number {
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

/**
 * Purpose: riders on every link of every direction in one hour (gravity split within the line).
 * Output: per direction, the riders on the link after each stop (`[i]` is stop i to stop i+1; for a loop,
 * the last is back to the first).
 */
export function linkRiders(line: LoadLine, hourly: Record<string, number>): number[][] {
  const seqs = line.sequences;
  const names = [...new Set(seqs.flat())];
  const out = seqs.map((s) => new Array<number>(line.loop ? s.length : Math.max(0, s.length - 1)).fill(0));
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
      let best: { d: number; i: number; n: number } | null = null;
      seqs.forEach((s, d) => {
        const i = s.indexOf(a);
        const j = s.indexOf(b);
        if (i < 0 || j < 0) return;
        const n = j > i ? j - i : line.loop ? s.length - i + j : -1;
        if (n > 0 && (!best || n < best.n)) best = { d, i, n };
      });
      if (!best) continue;
      const { d, i, n } = best as { d: number; i: number; n: number };
      const links = out[d]!;
      for (let k = 0; k < n; k++) links[(i + k) % links.length]! += flow;
    }
  }
  return out;
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
  day: ServiceDay = DEFAULT_SERVICE_DAY,
): LineLoad {
  const stops = [...new Set(line.sequences.flat())];
  const daily = stops.reduce((a, n) => a + (line.boardings[n] ?? 0), 0);
  const missing = stops.filter((n) => !(line.boardings[n] && line.boardings[n]! > 0));
  let busiest: HourLoad | null = null;
  let leftBehind = 0;
  for (let h = Math.floor(fromS / 3600) * 3600; h < toS; h += 3600) {
    const part = (Math.min(toS, h + 3600) - Math.max(fromS, h)) / 3600;
    const share = hourShare(h, shares, day);
    const hourly = Object.fromEntries(stops.map((n) => [n, (line.boardings[n] ?? 0) * share]));
    const links = linkRiders(line, hourly);
    // The busier direction carries the peak direction share in a peak hour.
    if (!line.loop && links.length === 2 && isPeak(h, day)) {
      const sums = links.map((l) => l.reduce((a, b) => a + b, 0));
      const all = sums[0]! + sums[1]!;
      if (all > 0 && sums[0]! > 0 && sums[1]! > 0) {
        const busy = sums[0]! >= sums[1]! ? 0 : 1;
        const k = [0, 1].map((d) =>
          d === busy
            ? (shares.peakDirection * all) / sums[d]!
            : ((1 - shares.peakDirection) * all) / sums[d]!,
        );
        links.forEach((l, d) => l.forEach((_, i) => (l[i] = l[i]! * k[d]!)));
      }
    }
    const places = line.perHour(h) * line.capacity;
    let best: HourLoad | null = null;
    links.forEach((l, d) => {
      const seq = line.sequences[d]!;
      l.forEach((riders, i) => {
        const occupancy = places > 0 ? riders / places : riders > 0 ? Infinity : 0;
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
      if (!busiest || b.occupancy > busiest.occupancy) busiest = b;
    }
  }
  return { id: line.id, name: line.name, daily, busiest, left_behind: leftBehind, missing };
}

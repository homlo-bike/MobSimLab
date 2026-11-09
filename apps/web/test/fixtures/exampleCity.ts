/**
 * A made-up city for the journey planner tests: metro M1, tram T2, bus 3 and regional train R5, with a
 * timed connection from R5 to M1 at Central. It used to be the planner's example network.
 */
import {
  DEFAULT_SERVICE_DAY,
  offset,
  servicePeriods,
  type ServiceDay,
} from "../../src/features/journey-planner/network";
import type {
  FrequencyPattern,
  LonLat,
  Route,
  Stop,
  Timetable,
  Transfer,
} from "../../src/features/journey-planner/types";

const H = 3600;
const M = 60;

interface LineSpec {
  id: string;
  mode: string;
  color: string;
  stops: { id: string; name: string; x: number; y: number; parent?: string; platform?: string }[];
  runS: number[];
  dwellS: number;
  peakS: number;
  offPeakS: number;
  offsetS: number;
  day: ServiceDay;
}

/** Purpose: both directions of a line as frequency patterns. */
function patterns(l: LineSpec): FrequencyPattern[] {
  const ids = l.stops.map((s) => s.id);
  const fwd = ids.map((stop_id, i) => ({
    stop_id,
    run_time: i === 0 ? 0 : l.runS[i - 1]!,
    dwell_time: i === 0 ? 0 : l.dwellS,
  }));
  const rev = [...ids].reverse().map((stop_id, i) => ({
    stop_id,
    run_time: i === 0 ? 0 : l.runS[ids.length - 1 - i]!,
    dwell_time: i === 0 ? 0 : l.dwellS,
  }));
  return [fwd, rev].map((stops, d) => ({
    pattern_id: `${l.id}-${d}`,
    route_id: l.id,
    direction_id: d,
    service_id: "weekday",
    stops,
    periods: servicePeriods(l.day, l.peakS, l.offPeakS, l.offsetS),
  }));
}

/**
 * Purpose: a made-up city around `center` to try the planner before real timetables exist: metro M1
 * (west–east), tram T2 (south–north), bus 3 (parallel to the metro, 1.2 km north) and regional train R5,
 * with a timed connection from R5 to M1 at Central. Stations are fictional.
 */
export function exampleCity(center: LonLat, day: ServiceDay = DEFAULT_SERVICE_DAY): Timetable {
  const metroNames = ["Lakeside", "Old Town", "Market", "Central", "University", "Stadium", "East Gate"];
  const tramNames = ["South Park", "Hospital", "Riverside", "Central", "Museum", "North Square", "Hilltop"];
  const busNames = ["Mill Lane", "Orchard", "Library", "North Square", "Brewery", "Canal", "Harbour Road"];
  const lines: LineSpec[] = [
    {
      id: "M1",
      mode: "metro",
      color: "1d4ed8",
      stops: metroNames.map((name, i) => ({
        id: i === 3 ? "central-m" : `m1-${i}`,
        name,
        x: (i - 3) * 900,
        y: 0,
        parent: i === 3 ? "central" : undefined,
        platform: i === 3 ? "M" : undefined,
      })),
      runS: Array<number>(6).fill(80),
      dwellS: 30,
      peakS: 4 * M,
      offPeakS: 8 * M,
      offsetS: 0,
      day,
    },
    {
      id: "T2",
      mode: "tram",
      color: "b91c1c",
      stops: tramNames.map((name, i) => ({
        id: i === 3 ? "central-t" : i === 5 ? "north-sq-t" : `t2-${i}`,
        name,
        x: i === 3 ? 40 : 0,
        y: (i - 3) * 500,
        parent: i === 3 ? "central" : i === 5 ? "north-sq" : undefined,
        platform: i === 3 ? "T" : undefined,
      })),
      runS: Array<number>(6).fill(75),
      dwellS: 20,
      peakS: 6 * M,
      offPeakS: 12 * M,
      offsetS: 2 * M,
      day,
    },
    {
      id: "3",
      mode: "bus",
      color: "c2410c",
      stops: busNames.map((name, i) => ({
        id: i === 3 ? "north-sq-b" : `b3-${i}`,
        name,
        x: (i - 3) * 800,
        y: i === 3 ? 1030 : 1200,
        parent: i === 3 ? "north-sq" : undefined,
      })),
      runS: Array<number>(6).fill(110),
      dwellS: 20,
      peakS: 10 * M,
      offPeakS: 20 * M,
      offsetS: 5 * M,
      day: { ...day, firstS: Math.max(day.firstS, 6 * H), lastS: Math.min(day.lastS, 22 * H) },
    },
    {
      id: "R5",
      mode: "regional_rail",
      color: "15803d",
      stops: [
        { id: "r5-0", name: "Westfield", x: -7000, y: -2500 },
        { id: "central-r", name: "Central", x: 0, y: -90, parent: "central", platform: "3" },
        { id: "r5-2", name: "Airport", x: 9000, y: 3500 },
      ],
      runS: [420, 540],
      dwellS: 60,
      peakS: 15 * M,
      offPeakS: 30 * M,
      offsetS: 9 * M,
      day: {
        ...day,
        firstS: Math.max(day.firstS, 5 * H + 30 * M),
        lastS: Math.min(day.lastS, 23 * H + 30 * M),
      },
    },
  ];
  const stops: Stop[] = [];
  for (const l of lines)
    for (const s of l.stops) {
      if (stops.some((x) => x.stop_id === s.id)) continue;
      const [lon, lat] = offset(center, s.x, s.y);
      stops.push({
        stop_id: s.id,
        stop_name: s.name,
        stop_lon: lon,
        stop_lat: lat,
        ...(s.parent ? { parent_station: s.parent } : {}),
        ...(s.platform ? { platform_code: s.platform } : {}),
      });
    }
  const routes: Route[] = lines.map((l) => ({
    route_id: l.id,
    route_short_name: l.id,
    mode: l.mode,
    route_color: l.color,
  }));
  // The Swiss-style node connection: R5 arriving at Central meets the metro.
  const transfers: Transfer[] = [
    {
      from_stop_id: "central-r",
      to_stop_id: "central-m",
      transfer_type: 1,
      min_transfer_time: 120,
      max_wait_s: 120,
    },
    {
      from_stop_id: "central-m",
      to_stop_id: "central-r",
      transfer_type: 1,
      min_transfer_time: 120,
      max_wait_s: 120,
    },
  ];
  return { stops, routes, trips: [], transfers, frequency_patterns: lines.flatMap(patterns) };
}

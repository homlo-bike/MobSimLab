/**
 * Types of the JSON exchanged with the journey-planner WebAssembly module (Rust crate `journey-planner`,
 * ADR-0034). The timetable follows `contracts/published-timetable.schema.json` (GTFS names).
 */

export type LonLat = [number, number];

export interface Stop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  parent_station?: string;
  platform_code?: string;
}

export interface Route {
  route_id: string;
  route_short_name: string;
  mode: string;
  route_color?: string;
}

export interface StopTime {
  stop_id: string;
  stop_sequence: number;
  arrival_time: number;
  departure_time: number;
  pickup_type?: number;
  drop_off_type?: number;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  direction_id?: number;
  service_id?: string;
  block_id?: string;
  stop_times: StopTime[];
}

export interface Transfer {
  from_stop_id: string;
  to_stop_id: string;
  /** GTFS: 0 recommended, 1 timed (guaranteed), 2 minimum time, 3 not possible. */
  transfer_type?: number;
  min_transfer_time?: number;
  max_wait_s?: number;
  estimated?: boolean;
}

export type PeriodKind = "peak" | "off_peak";

export interface Period {
  start_time: number;
  end_time: number;
  headway_secs: number;
  offset_secs?: number;
  kind: PeriodKind;
}

export interface PatternStop {
  stop_id: string;
  run_time: number;
  dwell_time: number;
}

export interface FrequencyPattern {
  pattern_id: string;
  route_id: string;
  direction_id?: number;
  service_id?: string;
  stops: PatternStop[];
  periods: Period[];
}

export interface Timetable {
  stops: Stop[];
  routes: Route[];
  trips: Trip[];
  transfers: Transfer[];
  frequency_patterns: FrequencyPattern[];
}

export interface Settings {
  walk_speed_kmh: number;
  walk_detour_factor: number;
  max_access_m: number;
  max_transfer_m: number;
  /** Stops with the same name within this distance are one station (a bus stop named like the railway station). */
  same_name_station_m: number;
  max_walk_only_m: number;
  min_change_s: number;
  level_change_s: number;
  max_rides: number;
  service_id: string | null;
  arrive_by_window_s: number;
}

export type TimeMode = "depart_at" | "arrive_by";

export interface Query {
  from: LonLat;
  to: LonLat;
  time_s: number;
  mode: TimeMode;
}

export interface ProfileQuery {
  from: LonLat;
  to: LonLat;
  mode: TimeMode;
  start_s: number;
  end_s: number;
  step_s: number;
}

export interface Place {
  name: string;
  stop_id?: string;
  platform_code?: string;
  lon: number;
  lat: number;
}

export type Leg =
  | {
      type: "walk";
      kind: "access" | "transfer" | "egress" | "direct";
      from: Place;
      to: Place;
      start_s: number;
      end_s: number;
      distance_m: number;
    }
  | { type: "wait"; kind: "initial" | "transfer"; at: Place; start_s: number; end_s: number }
  | {
      type: "ride";
      route_id: string;
      route_short_name: string;
      mode: string;
      route_color?: string;
      trip_id: string;
      from: Place;
      to: Place;
      start_s: number;
      end_s: number;
      intermediate_stops: number;
      guaranteed: boolean;
    };

export interface Breakdown {
  walk_s: number;
  wait_s: number;
  in_vehicle_s: number;
  transfer_walk_s: number;
  transfer_wait_s: number;
  early_arrival_s: number;
}

export interface Journey {
  query_s: number;
  depart_s: number;
  leave_s: number;
  arrive_s: number;
  total_s: number;
  door_to_door_s: number;
  rides: number;
  transfers: number;
  walk_m: number;
  breakdown: Breakdown;
  legs: Leg[];
}

export interface Plan {
  query: Query;
  journeys: Journey[];
}

export interface ProfilePoint {
  time_s: number;
  journey: Journey | null;
}

export interface NetworkSummary {
  stops: number;
  routes: number;
  trips: number;
  raptor_routes: number;
  footpaths: number;
  /** Stations with more than one stop. */
  stations?: number;
  /** Stops joined into a station because they share its name. */
  joined_by_name?: number;
  first_departure_s: number | null;
  last_arrival_s: number | null;
  warnings: string[];
}

/** The planner as the panel sees it. */
export interface PlannerEngine {
  summary(): NetworkSummary;
  plan(q: Query): Plan;
  profile(q: ProfileQuery): ProfilePoint[];
  dispose(): void;
}

/** Compiles a timetable into a planner. */
export type PlannerLoader = (timetable: Timetable, settings: Partial<Settings>) => Promise<PlannerEngine>;

/** Earliest arrival at every stop from one point (accessibility, benefit tables). */
export interface Reach {
  stop_ids: string[];
  /** Seconds after midnight, or null where the stop cannot be reached. */
  arrive_s: (number | null)[];
}

/** A compiled timetable that answers "how soon can I be at each stop". */
export interface ReachEngine {
  reach(from: LonLat, t0: number): Reach;
  dispose(): void;
}

/** Compiles a timetable for reach questions. */
export type ReachLoader = (timetable: Timetable, settings: Partial<Settings>) => Promise<ReachEngine>;

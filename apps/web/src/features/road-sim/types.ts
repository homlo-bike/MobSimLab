/**
 * The road simulation as the API and the worker see it (apps/api/src/simulation/road.ts,
 * worker/src/mobsim_worker/jobs/road): the scenario the panel builds, the result and the replay.
 */
import type { LonLat, Mode } from "../street-lines/types";
import type { Section } from "../street-setup/types";

export type Energy = "battery" | "trolleybus" | "other";

/** One street line as the road run takes it: its circuit from its first end stop, departures, depot runs. */
export interface RoadLine {
  index: number;
  name: string;
  mode: Mode;
  color: string;
  vehicle: {
    length_m: number;
    width_m: number;
    max_speed_kmh: number;
    weight_t: number;
    energy: Energy;
    battery_kwh: number | null;
    hvac_kw: number;
  };
  dwell_s: number;
  layover_s: number;
  points: { name: string; kind: "via" | "stop" | "end_stop"; lonlat: LonLat }[];
  legs: { coords: LonLat[]; time_s: number }[];
  departures: number[];
  pull_out: { coords: LonLat[]; time_s: number; at: number } | null;
  pull_in: { coords: LonLat[]; time_s: number; at: number } | null;
  depot: string | null;
}

export interface RoadDepot {
  id: string;
  name: string;
  network: {
    nodes: { id: string; lonlat: LonLat }[];
    edges: {
      id: string;
      kind: "gate" | "aisle" | "lane" | "drive";
      from: string;
      to: string;
      one_way: boolean;
      coords: LonLat[];
      length_m?: number;
      of?: string;
    }[];
  };
  lanes: {
    id: string;
    slots: { id: string; center: LonLat; heading_deg: number; length_m: number; charger: boolean }[];
  }[];
  assignments: { line: string; vehicle: number; lane: string; slot: string; charger: boolean }[];
}

export interface RoadScenario {
  driving_side: "right" | "left";
  lines: RoadLine[];
  depots: RoadDepot[];
  streets: {
    way: number;
    oneway?: boolean | null;
    traffic_lanes?: number | null;
    bus_lane?: boolean | null;
    sections?: Section[] | null;
    cars_morning_peak?: number | null;
    cars_evening_peak?: number | null;
  }[];
  /** Junctions with traffic lights given (`signals: true`) or taken away, by their OSM nodes (GIS tab). */
  junctions?: { nodes: number[]; signals: boolean }[];
  traffic: {
    defaults: { trunk: number; primary: number; secondary: number; tertiary: number; local: number };
    off_peak_share: number;
    peaks: [number, number][];
  };
  trolley_charge_kw: number;
}

export interface RoadParams {
  from_s: number;
  to_s: number;
  warmup_s?: number;
  seed?: number;
  step_s?: number;
}

/** One line's measures (worker `line_results`). */
export interface RoadLineResult {
  index: number;
  name: string;
  mode: string;
  color: string;
  energy: Energy;
  problem: string | null;
  notes: string[];
  vehicles: number;
  cycle_s: number;
  circuit_m: number;
  trips?: number;
  trips_run?: number;
  planned_run_s?: number;
  run_cycle_s?: number;
  speed_kmh?: number;
  punctuality?: number;
  mean_delay_s?: number;
  p95_delay_s?: number;
  bunched_share?: number;
  lost_traffic_s?: number;
  lost_signals_s?: number;
  back_in_depot?: number;
  energy_use?: {
    kwh: number;
    km: number;
    kwh_per_km: number;
    battery_kwh: number;
    min_charge_share: number | null;
    ran_out: number;
  };
}

export interface RoadEvent {
  kind: "gridlock" | "energy_out" | "not_back";
  t: number;
  vehicle: string;
  line: number;
  lonlat: LonLat | null;
}

/** A place where street line vehicles stood outside their stops (worker `hotspot_list`), most lost first. */
export interface RoadHotspot {
  /** `signal`: waiting at a red light; `street`: standing in traffic; `junction`: standing inside a junction. */
  kind: "signal" | "street" | "junction";
  /** The street's name, empty when OSM gives none. */
  name: string;
  lonlat: LonLat;
  /** Seconds lost there by all street line vehicles together. */
  lost_s: number;
  /** The lines (their index) that lost time there. */
  lines: number[];
}

export interface RoadResult {
  notes: string[];
  lines: RoadLineResult[];
  events: RoadEvent[];
  /** Where the lines lost the most time (runs from before it was recorded: absent). */
  hotspots?: RoadHotspot[];
  network: {
    edges: number;
    km: number;
    signals: number;
    /** Nodes mapped as traffic lights in OSM on the run's streets (runs from before it was counted: absent). */
    osm_signals?: number;
    warnings: number;
  } | null;
  traffic: { cars: number; target_car_km: number; sampled_car_km: number } | null;
  run: {
    begin: number;
    end: number;
    from_s: number;
    to_s: number;
    teleports: number;
    collisions: number;
    background_inserted: number;
    vehicles: number;
    back_in_depot: number;
    gridlocks: number;
    wall_s: number;
    speedup: number;
    seed: number;
    step_s: number;
    complete: boolean;
  } | null;
}

/** What the worker is doing now. */
export type RoadStep =
  | { step: "network" | "planning" | "traffic" }
  | { step: "simulating"; t: number; begin: number; end: number };

/** The replay (worker `pack_replay`): a track per vehicle, one sample per frame while it is out. */
export interface Replay {
  version: 1;
  begin: number;
  frame_s: number;
  frames: number;
  lines: { index: number; name: string; color: string; mode: string }[];
  vehicles: {
    id: string;
    line: number;
    number: number;
    slot_out: LonLat | null;
    slot_in: LonLat | null;
    /** First frame, -1 when the vehicle never left. */
    f0: number;
    /** Five numbers per frame: lon·1e5, lat·1e5, heading °, speed km/h, charge % (-1 without a battery). */
    s: number[];
    /**
     * The vehicle's planned stops, four numbers each in plan order: planned departure, arrival and departure
     * (s after midnight, -1 when it did not get there) and the kind (0 along a trip, 1 first stop of a trip,
     * 2 back at the first stop after the last trip). Absent in replays of runs made before it was recorded.
     */
    st?: number[];
  }[];
  events: RoadEvent[];
}

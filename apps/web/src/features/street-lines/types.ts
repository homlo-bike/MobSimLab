/** Types of the JSON returned by the street-routing WebAssembly module (Rust `LineView`). */

export type Mode = "bus" | "brt" | "trolleybus" | "intercity_bus";
export type PointKind = "via" | "stop" | "end_stop";
export type Status = "ok" | "warning" | "error";
export type LonLat = [number, number];

export interface VehicleProfile {
  mode: Mode;
  height_m: number;
  weight_t: number;
  length_m: number;
  max_speed_kmh: number;
  battery_range_m: number;
  doors_both_sides: boolean;
}

export interface RoutingRules {
  traffic_side: "right" | "left";
  detour_warn_m: number;
  detour_warn_ratio: number;
  grouping_distance_m: number;
  max_snap_m: number;
}

export interface PointView {
  id: number;
  seq: number;
  kind: PointKind;
  name: string;
  lonlat: LonLat;
  status: Status;
  message: string | null;
  bearing_deg: number | null;
  bay: LonLat[] | null;
}

export interface LegView {
  index: number;
  from: number;
  to: number;
  coords: LonLat[];
  length_m: number;
  time_s: number;
  direct_m: number | null;
  status: Status;
  message: string | null;
  ways: number[];
  /** Expected wait at level crossings on this leg, s (included in `time_s`). */
  crossing_wait_s: number;
  level_crossings: { crossing: number; passes: number; wait_s: number }[];
}

/** Expected wait of a bus at one level crossing (Rust `crossings::CrossingWait`). */
export interface CrossingWait {
  /** Per pass in the peak (the timetable's busiest hour), s; added to running times. */
  wait_s: number;
  /** Per pass off-peak (the timetable's day average), s. */
  off_peak_wait_s: number;
  closed_share: number;
  closures_per_hour: number;
  mean_closure_s: number;
  /** Start of the busiest hour, s after midnight (timetable only). */
  peak_hour_s: number | null;
  source: "timetable" | "assumed" | "mixed";
}

/** A level crossing with a railway that the line passes. */
export interface LineCrossingView {
  ids: string[];
  street: string;
  modes: string[];
  protection: "barriers" | "traffic_signals";
  lonlat: LonLat;
  wait: CrossingWait;
  passes: number;
  /** Expected wait per circuit, s. */
  wait_s: number;
}

export interface DirectionView {
  direction: number;
  stops: number[];
  legs: number[];
  length_m: number;
  time_s: number;
}

export interface StationGroupView {
  name: string;
  stops: number[];
}

export interface DepotTripView {
  kind: "pull_out" | "pull_in";
  stop: number;
  coords: LonLat[];
  length_m: number;
  time_s: number;
  crossing_wait_s: number;
  status: Status;
  message: string | null;
}

export interface LineView {
  points: PointView[];
  legs: LegView[];
  directions: DirectionView[];
  station_groups: StationGroupView[];
  depot: LonLat | null;
  depot_trips: DepotTripView[];
  issues: string[];
  length_m: number;
  /** Running time, s, with the expected wait at level crossings. */
  time_s: number;
  level_crossings: LineCrossingView[];
  /** Expected wait at level crossings per circuit, s (included in `time_s`). */
  crossing_wait_s: number;
}

/** The routing engine as the editor sees it. Every edit returns the new line view. */
export interface StreetEngine {
  /** Adds the streets of one tile (OSM XML); call `rebuild` after a batch. */
  addOsm(xml: string): void;
  /** Rebuilds the network from all tiles so far and re-routes the line. */
  rebuild(): LineView;
  ready(): boolean;
  view(): LineView;
  insertPoint(seq: number, lonlat: LonLat, kind: PointKind): LineView;
  movePoint(id: number, lonlat: LonLat): LineView;
  deletePoint(id: number): LineView;
  clear(): LineView;
  setKind(id: number, kind: PointKind): LineView;
  setName(id: number, name: string): LineView;
  setDepot(lonlat: LonLat): LineView;
  clearDepot(): LineView;
  optimise(): LineView;
  setSettings(profile: VehicleProfile, rules: RoutingRules): LineView;
  /**
   * Level crossings from a track topology (JSON text, contracts/rail-topology.schema.json) with rail
   * timetable closures (contracts/level-crossing-closures.schema.json, or ""); "" removes them.
   */
  setLevelCrossings(topology: string, closures: string): LineView;
  /** Roads the current vehicle may use, as GeoJSON with `oneway`, `wire` and `bus_lane` properties. */
  usableRoads(): object;
  defaultProfile(mode: Mode): VehicleProfile;
  defaultRules(): RoutingRules;
  dispose(): void;
}

/** Creates an engine with no streets loaded yet. */
export type EngineLoader = () => Promise<StreetEngine>;

/** Fetches the OSM XML of one street tile. */
export type TileFetcher = (x: number, y: number) => Promise<string>;

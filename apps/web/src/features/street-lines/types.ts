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
  time_s: number;
}

export interface NetworkStats {
  nodes: number;
  arcs: number;
  turn_bans: number;
}

/** The routing engine as the editor sees it. Every edit returns the new line view. */
export interface StreetEngine {
  bounds(): [number, number, number, number];
  stats(): NetworkStats;
  view(): LineView;
  insertPoint(seq: number, lonlat: LonLat, kind: PointKind): LineView;
  movePoint(id: number, lonlat: LonLat): LineView;
  deletePoint(id: number): LineView;
  setKind(id: number, kind: PointKind): LineView;
  setName(id: number, name: string): LineView;
  setDepot(lonlat: LonLat): LineView;
  clearDepot(): LineView;
  optimise(): LineView;
  setSettings(profile: VehicleProfile, rules: RoutingRules): LineView;
  /** Roads the current vehicle may use, as GeoJSON with `oneway`, `wire` and `bus_lane` properties. */
  usableRoads(): object;
  defaultProfile(mode: Mode): VehicleProfile;
  defaultRules(): RoutingRules;
  dispose(): void;
}

/** Creates an engine from OSM XML text. */
export type EngineLoader = (osmXml: string) => Promise<StreetEngine>;

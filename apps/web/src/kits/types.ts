/** Types of the mode-kits WebAssembly module (crates/mode-kits); field names follow the Rust structs. */

export type LonLat = [number, number];

export interface Issue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  station?: number;
  section?: number;
  parameter?: string;
}

export interface SpanSystem {
  id: string;
  operation: "continuous" | "reversible";
  line_speed_ms: number;
  cabin_interval_s: number;
  cabin_capacity: number;
  max_span_m: number;
  max_station_angle_deg: number;
  min_clearance_m: number;
  recommended_clearance_m: number;
  tower_height_m: number;
  max_tower_height_m: number;
  station_rope_height_m: number;
  cabin_hang_m: number;
  sag_ratio: number;
  station_passage_s: number;
  terminal_dwell_s: number;
  reserve_share: number;
  capacity_ceiling_pphpd?: number;
  /** Prefix of the plugin parameters the findings name (default `ropeway`). */
  parameter_prefix?: string;
}

export type StationKind = "terminal" | "intermediate" | "angle";

export interface SpanStation {
  name: string;
  lonlat: LonLat;
  kind: StationKind;
  boarding: boolean;
  elevation_m: number;
}

export interface TowerInput {
  at_m: number;
  height_m?: number | null;
}

/** A point of the ground under a section, from the terrain model (crates/mode-kits `GroundSample`). */
export interface GroundSample {
  at_m: number;
  z_m: number;
  obstacle_m: number;
}

export interface SpanLine {
  stations: SpanStation[];
  system: SpanSystem;
  towers: (TowerInput[] | null)[];
  /** Per section: ground samples, or null for a straight line between the station heights. */
  ground?: (GroundSample[] | null)[];
}

export interface SpanView {
  stations: { kind: StationKind; boarding: boolean; at_m: number; deflection_deg: number }[];
  sections: {
    length_m: number;
    towers: { at_m: number; lonlat: LonLat; height_m: number; auto: boolean }[];
    spans_m: number[];
    min_clearance_m: number;
    manual: boolean;
  }[];
  profile: { at_m: number; ground_m: number; obstacle_m: number; rope_m: number; cabin_m: number }[];
  length_m: number;
  trip_time_s: number;
  headway_s: number;
  capacity_pphpd: number;
  cabin_spacing_m: number;
  cabins: number;
  tower_count: number;
  stops: { station: number; run_s: number; dwell_s: number }[];
  issues: Issue[];
}

export interface VesselType {
  id: string;
  service_speed_kn: number;
  berthing_s: number;
  boarding_pax_per_min_per_gangway: number;
  min_dwell_s: number;
  capacity: number;
}

export interface Pier {
  name: string;
  lonlat: LonLat;
  berths: number;
  gangways: number;
}

export interface WaterCall {
  pier: number;
  via: LonLat[];
}

export interface SpeedZone {
  name: string;
  ring: LonLat[];
  max_kn: number;
}

export interface WaterLine {
  piers: Pier[];
  calls: WaterCall[];
  vessel: VesselType;
  headway_s: number;
  layover_s: number;
  pax_per_call: number;
  speed_zones: SpeedZone[];
  check_window_s?: number;
}

export interface WaterStop {
  pier: number;
  run_s: number;
  dwell_s: number;
}

export interface WaterView {
  legs: { path: LonLat[]; length_m: number; sail_s: number; slow_m: number; time_s: number }[];
  length_m: number;
  trip_time_s: number;
  dwell_s: number;
  layover_first_s: number;
  layover_last_s: number;
  cycle_s: number;
  vessels: number;
  capacity_pphpd: number;
  directions: WaterStop[][];
  berths: { pier: number; berths: number; peak: number; holds: number; held_s: number }[];
  holds: number;
  held_s: number;
  issues: Issue[];
}

/** The kits as the editors use them; tests can inject a fake. */
/** The on-demand system of the service zone kit, from the plugin's `drt.*` values. */
export interface ZoneSystem {
  speed_kmh: number;
  network_factor: number;
  stop_dwell_s: number;
  vehicle_places: number;
  target_utilisation: number;
  pooling_detour_share: number;
  max_wait_s: number;
  riders_per_request: number;
}

export interface ZoneInput {
  ring: LonLat[];
  requests_per_hour: number;
  fleet: number;
  start_s: number;
  end_s: number;
  system: ZoneSystem;
  parameter_prefix?: string;
}

/** The service zone kit's estimate (`mode_kits::zone::ZoneView`). */
export interface ZoneView {
  area_km2: number;
  mean_straight_km: number;
  mean_trip_km: number;
  vehicles_needed: number;
  utilisation: number;
  /** null when the fleet cannot keep up. */
  wait_s: number | null;
  ride_s: number;
  door_to_door_s: number | null;
  mean_occupancy: number;
  ride_s_per_km: number;
  ride_fixed_s: number;
  service_hours: number;
  requests_per_day: number;
  vehicle_hours_per_day: number;
  vehicle_km_per_day: number;
  issues: Issue[];
}

/** The dispatcher's limits (`mode_kits::dispatch::DispatchRules`), from the plugin's `drt.*` values. */
export interface DispatchRules {
  max_wait_s: number;
  max_detour_share: number;
  max_detour_fixed_s: number;
  seed?: number;
}

export interface DispatchHour {
  start_s: number;
  requests: number;
  served: number;
  mean_wait_s: number;
  busy_vehicles: number;
}

/** One simulated service day of a zone (`mode_kits::dispatch::DispatchResult`). */
export interface DispatchResult {
  requests: number;
  served: number;
  rejected: number;
  mean_wait_s: number;
  p90_wait_s: number;
  mean_ride_s: number;
  mean_detour_factor: number;
  vehicle_km: number;
  empty_share: number;
  mean_occupancy: number;
  riders_per_vehicle_hour: number;
  shared_share: number;
  hours: DispatchHour[];
}

export interface Kits {
  buildSpanLine(line: SpanLine): SpanView;
  buildWaterLine(line: WaterLine): WaterView;
  estimateZone(zone: ZoneInput): ZoneView;
  simulateZone(day: { zone: ZoneInput; rules: DispatchRules }): DispatchResult;
}

export type KitsLoader = () => Promise<Kits>;

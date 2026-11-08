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

export interface SpanLine {
  stations: SpanStation[];
  system: SpanSystem;
  towers: (TowerInput[] | null)[];
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
  profile: { at_m: number; ground_m: number; rope_m: number; cabin_m: number }[];
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
export interface Kits {
  buildSpanLine(line: SpanLine): SpanView;
  buildWaterLine(line: WaterLine): WaterView;
}

export type KitsLoader = () => Promise<Kits>;

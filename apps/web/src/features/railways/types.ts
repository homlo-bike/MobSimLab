/** The railway design document (Rust `rail_design::model`) and the view returned by the engine. */

export type RailMode =
  | "tram"
  | "light_rail"
  | "metro"
  | "commuter_rail"
  | "regional_rail"
  | "long_distance_rail"
  | "high_speed_rail";
export type Level = "underground2" | "underground" | "street" | "elevated" | "elevated2";
export type Power = "auto" | "overhead" | "third_rail" | "none";
export type TrackUse = "running" | "storage";
export type Bed = "auto" | "ballast" | "embedded";
export type SwitchKind = "turnout" | "double_junction" | "crossover" | "scissors";
export type LonLat = [number, number];

export interface ModeParams {
  label: string;
  gauge_mm: number;
  design_speed_kmh: number;
  track_centre_m: number;
  clearance_marker_m: number;
  min_radius_m: number;
  recommended_radius_m: number;
  max_gradient_permille: number;
  vertical_radius_m: number;
  max_cant_mm: number;
  max_cant_deficiency_mm: number;
  platform_length_m: number;
  platform_height_mm: number;
  side_platform_width_m: number;
  island_platform_width_m: number;
  platform_edge_offset_m: number;
  track_beyond_platform_m: number;
  electrification: string;
  ocl_span_m: number;
  default_turnout: string;
  colour: string;
  [key: string]: number | string;
}

export interface Station {
  id: number;
  name: string;
  x: number;
  y: number;
  rotation_deg: number;
  level: Level;
  side_platforms: number;
  island_platforms: number;
  platform_length_m: number;
  /** Railway system; absent = the network's mode. */
  mode?: RailMode | null;
}

export type Anchor =
  | { type: "free"; x: number; y: number; level?: Level | null }
  | { type: "station"; station: number; end: number; tracks: number[] }
  | { type: "switch"; switch: number; leg: number };

export interface Pi {
  x: number;
  y: number;
  radius_m?: number | null;
  level?: Level | null;
}

export interface Track {
  id: number;
  name: string;
  start: Anchor;
  end: Anchor | null;
  points: Pi[];
  tracks: 1 | 2;
  level: Level;
  power: Power;
  use: TrackUse;
  bed: Bed;
  lead_start_m: number;
  lead_end_m: number;
  radius_start_m?: number | null;
  radius_end_m?: number | null;
  directions?: ("forward" | "back" | "both")[];
  /** Railway system; absent = that of the station or switch it starts from, else the network's. */
  mode?: RailMode | null;
}

export interface Switch {
  id: number;
  kind: SwitchKind;
  track: number;
  s: number;
  element: string;
  side: 1 | -1;
  direction: 1 | -1;
  flip: boolean;
}

export interface Network {
  origin: LonLat;
  mode: RailMode;
  params?: ModeParams | null;
  train_length_m?: number | null;
  stations: Station[];
  tracks: Track[];
  switches: Switch[];
}

export type Severity = "error" | "warning" | "info" | "ok";

export interface IssueView {
  severity: Severity;
  text: string;
  at: LonLat | null;
  ref_id: number | null;
}

export interface ConnectionView {
  index: number;
  anchor: Anchor;
  lonlat: LonLat;
  tracks: number;
  used: boolean;
  level: Level;
  bearing_deg: number;
  mode: RailMode;
}

export type HandleView =
  | {
      track: number;
      kind: "pi" | "lead_start" | "lead_end" | "end" | "start";
      index: number | null;
      lonlat: LonLat;
      level: Level;
    }
  | { station: number; kind: "rotate"; lonlat: LonLat };

export interface CurveView {
  pi: number | null;
  kind: string;
  radius_m: number;
  nominal_radius_m: number;
  deflection_deg: number;
  transition_m: number;
  speed_kmh: number;
  cant_mm: number;
  cant_deficiency_mm: number;
}

export interface TrackView {
  id: number;
  length_m: number;
  tracks: number;
  curves: CurveView[];
  ramps: { from: Level; to: Level; dh_m: number; length_m: number }[];
  levels: { from_m: number; to_m: number; level: Level | "ramp" }[];
  spread_m: [number, number];
  mode: RailMode;
  speed: { max_kmh: number; time_s: number; profile: [number, number, number][] } | null;
  centre: LonLat[];
}

export interface StationView {
  id: number;
  name: string;
  tracks: number;
  platform_edges: number;
  layout: string;
  box_length_m: number;
  box_width_m: number;
  platform_height_mm: number;
  lonlat: LonLat;
  mode: RailMode;
}

export interface SwitchView {
  id: number;
  label: string;
  element: string;
  kind: SwitchKind;
  length_m: number;
  diverging_speed_kmh: number;
  crossing_ratio_n: number;
  radius_m: number;
  s0: number;
  s1: number;
}

export interface TurnoutOption {
  id: string;
  label: string;
  radius_m: number | null;
  crossing_ratio_n: number | null;
  diverging_speed_kmh: number | null;
  total_length_m: number | null;
  length_a_m: number | null;
}

/** Two tracks crossing; a same-level crossing is a conflict one train at a time may occupy. */
export interface CrossingView {
  id: string;
  kind: "diamond" | "gradeseparated" | "clash";
  tracks: [number, number];
  modes: [RailMode, RailMode];
  angle_deg: number;
  lonlat: LonLat;
}

/** A street-level track crossing a street from OpenStreetMap. */
export interface LevelCrossingView {
  id: string;
  track: number;
  mode: RailMode;
  street: string;
  class: string;
  angle_deg: number;
  protection: "barriers" | "traffic_signals";
  /** No design error at this crossing. */
  allowed: boolean;
  bus: boolean;
  trolley_wire: boolean;
  keep_clear_m: number;
  approach_m: number;
  lonlat: LonLat;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }[];
}

export const LAYER_NAMES = [
  "structures",
  "edges",
  "tracks",
  "rails",
  "platforms",
  "wires",
  "masts",
  "markers",
  "level_crossings",
  "corridors",
  "connections",
] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export interface RailView {
  layers: Record<LayerName, FeatureCollection>;
  connections: ConnectionView[];
  handles: HandleView[];
  stations: StationView[];
  tracks: TrackView[];
  switches: SwitchView[];
  issues: IssueView[];
  params: ModeParams;
  train_length_m: number;
  turnouts: TurnoutOption[];
  /** Design values and catalogue of every mode in the drawing. */
  modes: Partial<Record<RailMode, { params: ModeParams; turnouts: TurnoutOption[] }>>;
  crossings: CrossingView[];
  level_crossings: LevelCrossingView[];
  counts: { errors: number; warnings: number; track_km: number; route_km: number };
  bbox: [number, number, number, number] | null;
}

export interface TrackHit {
  track: number;
  s: number;
  side: number;
  distance: number;
  tracks: number;
  straight: boolean;
  spacing: number;
}

/** The railway engine (WebAssembly), injectable for tests. */
export interface RailEngine {
  build(doc: Network, draft: number | null): RailView;
  nearestTrack(at: LonLat, maxM: number): TrackHit | null;
  chainage(track: number, at: LonLat): number;
  toLocal(origin: LonLat, at: LonLat): [number, number];
  defaultParams(mode: RailMode): ModeParams;
  sample(mode: RailMode, at: LonLat): Network;
  /** Track topology of the last build for railway operations (contracts/rail-topology.schema.json). */
  topology(): unknown;
  /** Add the streets of one OSM XML street tile, so the next build finds level crossings. */
  addStreetTile(xml: string): number;
  /** Forget all streets. */
  clearStreets(): void;
  dispose(): void;
}

export type RailEngineLoader = () => Promise<RailEngine>;

/** Types of the noise plugin's `noise_estimate` calculation (Rust `noise::EstimateInput`, `noise-wasm`). */

export type LonLat = [number, number];
export type NoiseMode =
  | "bus"
  | "brt"
  | "trolleybus"
  | "intercity_bus"
  | "tram"
  | "light_rail"
  | "metro"
  | "commuter_rail"
  | "regional_rail"
  | "long_distance_rail"
  | "high_speed_rail";
export type Indicator = "lden" | "lnight";

/** Vehicles per hour in each period (day 07–19, evening 19–23, night 23–07 average). */
export interface Flows {
  day: number;
  evening: number;
  night: number;
}

export interface NoiseRange {
  from_m: number;
  to_m: number;
  kind: "underground" | "bridge" | "embedded" | "switch";
  height_m?: number;
}

/** One drawn line as a noise source. */
export interface NoiseLine {
  id: string;
  label?: string;
  mode: NoiseMode;
  electric?: boolean;
  vehicle_length_m: number;
  flows: Flows;
  points: LonLat[];
  /** `[chainage m, km/h]` along the line. */
  speed?: [number, number][];
  speed_kmh?: number;
  ranges?: NoiseRange[];
  stops_m?: number[];
}

/** An OSM building footprint (API building tiles); the engine fills a missing height from storeys or a default. */
export interface NoiseBuilding {
  id: string;
  ring: LonLat[];
  height_m?: number;
  levels?: number;
}

/**
 * Ground heights on a regular grid (Copernicus GLO-30 through the terrain API): south-west sample
 * `x0` longitude, `y0` latitude, spacing `dx`, `dy` in degrees, heights row by row from the
 * south-west, longitude fastest; null where there is no data.
 */
export interface NoiseTerrain {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  z: (number | null)[];
}

export interface NoiseInput {
  lines: NoiseLine[];
  grid?: boolean;
  /** How far the map reaches from the lines, m; the editors leave it to the band edges. */
  grid_reach_m?: number;
  overrides?: Record<string, number>;
  /** Buildings that screen the map (GIS tab noise map). */
  buildings?: NoiseBuilding[];
  /** Ground heights the map stands on (GIS tab noise map). */
  terrain?: NoiseTerrain | null;
}

/** Buildings counted by the reporting band (Directive 2002/49/EC Annex VI) of their most exposed side. */
export interface NoiseExposure {
  count: number;
  /** Buildings the map reaches. */
  reached: number;
  lden: { from_db: number[]; buildings: number[] };
  lnight: { from_db: number[]; buildings: number[] };
}

export interface NoiseBand {
  threshold_db: number;
  /** Median distance either side at the low, central and high end of the assumption ranges, m. */
  typical_m: [number, number, number];
  max_m: number;
  max_at: LonLat | null;
  probes: number;
}

export interface NoiseCheck {
  severity: "warning" | "info";
  text: string;
  at: LonLat | null;
  line: string | null;
}

export interface NoiseView {
  lden: NoiseBand;
  lnight: NoiseBand;
  checks: NoiseCheck[];
  /** Map picture corners: top left, top right, bottom right, bottom left. */
  image: {
    width: number;
    height: number;
    cell_m: number;
    coordinates: [LonLat, LonLat, LonLat, LonLat];
  } | null;
  input_level: "planned" | "timetabled" | "simulated";
  /** With buildings only. */
  buildings?: NoiseExposure | null;
  /** `[L_den, L_night]` beside each input building, null where the map does not reach. */
  building_levels?: [number | null, number | null][];
  /** Whether terrain heights shaped the map (flat ground leaves it false). */
  terrain?: boolean;
}

/** The noise engine (WebAssembly), injectable for tests. */
export interface NoiseEngine {
  estimate(input: NoiseInput): NoiseView;
  /** RGBA pixels of the last estimate, north row first; colours start at `fromDb`. */
  image(indicator: Indicator, fromDb: number, alpha: number): Uint8Array;
  dispose(): void;
}

export type NoiseEngineLoader = () => Promise<NoiseEngine>;

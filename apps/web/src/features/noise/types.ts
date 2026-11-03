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

export interface NoiseInput {
  lines: NoiseLine[];
  grid?: boolean;
  overrides?: Record<string, number>;
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
}

/** The noise engine (WebAssembly), injectable for tests. */
export interface NoiseEngine {
  estimate(input: NoiseInput): NoiseView;
  /** RGBA pixels of the last estimate, north row first; colours start at `fromDb`. */
  image(indicator: Indicator, fromDb: number, alpha: number): Uint8Array;
  dispose(): void;
}

export type NoiseEngineLoader = () => Promise<NoiseEngine>;

/**
 * Types of the JSON exchanged with the street-routing WebAssembly walk analysis (Rust crate `street-routing`,
 * module `walk`, ADR-0035 §5–§6), as the GIS tab uses it.
 */
export type LonLat = [number, number];

/** How people walk (`walk::WalkSettings`). */
export interface WalkSettings {
  walk_speed_kmh: number;
  crossing_delay_s: number;
  step_free: boolean;
  max_snap_m: number;
}

/** A stop or station (`walk::StopPoint`). */
export interface StopPoint {
  id: string;
  lon: number;
  lat: number;
}

/** A place where people are, with how many (`walk::DemandPoint`). */
export interface DemandPoint {
  lon: number;
  lat: number;
  weight: number;
}

/** `walk::CoverageRequest`. */
export interface CoverageRequest {
  stops: StopPoint[];
  groups: { label: string; stops: number[]; metric: "time" | "distance"; limit: number }[];
  demand: DemandPoint[] | null;
  study_area: [number, number, number, number];
  settings: WalkSettings;
  list_uncovered: number;
  street_cells_m: number | null;
}

/** `walk::CoverageResult`. */
export interface CoverageResult {
  demand_kind: "points" | "street_length_m" | "street_cells";
  total: number;
  covered: number;
  share: number;
  buffer_share: number;
  groups: { label: string; covered: number; share: number }[];
  minutes_bands: { from_min: number; to_min: number | null; demand: number }[];
  study_area: [number, number, number, number];
  stops_off_network: string[];
  demand_off_network: number;
  /** Uncovered demand, largest first; `nearest` is the walk time to the nearest stop, s (null: unreachable). */
  uncovered: { lon: number; lat: number; weight: number; nearest: number | null }[];
}

/** `walk::SpacingRequest`. */
export interface SpacingRequest {
  stops: StopPoint[];
  route: LonLat[] | null;
  guidance_m: [number, number] | null;
  settings: WalkSettings;
}

/** Summary statistics (`walk::Stats`). */
export interface Stats {
  count: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}

/** `walk::SpacingResult`. */
export interface SpacingResult {
  geometry: "route" | "straight";
  segments: {
    from: string;
    to: string;
    along_m: number;
    straight_m: number;
    walk_m: number | null;
    flag: "short" | "long" | null;
  }[];
  along: Stats;
  walk: Stats;
  histogram: { from_m: number; to_m: number; count: number }[];
  short: number;
  long: number;
}

/** The walk analysis engine: walk tiles go in with `addOsm`, then `build`. */
export interface WalkEngine {
  addOsm(xml: string): void;
  build(): void;
  ready(): boolean;
  coverage(req: CoverageRequest): CoverageResult;
  /** The walk network within `maxMinutes` of the stops, each edge with `minutes` to the nearest one. */
  catchment(stops: StopPoint[], maxMinutes: number, settings: WalkSettings): CatchmentGeoJson;
  /** Works without a walk network; then the on-foot distances stay empty. */
  spacing(req: SpacingRequest): SpacingResult;
  dispose(): void;
}

export type WalkEngineLoader = () => Promise<WalkEngine>;

/** Fetches the OSM XML with the walkable ways of one zoom-14 tile. */
export type WalkTileFetcher = (x: number, y: number) => Promise<string>;

/** The walk network round the stops: one line per walkable edge with minutes to the nearest stop. */
export interface CatchmentGeoJson {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "LineString"; coordinates: LonLat[] };
    properties: { minutes: number; stop: string | null };
  }[];
}

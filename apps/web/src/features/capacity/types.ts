/** Types of the rail capacity run (crates/rail-sim/src/capacity.rs), as the WebAssembly module returns them. */

/** Plain verdict, best first. */
export type Verdict = "works" | "near_limit" | "over_limit" | "delays_pile_up" | "not_enough_capacity";

/** Settings of a run; every field is optional (missing ones take the module's defaults). */
export interface CapacityParams {
  from_s: number;
  to_s: number;
  warmup_s: number;
  recovery_s: number;
  min_buffer_s: number;
  occupancy_limit_share: number;
  spare_share: number;
  late_threshold_s: number;
  stability_runs: number;
  delayed_share: number;
  primary_delay_mean_s: number;
  primary_delay_max_s: number;
  residual_delay_s: number;
  seed: number;
}

/** One frequency of a line, planned, run and tested. */
export interface Point {
  headway_s: number;
  per_hour: number;
  unplaced: number;
  consumption: number;
  terminal: string;
  terminal_share: number;
  bottleneck: string;
  bottleneck_share: number;
  theoretical_per_hour: number;
  limit_per_hour: number;
  punctuality: number;
  max_delay_s: number;
  knock_on_s: number;
  disturbed_punctuality: number;
  residual_delay_s: number;
  stable: boolean;
  problems: string[];
  verdict: Verdict;
}

export interface LineResult {
  line: string;
  name: string;
  planned: Point;
}

export interface CapacityRun {
  params: CapacityParams;
  verdict: Verdict;
  lines: LineResult[];
  fleet: { trips: number; vehicles: number; peak_out: number; reserve: number; routes_locked: number };
  issues: string[];
}

/** A line as loaded, with its service bands. */
export interface LineInfo {
  id: string;
  name: string;
  bands: { from_s: number; to_s: number; headway_s: number }[];
}

/** A network and its lines, ready for runs (a web worker in the app, a fake in tests). */
export interface CapacityEngine {
  lines(): Promise<LineInfo[]>;
  notes(): Promise<string[]>;
  run(p: Partial<CapacityParams>): Promise<CapacityRun>;
  sweepHeadways(p: Partial<CapacityParams>, line: number, works: boolean): Promise<number[]>;
  sweepPoint(p: Partial<CapacityParams>, line: number, headwayS: number): Promise<Point>;
  dispose(): void;
}

/** What to load: the example metro, or the railway editor's topology export with a lines file (JSON texts). */
export type NetworkSource = { kind: "example" } | { kind: "files"; topology: string; lines: string };

export type EngineLoader = (src: NetworkSource) => Promise<CapacityEngine>;

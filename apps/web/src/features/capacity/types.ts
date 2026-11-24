/** Types of the rail capacity run (crates/rail-sim/src/capacity.rs), as the WebAssembly module returns them. */

import type { EngineMsg, EngineNote } from "../../i18n/engine";

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
  /** The project's signalling and driving values (assumption library keys); absent ones keep the defaults. */
  signalling?: Partial<Record<SignallingField, number>>;
}

/** Signalling and driving values of a capacity run (crates/rail-sim/src/capacity.rs `Signalling`). */
export type SignallingField =
  | "route_setting_s"
  | "sight_reaction_s"
  | "release_s"
  | "sighting_m"
  | "overlap_release_s"
  | "approach_release_s"
  | "barrier_closing_s"
  | "signal_closing_s"
  | "moving_block_margin_m"
  | "supervision_tolerance_kmh"
  | "emergency_brake_factor"
  | "ato_brake_share"
  | "terminal_separation_s";

/** The bottleneck section of a line (crates/rail-sim `BottleneckSection`). */
export interface BottleneckSection {
  kind: "plain" | "switches" | "platform" | "on_sight";
  length_m: number;
  /** Track (topology section id) of its longest piece, and that piece's chainage range, m. */
  track: string;
  from_m: number;
  to_m: number;
  speed_kmh: number;
  /** Shortest block at that speed: the line's train's braking distance plus the sighting distance, m. */
  block_m: number;
  protection: "line_of_sight" | "fixed_block" | "cbtc" | "etcs_l2";
}

/** One frequency of a line, planned, run and tested. */
export interface Point {
  headway_s: number;
  per_hour: number;
  unplaced: number;
  /** Passenger trips that ran, over the period and its margins (absent in runs saved before it was kept). */
  trips?: number;
  consumption: number;
  terminal: string;
  terminal_share: number;
  bottleneck: string;
  bottleneck_share: number;
  /** What the bottleneck section is, for the advice (absent in runs saved before it was kept). */
  bottleneck_section?: BottleneckSection;
  theoretical_per_hour: number;
  limit_per_hour: number;
  punctuality: number;
  max_delay_s: number;
  knock_on_s: number;
  disturbed_punctuality: number;
  residual_delay_s: number;
  stable: boolean;
  problems: string[];
  /** The same as messages, to show in the app language (runs saved earlier have none). */
  problem_msgs?: EngineMsg[];
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
  /** The same as messages, to show in the app language (runs saved earlier have none). */
  issue_msgs?: EngineMsg[];
}

/** A line as loaded, with its service bands. */
export interface LineInfo {
  id: string;
  name: string;
  bands: { from_s: number; to_s: number; headway_s: number }[];
}

/**
 * The replay of a test run's period without random delays (crates/rail-sim `capacity::Replay`): where every
 * train's head is, frame by frame.
 */
export interface RailReplay {
  /** First frame, s after midnight, and the time between frames, s. */
  begin: number;
  frame_s: number;
  frames: number;
  /** Topology section id of each track the positions refer to, and where the track starts on it, m. */
  tracks: [string, number][];
  /** The lines with service in the period: id and name. */
  lines: [string, string][];
  trains: {
    vehicle: number;
    /** Index in `lines`. */
    line: number;
    /** Three numbers per frame: index in `tracks` (-1: no position), chainage on that track m, speed km/h. */
    s: number[];
    /** Passenger calls, four numbers each: planned departure, arrival, departure (-1: not reached), kind. */
    st: number[];
  }[];
  /** Why the run stopped early, if it did (in English, and as a message for the app language). */
  stopped: string | null;
  stopped_msg?: EngineMsg | null;
}

/** A network and its lines, ready for runs (a web worker in the app, a fake in tests). */
export interface CapacityEngine {
  lines(): Promise<LineInfo[]>;
  notes(): Promise<EngineNote[]>;
  run(p: Partial<CapacityParams>): Promise<CapacityRun>;
  sweepHeadways(p: Partial<CapacityParams>, line: number, works: boolean): Promise<number[]>;
  sweepPoint(p: Partial<CapacityParams>, line: number, headwayS: number): Promise<Point>;
  /** The replay of the period without random delays, one frame every `frameS` seconds. */
  replay(p: Partial<CapacityParams>, frameS: number): Promise<RailReplay>;
  dispose(): void;
}

/** What to load: the railway drawn in the project, as its topology and its lines (JSON texts). */
export type NetworkSource = { topology: string; lines: string };

export type EngineLoader = (src: NetworkSource) => Promise<CapacityEngine>;

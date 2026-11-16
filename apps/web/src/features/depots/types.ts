/**
 * Road depots as the project saves them (drawing kind `depots`, contracts/depot.schema.json) and the
 * reports of the depot layout WebAssembly module (Rust `crates/depot-layout`).
 */
import type { LonLat, Mode } from "../street-lines/types";

export type GateKind = "entrance" | "exit" | "both";
export type ZoneKind = "parking" | "charging" | "maintenance" | "reserve" | "circulation";
export type LaneAngle = 90 | 60 | 45;

export interface Gate {
  id: string;
  kind: GateKind;
  /** On the depot outline. */
  lonlat: LonLat;
}

export interface Zone {
  id: string;
  kind: ZoneKind;
  ring: LonLat[];
  /** Lanes to aisles: 90 straight, 60 or 45 angled. */
  angle_deg: LaneAngle;
  /** Vehicles one behind the other in a lane; null: the project value or fewer, whichever holds most. */
  vehicles_per_lane: number | null;
  /** The vehicle the slots are sized for (a vehicle key); null: the longest of the lines using the depot. */
  vehicle: string | null;
  aisle_width_m: number | null;
  heading_deg: number | null;
}

export interface Slot {
  id: string;
  center: LonLat;
  /** Direction the parked vehicle faces, degrees clockwise from north. */
  heading_deg: number;
  length_m: number;
  width_m: number;
  charger: boolean;
}

/** A drive-through lane: in at `entry`, out at `exit`; slots from the exit end. */
export interface Lane {
  id: string;
  zone: string;
  kind: Exclude<ZoneKind, "circulation">;
  entry: LonLat;
  exit: LonLat;
  width_m: number;
  aisle_in: string | null;
  aisle_out: string | null;
  slots: Slot[];
}

export interface Aisle {
  id: string;
  zone: string;
  coords: LonLat[];
  width_m: number;
  two_way?: boolean;
}

export interface Layout {
  lanes: Lane[];
  aisles: Aisle[];
}

/** One depot, shared by all street lines whose vehicles fit it. */
export interface SavedDepot {
  id: string;
  name: string;
  /** Street modes the depot takes. */
  modes: Mode[];
  boundary: LonLat[];
  gates: Gate[];
  zones: Zone[];
  /** Null until the first auto layout. */
  layout: Layout | null;
}

export interface DepotsDoc {
  depots: SavedDepot[];
}

/** A vehicle the depot holds, for slot sizes and the swept-path check (Rust `VehicleSpec`). */
export interface VehicleSpec {
  /** Catalogue id, or `mode:<mode>` for the mode's typical vehicle. */
  key: string;
  name: string;
  length_m: number;
  width_m: number;
  articulations: number;
  axles_m: number[] | null;
  turning_circle_m: number | null;
}

/** The vehicles of one street line in the depot (Rust `FleetGroup`). */
export interface FleetGroup {
  /** `street:<index>`, as in the cost estimate. */
  line: string;
  name: string;
  vehicle: string;
  /** Vehicles with spares. */
  count: number;
  /** Battery vehicles that charge in the depot. */
  charging: boolean;
}

/** Project values `depot.*` (Rust `Rules`). */
export interface DepotRules {
  vehicles_per_lane: number;
  lateral_spacing_m: number;
  walkway_width_m: number;
  walkway_every_n_lanes: number;
  aisle_width_m: number;
  longitudinal_gap_m: number;
  turning_circle_m: number;
  swept_clearance_m: number;
  charger_power_kw: number;
}

/** What the depot layout functions take (Rust `DepotInput`). */
export interface DepotInput {
  boundary: LonLat[];
  gates: Gate[];
  zones: Zone[];
  vehicles: VehicleSpec[];
  fleet: FleetGroup[];
  rules: DepotRules;
  layout: Layout | null;
}

export interface Issue {
  severity: "error" | "warning" | "info";
  /** A zone, lane, gate or line id, or null for the whole depot. */
  subject: string | null;
  message: string;
}

export interface Generated {
  layout: Layout;
  issues: Issue[];
}

export interface LaneCheck {
  lane: string;
  vehicle: string;
  entry_ok: boolean;
  exit_ok: boolean;
  message: string | null;
}

export interface NetEdge {
  id: string;
  kind: "gate" | "aisle" | "lane" | "drive";
  from: string;
  to: string;
  one_way: boolean;
  coords: LonLat[];
  length_m: number;
  of?: string;
}

export interface Reach {
  lane: string;
  from_entrance: boolean;
  to_exit: boolean;
  in_m: number | null;
  out_m: number | null;
}

export interface CapacityRow {
  vehicle: string;
  name: string;
  length_m: number;
  needed: number;
  charging_needed: number;
  fitting_slots: number;
  fitting_charging: number;
  placed: number;
}

export interface Assignment {
  line: string;
  vehicle: number;
  lane: string;
  slot: string;
  charger: boolean;
}

export interface Capacity {
  slots: { parking: number; charging: number; maintenance: number; reserve: number };
  chargers: number;
  charger_power_kw: number;
  rows: CapacityRow[];
  fleet: number;
  assignments: Assignment[];
  issues: Issue[];
}

export interface Report {
  lanes: LaneCheck[];
  network: { nodes: { id: string; lonlat: LonLat }[]; edges: NetEdge[] };
  reach: Reach[];
  capacity: Capacity;
  issues: Issue[];
}

export interface Footprint {
  angle_deg: number;
  area_m2: number;
  width_m: number;
  depth_m: number;
  bands: number;
  lanes_per_band: number;
  aisle_m: number;
}

export interface Sizing {
  vehicle: string;
  area_m2: number;
  fleet: number;
  footprints: Footprint[];
  holds: { angle_deg: number; vehicles: number }[];
}

/** The depot layout module as the depot tool uses it. */
export interface DepotEngine {
  generate(input: DepotInput): Generated;
  analyse(input: DepotInput): Report;
  size(input: DepotInput): Sizing;
  /** Body outlines a vehicle sweeps driving into and out of a lane. */
  envelope(input: DepotInput, lane: string): LonLat[][];
}

export type DepotEngineLoader = () => Promise<DepotEngine>;

/** The planner's street setup from the GIS tab (Rust `street_routing::setup`). */

import type { LonLat } from "../street-lines/types";

/** How a tram along the street shares it with road traffic. */
export type TramShare = "own_lane" | "mixed";

/**
 * One street (OSM way) as the planner set it up. `null` or a missing field keeps what OpenStreetMap
 * says. `name` and `at` are for the list in the GIS tab; the engines ignore them.
 */
export interface StreetSetup {
  way: number;
  /** General traffic lanes over both directions, not counting bus or tram lanes. */
  traffic_lanes?: number | null;
  /** A bus lane in each direction of travel. */
  bus_lane?: boolean | null;
  /** A bike lane in each direction of travel. */
  bike_lane?: boolean | null;
  /** A kerb, barrier or track bed between the bus or tram lane and the traffic. */
  separated?: boolean | null;
  /** A tram along this street: own lane or mixed traffic. */
  tram?: TramShare | null;
  /** Street name when it was set up, for the list. */
  name?: string;
  /** A point on the street, to show it again. */
  at?: LonLat;
}

/** A street as OpenStreetMap describes it (Rust `StreetInfo`). */
export interface StreetInfo {
  way: number;
  name: string;
  /** OSM `highway` value. */
  class: string;
  /** Trunk, primary or secondary road. */
  main_road: boolean;
  oneway: boolean;
  /** OSM `lanes` (bus lanes included), when tagged. */
  lanes: number | null;
  width_m: number | null;
  maxspeed_kmh: number | null;
  bus_lane: boolean;
  bike_lane: boolean;
  /** Tram rails in the street. */
  tram: boolean;
  coords: LonLat[];
}

/** Parses one OSM XML tile into the streets the GIS tab can set up. */
export type StreetInfoParser = (xml: string) => StreetInfo[];
/** Loads the parser (the street-routing WebAssembly module); tests inject a fake. */
export type StreetInfoLoader = () => Promise<StreetInfoParser>;

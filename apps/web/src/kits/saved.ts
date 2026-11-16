import type { PluginLineInput } from "../features/journey-planner/network";
import type { LonLat, StationKind } from "./types";

/** What the noise map needs of a cable car or people mover line, as the straight spans kit built it. */
export interface SpanNoiseShape {
  kit: "straight-spans";
  /** Plugin mode id (`cable_car`, `aerial_tramway`, `people_mover`…). */
  mode: string;
  /** Ropeway system or guideway type (the mode's context, such as `mgd` or `3s`). */
  system: string;
  /** Rope or train runs all the time (gondolas) or back and forth (aerial tramways, shuttles). */
  operation: "continuous" | "reversible";
  /** Seconds between departures in each direction. */
  headway_s: number;
  /** End-to-end running and dwell time one way, s. */
  trip_time_s: number;
  stations: { lonlat: LonLat; kind: StationKind }[];
  /** Height of the rope (or guideway) above the station floor, m: where the station's sound comes from. */
  station_height_m: number;
  towers: { lonlat: LonLat; height_m: number }[];
}

/** What the noise map needs of a ferry line, as the water route kit built it. */
export interface WaterNoiseShape {
  kit: "water-route";
  mode: string;
  /** Vessel type (the mode's context, such as `monohull`). */
  vessel: string;
  /** Seconds between departures in each direction. */
  headway_s: number;
  /** The legs one way, in calling order. */
  legs: { path: LonLat[]; length_m: number; time_s: number }[];
  /** Seconds a vessel lies at each pier per round trip: dwell at every call both ways, layover at the ends. */
  berths: { lonlat: LonLat; name: string; docked_s: number }[];
}

export type NoiseShape = SpanNoiseShape | WaterNoiseShape;

/** One plugin tool's line as saved with the project. */
export interface SavedPluginLine {
  kit: "straight-spans" | "water-route";
  /** The editor's drawing (`SpanDoc` or `WaterDoc`). */
  doc: unknown;
  /** The line for the journey planner, or null when it has fewer than two stops. */
  line: PluginLineInput | null;
  /** The shape for the noise map, or null when the line is not complete. */
  noise: NoiseShape | null;
}

/** The project's "plugin-lines" drawing: each plugin tool's line by tool id. */
export interface PluginLinesDoc {
  tools: Record<string, SavedPluginLine>;
}

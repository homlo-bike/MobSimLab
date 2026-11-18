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

/**
 * Purpose: the keys of one plugin tool's lines in the "plugin-lines" drawing, in order: the tool id for its first
 * line, then `<tool id>-2`, `<tool id>-3`… for more lines (ferry: several routes in one project).
 * Inputs: the saved lines by key, the tool id. Output: the keys of that tool's lines, first line first.
 */
export function toolLineKeys(tools: Record<string, unknown>, toolId: string): string[] {
  const n = (k: string) => (k === toolId ? 1 : Number(k.slice(toolId.length + 1)));
  return Object.keys(tools)
    .filter((k) => k === toolId || new RegExp(`^${toolId.replace(/[^a-z0-9-]/g, "")}-[0-9]+$`).test(k))
    .sort((a, b) => n(a) - n(b));
}

/** Purpose: a key for a new line of a plugin tool, not used yet (the tool id when the tool has no line). */
export function newToolLineKey(tools: Record<string, unknown>, toolId: string): string {
  if (!(toolId in tools)) return toolId;
  for (let i = 2; ; i++) if (!(`${toolId}-${i}` in tools)) return `${toolId}-${i}`;
}

/**
 * Purpose: the tool a saved plugin line belongs to, from its key: `ferry` and `ferry-2` both belong to the
 * ferry tool. Inputs: the line's key, the ids of the tools to match. Output: the tool id, or null when the key
 * belongs to none of them (for example a tool whose plugin is off).
 */
export function lineToolId(key: string, toolIds: Iterable<string>): string | null {
  for (const id of toolIds)
    if (key === id || (key.startsWith(`${id}-`) && /^[0-9]+$/.test(key.slice(id.length + 1)))) return id;
  return null;
}

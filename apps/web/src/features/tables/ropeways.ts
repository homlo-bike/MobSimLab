/**
 * The cable car lines of the plugin tools (ADR-0037) as the Tables tab needs them: length, stations, running
 * time, cabin interval, service day, cabins and capacity. Worked out from the saved line (the drawing and the
 * shape the straight spans kit built), with the plugin's parameter values, so lines saved by an older build
 * count too. Cable cars run the same service on every day type.
 */
import { projectServiceDay, type PluginLineInput, type ServiceDay } from "../journey-planner/network";
import type { SavedPluginLine, SpanNoiseShape } from "../../kits/saved";
import { distanceKm } from "../../map/geo";
import { activePlugins, findMode, type Plugin, type Range } from "../../plugins/registry";

/** Plugin modes that run cabins on a rope. */
export const ROPEWAY_MODES: ReadonlySet<string> = new Set(["cable_car", "aerial_tramway"]);

/** One cable car line with its service on a day. */
export interface RopewayLine {
  /** "plugin:<tool id>", as in the journey planner and the benefit estimate. */
  id: string;
  name: string;
  /** Plugin mode (`cable_car`, `aerial_tramway`) and ropeway system (`mgd`, `3s`, `reversible`…). */
  mode: string;
  system: string;
  color: string;
  operation: SpanNoiseShape["operation"];
  /** The line for the journey planner (its timetable). */
  line: PluginLineInput;
  /** Stations, including the terminals. */
  stations: number;
  /** Along the rope from the first to the last station, km. */
  lengthKm: number;
  /** One way, with the passages through the stations, s. */
  tripS: number;
  /** Seconds between cabins (continuous) or departures (reversible) in each direction. */
  headwayS: number;
  /** First and last departure, seconds after midnight. */
  firstS: number;
  lastS: number;
  /** Cabins on the line during service, and with the reserve. */
  inService: number;
  fleet: number;
  /** Passengers per cabin. */
  placesPerCabin: number;
  /** Cabin departures a day, both directions. */
  tripsPerDay: number;
  /** Cabin-hours and cabin-km a day. */
  cabinHoursPerDay: number;
  cabinKmPerDay: number;
}

/** Purpose: a plugin parameter's range for a mode and ropeway system, else for the mode, else null. */
export function ropewayParam(
  key: string,
  mode: string,
  system: string,
  plugins: readonly Plugin[] = activePlugins(),
): Range | null {
  const d = findMode(mode, plugins)?.plugin.defaults[mode];
  return d?.[system]?.[key] ?? d?.["*"]?.[key] ?? null;
}

/**
 * Purpose: a plugin parameter's value for a line: the project's own (Project preferences → All parameters,
 * `<key>.<mode>` for the mode, else `<key>`), else the library's central value for the mode and context, else
 * `fallback`.
 */
export function ropewayValue(
  key: string,
  mode: string,
  context: string,
  fallback: number,
  prefs: Readonly<Record<string, number>> | null | undefined,
  plugins: readonly Plugin[] = activePlugins(),
): number {
  for (const id of [`${key}.${mode}`, key]) {
    const v = prefs?.[id];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return ropewayParam(key, mode, context, plugins)?.central ?? fallback;
}

/**
 * Purpose: the cable car lines saved with the project, with their service on a day.
 * Inputs: the saved plugin lines by tool id, the service day (the project's by default), the plugins on, and
 * the project's own parameter values (Project preferences).
 * Output: one entry per complete cable car or aerial tramway line whose plugin is on, in tool order.
 */
export function ropewayLines(
  tools: Readonly<Record<string, SavedPluginLine>> | null | undefined,
  day: ServiceDay = projectServiceDay(),
  plugins: readonly Plugin[] = activePlugins(),
  prefs?: Readonly<Record<string, number>> | null,
): RopewayLine[] {
  const out: RopewayLine[] = [];
  for (const [toolId, saved] of Object.entries(tools ?? {})) {
    const x = saved.noise;
    const line = saved.line;
    if (!x || x.kit !== "straight-spans" || !ROPEWAY_MODES.has(x.mode) || !line) continue;
    if (x.stations.length < 2 || !(x.headway_s > 0) || !(x.trip_time_s > 0)) continue;
    // A plugin the project has turned off takes its lines out of the tables and the costs.
    if (!findMode(x.mode, plugins)) continue;
    let lengthM = 0;
    for (let i = 1; i < x.stations.length; i++)
      lengthM += distanceKm(x.stations[i - 1]!.lonlat, x.stations[i]!.lonlat) * 1000;
    const central = (key: string, fallback: number) =>
      ropewayValue(`ropeway.${key}`, x.mode, x.system, fallback, prefs, plugins);
    const doc = (saved.doc ?? {}) as { lineSpeed?: unknown };
    const speed =
      typeof doc.lineSpeed === "number" && doc.lineSpeed > 0 ? doc.lineSpeed : central("line_speed_ms", 6);
    const continuous = x.operation === "continuous";
    // As the straight spans kit counts them: cabins spaced along both sides of the moving rope, or the two
    // cabins of an aerial tramway.
    const onLine = continuous ? (2 * lengthM) / (speed * x.headway_s) : 2;
    const inService = continuous ? Math.ceil(onLine - 1e-9) : 2;
    const fleet = continuous ? Math.ceil(onLine * (1 + central("reserve_share", 0.1)) - 1e-9) : 2;
    const serviceS = Math.max(0, day.lastS - day.firstS);
    const tripsPerDay = serviceS > 0 ? 2 * (Math.floor(serviceS / x.headway_s) + 1) : 0;
    out.push({
      id: `plugin:${toolId}`,
      name: line.name || toolId,
      mode: x.mode,
      system: x.system,
      color: line.color,
      operation: x.operation,
      line,
      stations: x.stations.length,
      lengthKm: lengthM / 1000,
      tripS: x.trip_time_s,
      headwayS: x.headway_s,
      firstS: day.firstS,
      lastS: day.lastS,
      inService,
      fleet,
      placesPerCabin: central("cabin_capacity", 10),
      tripsPerDay,
      cabinHoursPerDay: (inService * serviceS) / 3600,
      cabinKmPerDay: (tripsPerDay * lengthM) / 1000,
    });
  }
  return out;
}

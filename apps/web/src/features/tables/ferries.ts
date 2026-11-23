/**
 * The ferry lines of the plugin tools (ADR-0037) as the Tables tab needs them: length, piers, running time,
 * headway, service day, vessels and capacity. Worked out from the saved line (the drawing and the shape the
 * water route kit built), with the ferry plugin's parameter values. Ferries run the same service on every
 * day type, as the journey planner runs them.
 */
import { projectServiceDay, type PluginLineInput, type ServiceDay } from "../journey-planner/network";
import type { SavedPluginLine } from "../../kits/saved";
import { activePlugins, findMode, type Plugin } from "../../plugins/registry";
import { ropewayValue } from "./ropeways";

/** One ferry line with its service on a day. */
export interface FerryLine {
  /** "plugin:<line key>", as in the journey planner and the benefit estimate. */
  id: string;
  name: string;
  /** Plugin mode (`ferry`) and vessel type (`monohull`, `catamaran`, `hydrofoil`). */
  mode: string;
  vessel: string;
  color: string;
  /** The line for the journey planner (its timetable). */
  line: PluginLineInput;
  /** Piers, including the terminals. */
  piers: number;
  /** Along the route one way, km. */
  lengthKm: number;
  /** One way, with the dwell at the calls between, s. */
  tripS: number;
  /** A vessel's round trip with the layovers, s. */
  cycleS: number;
  /** Seconds between departures in each direction. */
  headwayS: number;
  /** First and last departure, seconds after midnight. */
  firstS: number;
  lastS: number;
  /** Vessels on the line during service, and with the reserve. */
  inService: number;
  fleet: number;
  /** Passengers per vessel. */
  placesPerVessel: number;
  /** Departures a day, both directions. */
  tripsPerDay: number;
  /** Vessel-hours and vessel-km a day. */
  vesselHoursPerDay: number;
  vesselKmPerDay: number;
}

/**
 * Purpose: the ferry lines saved with the project, with their service on a day.
 * Inputs: the saved plugin lines by line key, the service day (the project's by default), the plugins on for
 * the project, and the project's own parameter values (Project preferences). Output: one entry per complete ferry
 * line whose plugin is on, in saved order.
 */
export function ferryLines(
  tools: Readonly<Record<string, SavedPluginLine>> | null | undefined,
  day: ServiceDay = projectServiceDay(),
  plugins: readonly Plugin[] = activePlugins(),
  prefs?: Readonly<Record<string, number>> | null,
): FerryLine[] {
  const out: FerryLine[] = [];
  for (const [key, saved] of Object.entries(tools ?? {})) {
    const x = saved.noise;
    const line = saved.line;
    if (!x || x.kit !== "water-route" || !line || x.legs.length < 1 || !(x.headway_s > 0)) continue;
    // A plugin the project has turned off takes its lines out of the tables and the costs.
    if (!findMode(x.mode, plugins)) continue;
    const central = (k: string, fallback: number) =>
      ropewayValue(`ferry.${k}`, x.mode, x.vessel, fallback, prefs, plugins);
    const headwayS = Math.max(60, x.headway_s);
    const lengthM = x.legs.reduce((s, l) => s + l.length_m, 0);
    const runS = x.legs.reduce((s, l) => s + l.time_s, 0);
    // The kit spreads the slack of the timetable over the terminals, so the time docked plus twice the
    // running time is a whole number of headways: the vessels the line needs.
    const cycleS = 2 * runS + x.berths.reduce((s, b) => s + b.docked_s, 0);
    const inService = Math.max(1, Math.round(cycleS / headwayS));
    const fleet = Math.ceil(inService * (1 + central("reserve_share", 0.2)) - 1e-9);
    const fwd = line.directions[0] ?? [];
    const tripS = fwd.reduce((s, c) => s + c.run_s, 0) + fwd.slice(1, -1).reduce((s, c) => s + c.dwell_s, 0);
    const serviceS = Math.max(0, day.lastS - day.firstS);
    const tripsPerDay = serviceS > 0 ? 2 * (Math.floor(serviceS / headwayS) + 1) : 0;
    out.push({
      id: `plugin:${key}`,
      name: line.name || key,
      mode: x.mode,
      vessel: x.vessel,
      color: line.color,
      line,
      piers: x.berths.length,
      lengthKm: lengthM / 1000,
      tripS: tripS > 0 ? tripS : runS,
      cycleS,
      headwayS,
      firstS: day.firstS,
      lastS: day.lastS,
      inService,
      fleet,
      placesPerVessel: central("passenger_capacity", 250),
      tripsPerDay,
      vesselHoursPerDay: (inService * serviceS) / 3600,
      vesselKmPerDay: (tripsPerDay * lengthM) / 1000,
    });
  }
  return out;
}

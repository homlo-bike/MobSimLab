/**
 * The service a street line runs through the day, from its timing: the service day for the journey planner
 * and the benefit timetable, and the trips and vehicle-hours a weekday for the tables and the costs.
 */
import { DEFAULT_SERVICE_DAY, servicePeriods, type ServiceDay } from "../journey-planner/network";
import { fullTiming, type Timing } from "./modes";
import { streetVehicles } from "../fleet/registry";
import type { CatalogueVehicle, Mode, VehicleProfile } from "./types";

/** Purpose: the line's service day: its first and last departure, with the planner's peak windows. */
export function lineServiceDay(timing: Partial<Timing> | undefined): ServiceDay {
  const t = fullTiming(timing);
  return { ...DEFAULT_SERVICE_DAY, firstS: t.firstMin * 60, lastS: t.lastMin * 60 };
}

/** What the line runs on a weekday. */
export interface DayService {
  /** Hours from the first to the last departure. */
  serviceHours: number;
  /** Departures a weekday in each direction, both directions together. */
  tripsPerDay: number;
  /** Vehicle-hours a weekday: in each period, the vehicles its headway needs, for as long as it lasts. */
  vehicleHours: number;
}

/**
 * Purpose: hours, trips and vehicle-hours a weekday of a line with a circuit of `cycleMin` minutes.
 * Each direction leaves once per headway in each period (peak or off peak); a period of the service day
 * needs `ceil(cycle / headway)` vehicles on the road.
 */
export function dayService(timing: Partial<Timing> | undefined, cycleMin: number): DayService {
  const t = fullTiming(timing);
  const day = lineServiceDay(t);
  const serviceHours = Math.max(0, day.lastS - day.firstS) / 3600;
  if (t.headwayMin <= 0 || t.offPeakHeadwayMin <= 0 || day.lastS <= day.firstS)
    return { serviceHours, tripsPerDay: 0, vehicleHours: 0 };
  const periods = servicePeriods(day, t.headwayMin * 60, t.offPeakHeadwayMin * 60);
  let departures = 0;
  let vehicleHours = 0;
  for (const p of periods) {
    const span = p.end_time - p.start_time;
    // Departures at the start of the period and every headway after it (the last period ends just after
    // the last departure).
    departures += Math.ceil(span / p.headway_secs);
    const vehicles = cycleMin > 0 ? Math.ceil((cycleMin * 60) / p.headway_secs) : 0;
    vehicleHours += (vehicles * span) / 3600;
  }
  return { serviceHours, tripsPerDay: departures * 2, vehicleHours };
}

/** Purpose: the catalogue and own vehicles of a street mode. */
export function vehiclesFor(
  mode: Mode,
  all: readonly CatalogueVehicle[] = streetVehicles(),
): CatalogueVehicle[] {
  return all.filter((v) => v.mode === mode);
}

/** Purpose: a catalogue vehicle by id, or null (none chosen, or no longer in the catalogue). */
export function vehicleById(
  id: string | null | undefined,
  all: readonly CatalogueVehicle[] = streetVehicles(),
): CatalogueVehicle | null {
  return (id && all.find((v) => v.id === id)) || null;
}

/**
 * Purpose: the routing profile with a catalogue vehicle's length, height, weight and top speed; the mode's
 * values stay where the catalogue has none. Battery range and doors stay as the planner set them.
 */
export function profileWith(profile: VehicleProfile, v: CatalogueVehicle): VehicleProfile {
  return {
    ...profile,
    length_m: v.length_m,
    height_m: v.height_m ?? profile.height_m,
    weight_t: v.weight_t ?? profile.weight_t,
    max_speed_kmh: v.top_speed_kmh,
  };
}

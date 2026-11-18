/**
 * The values of the assumption library that have a section of their own, where the project sets them. All
 * parameters (Project preferences) leaves them out, so each value is set in one place only.
 */
import { appraisalSettingGroups, BUILT_IN } from "../features/appraisal/model";
import { PARAMS as BENEFIT_PARAMS } from "../features/benefits/params";
import { PARAMS as COST_PARAMS } from "../features/costs/params";
import { DEMAND_PARAMS } from "../features/demand/params";
import { ELECTRIC_SHARE, GRID } from "../features/energy/params";
import { DELAY_PREFS, SAME_NAME_PREF } from "./preferences";

/** Road traffic outside the peak (Project preferences → Road traffic). */
export const OFF_PEAK_PREF = "road.off_peak_traffic_share";
/** The longest wait at an end stop (Tables → Timetables). */
export const TERMINAL_WAIT_PREF = "timetable.max_terminal_wait_min";
/** The spare vehicles kept on top of those in service, per mode (Tables → Timetables). */
export const SPARE_PREF = "mode.spare_share";
/** Riders of a day type as a share of a weekday's (Simulator → Calendar run). */
export const RIDER_SHARE_PREFS = [
  "benefit.ridership.saturday_share",
  "benefit.ridership.sunday_share",
  "benefit.ridership.holiday_share",
] as const;

/**
 * Cost library values the cost model uses without a line of its own in Tables → Costs (units used): they stay in
 * All parameters.
 */
const COST_WITHOUT_ROW = new Set([
  "cost.single_track_share",
  "cost.opex.car_length_m",
  "cost.service_hours_per_day",
  "cost.price_base_year",
  "mode.vehicle_capacity",
]);

const OWN_SECTION: ReadonlySet<string> = new Set([
  // Project preferences → Demand model.
  ...DEMAND_PARAMS.map((p) => p.key),
  // Project preferences → Stations.
  SAME_NAME_PREF,
  // Project preferences → Running time in traffic and Road simulation.
  ...DELAY_PREFS.map((p) => p.id),
  OFF_PEAK_PREF,
  // Tables → Costs (units used, prices), Benefits (parameters), Appraisal (settings), Energy, Timetables.
  ...Object.keys(COST_PARAMS).filter((k) => !COST_WITHOUT_ROW.has(k)),
  ...Object.keys(BENEFIT_PARAMS),
  ...appraisalSettingGroups(null).flatMap((g) => g.keys),
  ...BUILT_IN.map((c) => `appraisal.mca.weight.${c.id}`),
  GRID,
  ELECTRIC_SHARE,
  TERMINAL_WAIT_PREF,
  SPARE_PREF,
  // Simulator → Calendar run.
  ...RIDER_SHARE_PREFS,
]);

/** Purpose: whether a library parameter is set in a section of its own rather than in All parameters. */
export function hasOwnSection(id: string): boolean {
  return OWN_SECTION.has(id);
}

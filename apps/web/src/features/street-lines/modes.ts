import type { MessageKey } from "../../i18n/messages";
import type { DayServices } from "../timetables/dayTypes";
import type { Mode } from "./types";

/** Display settings per street mode (colours as in the line and track drawing mockup). */
export const MODES: Record<Mode, { label: MessageKey; color: string; profile: MessageKey }> = {
  bus: { label: "mode.bus", color: "#d2392c", profile: "street.profile.bus" },
  brt: { label: "mode.brt", color: "#a3358c", profile: "street.profile.brt" },
  trolleybus: { label: "mode.trolleybus", color: "#1e8a4f", profile: "street.profile.trolleybus" },
  intercity_bus: { label: "mode.intercity_bus", color: "#cf7f00", profile: "street.profile.intercity_bus" },
};

export const MODE_ORDER: Mode[] = ["bus", "brt", "trolleybus", "intercity_bus"];

/** The line's service: headways, stop and terminal times, and the hours it runs. Sample defaults, editable. */
export interface Timing {
  /** Minutes between departures in the peaks (07:00–09:00 and 16:00–19:00); sizes the fleet. */
  headwayMin: number;
  /** Minutes between departures outside the peaks. */
  offPeakHeadwayMin: number;
  dwellS: number;
  layoverMin: number;
  /** First and last departure, minutes after midnight; the last may pass midnight (24:30 is 1470). */
  firstMin: number;
  lastMin: number;
  /** Its own first and last departure and headways on Saturdays, Sundays and holidays; absent: as on a weekday. */
  days?: DayServices;
}

export const DEFAULT_TIMING: Timing = {
  headwayMin: 10,
  offPeakHeadwayMin: 20,
  dwellS: 20,
  layoverMin: 5,
  firstMin: 5 * 60,
  lastMin: 24 * 60 + 30,
};

/**
 * Purpose: a line's timing with every field, for lines saved before the off-peak headway and the service
 * hours existed. Such lines ran every headway off peak and every half headway in the peaks in the journey
 * planner; their headway now counts as the peak headway, off peak twice that.
 */
export function fullTiming(t: Partial<Timing> | undefined): Timing {
  const headwayMin = t?.headwayMin ?? DEFAULT_TIMING.headwayMin;
  return {
    ...DEFAULT_TIMING,
    ...t,
    headwayMin,
    offPeakHeadwayMin: t?.offPeakHeadwayMin ?? headwayMin * 2,
  };
}

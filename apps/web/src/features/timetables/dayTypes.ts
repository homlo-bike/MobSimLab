/**
 * A line's service per day type (FR-TT-03, ADR-0020): weekday, Saturday, Sunday and public holiday. A line keeps
 * its weekday times as before; each other day type copies them until the planner sets its own first and last
 * departure and peak and off-peak headways. The peak windows come from the project calendar's day type.
 */
import type { DayTypeId, ServiceCalendar } from "../../workspace/calendar";
import { serviceDayFor } from "../../workspace/calendar";
import type { ServiceDay } from "../journey-planner/network";
import type { EngineServiceLine, ServiceLine } from "../railways/types";
import { fullTiming, type Timing } from "../street-lines/modes";

/** Day types a line can set its own service for (weekday is the line's own times). */
export type OtherDayType = Exclude<DayTypeId, "weekday">;
export const OTHER_DAY_TYPES: readonly OtherDayType[] = ["saturday", "sunday", "holiday"];

/** A line's service on one day type, minutes (the last departure may pass 24:00). */
export interface DayService {
  firstMin: number;
  lastMin: number;
  peakHeadwayMin: number;
  offPeakHeadwayMin: number;
}

/** A line's own service on the other day types; a day type that is absent runs as on a weekday. */
export type DayServices = Partial<Record<OtherDayType, DayService>>;

/** Purpose: whether a value is a usable day service (times in order, headways of at least a minute). */
export function validDay(d: DayService | undefined): d is DayService {
  return (
    !!d &&
    [d.firstMin, d.lastMin, d.peakHeadwayMin, d.offPeakHeadwayMin].every(Number.isFinite) &&
    d.lastMin > d.firstMin &&
    d.peakHeadwayMin >= 1 &&
    d.offPeakHeadwayMin >= 1
  );
}

/** Purpose: the service of a day type: the line's own, else its weekday service. */
export function dayServiceOf(weekday: DayService, days: DayServices | undefined, day: DayTypeId): DayService {
  if (day === "weekday") return weekday;
  const own = days?.[day];
  return validDay(own) ? own : weekday;
}

/** Purpose: whether the line has its own service for a day type (valid or still being typed). */
export function hasOwnDay(days: DayServices | undefined, day: DayTypeId): boolean {
  return day !== "weekday" && !!days?.[day];
}

/** Purpose: the service a line's fields show for a day type: its own as typed, else the weekday's. */
export function shownDay(weekday: DayService, days: DayServices | undefined, day: DayTypeId): DayService {
  return (day !== "weekday" && days?.[day]) || weekday;
}

/** Purpose: the days with one day type set (`DayService`) or back to the weekday's (`null`); absent when empty. */
export function withDay(
  days: DayServices | undefined,
  day: OtherDayType,
  value: DayService | null,
): DayServices | undefined {
  const next: DayServices = { ...(days ?? {}) };
  if (value) next[day] = value;
  else delete next[day];
  return Object.keys(next).length ? next : undefined;
}

/** Purpose: a street line's weekday service from its timing. */
export function streetWeekday(t: Partial<Timing> | undefined): DayService {
  const f = fullTiming(t);
  return {
    firstMin: f.firstMin,
    lastMin: f.lastMin,
    peakHeadwayMin: f.headwayMin,
    offPeakHeadwayMin: f.offPeakHeadwayMin,
  };
}

/** Purpose: a street line's timing on a day type: its weekday timing with that day's times and headways. */
export function streetTimingFor(t: Partial<Timing> | undefined, day: DayTypeId): Timing {
  const f = fullTiming(t);
  const d = dayServiceOf(streetWeekday(f), f.days, day);
  return {
    ...f,
    firstMin: d.firstMin,
    lastMin: d.lastMin,
    headwayMin: d.peakHeadwayMin,
    offPeakHeadwayMin: d.offPeakHeadwayMin,
  };
}

/** Purpose: a rail service line's weekday service. */
export function railWeekday(l: ServiceLine): DayService {
  return {
    firstMin: l.first_min,
    lastMin: l.last_min,
    peakHeadwayMin: l.peak_headway_min,
    offPeakHeadwayMin: l.offpeak_headway_min,
  };
}

/** Purpose: a rail service line on a day type: its weekday line with that day's times and headways. */
export function railLineFor(l: ServiceLine, day: DayTypeId): ServiceLine {
  const d = dayServiceOf(railWeekday(l), l.days, day);
  return {
    ...l,
    first_min: d.firstMin,
    last_min: d.lastMin,
    peak_headway_min: d.peakHeadwayMin,
    offpeak_headway_min: d.offPeakHeadwayMin,
  };
}

/** Purpose: the engine's lines with the day type's peak windows from the calendar (seconds). */
export function withPeaks(lines: EngineServiceLine[], day: ServiceDay): EngineServiceLine[] {
  return lines.map((l) => ({ ...l, peaks: day.peaks.map(([a, b]) => [a, b] as [number, number]) }));
}

/** Purpose: the service day of a line on a day type: its own first and last departure, the calendar's peaks. */
export function lineDay(cal: ServiceCalendar, day: DayTypeId, s: DayService): ServiceDay {
  return { ...serviceDayFor(cal, day), firstS: s.firstMin * 60, lastS: s.lastMin * 60 };
}

/**
 * Purpose: change a line's service on one day type. On a weekday the line's own times change; on another day
 * type the change starts that day's own service from what it runs now (the weekday's until then).
 */
export function editDay(
  weekday: DayService,
  days: DayServices | undefined,
  day: DayTypeId,
  patch: Partial<DayService>,
): { weekday: DayService; days: DayServices | undefined } {
  if (day === "weekday") return { weekday: { ...weekday, ...patch }, days };
  return { weekday, days: withDay(days, day, { ...shownDay(weekday, days, day), ...patch }) };
}

/**
 * Platform accessibility check (FR-NET-08, 08-vehicles.md §5): for each stop of a service line, the step and
 * gap between the platform edge and the train's floor, judged against the TSI PRM limits, and whether the
 * platform is long enough for the train. Every limit is a design rule the project can change in Preferences.
 *
 * Station tracks are straight (ADR-0030 point 2), so the horizontal gap is the platform edge's distance from the
 * track centre less half the train's body width, with no allowance for curve throw.
 */
import { ruleValue } from "../../workspace/preferences";
import type { CatalogueTrain, Network, RailMode, ServiceLine } from "./types";

/** Level access, a step within the limits, a boarding aid needed (ramp, lift, gap filler), or a clash. */
export type Access = "level" | "step" | "aid" | "clash";

/** The limits and platform values the check uses for one mode. */
export interface AccessRules {
  level_gap_horizontal_mm: number;
  level_gap_vertical_mm: number;
  step_gap_horizontal_mm: number;
  step_above_platform_mm: number;
  step_below_platform_mm: number;
  /** Floor height assumed for a train whose catalogue entry has none, mm. */
  vehicle_floor_height_mm: number;
  platform_height_mm: number;
  platform_edge_offset_m: number;
  stopping_tolerance_m: number;
}

const FIELDS: (keyof AccessRules)[] = [
  "level_gap_horizontal_mm",
  "level_gap_vertical_mm",
  "step_gap_horizontal_mm",
  "step_above_platform_mm",
  "step_below_platform_mm",
  "vehicle_floor_height_mm",
  "platform_height_mm",
  "platform_edge_offset_m",
  "stopping_tolerance_m",
];

/**
 * Purpose: the project's limits and platform values for a mode (its own where set, else the library's).
 * Input: the project's design values as `designValuesFrom` gives them (`<mode>.<field>`), or null.
 */
export function accessRules(
  values: Readonly<Record<string, number>> | null | undefined,
  mode: RailMode,
): AccessRules {
  const out = {} as AccessRules;
  for (const f of FIELDS) out[f] = ruleValue(values, f, mode) ?? 0;
  return out;
}

/** One stop of a line. */
export interface StopAccess {
  station: number;
  name: string;
  platform_height_mm: number;
  floor_height_mm: number;
  /** The train has no floor height in the catalogue; the mode's default was used. */
  floor_assumed: boolean;
  /** Floor minus platform, mm: positive when passengers step up into the train. */
  vertical_mm: number;
  /** Platform edge to the train's side, mm; null when the train's width is unknown. */
  horizontal_mm: number | null;
  access: Access;
  platform_length_m: number;
  /** Train length (all units) plus the stopping tolerance, m. */
  needed_length_m: number;
  train_length_m: number;
  stopping_tolerance_m: number;
}

/** Purpose: judge one door position against the limits. */
export function judge(vertical: number, horizontal: number | null, r: AccessRules): Access {
  const h = horizontal ?? 0;
  if (horizontal !== null && horizontal < 0) return "clash";
  if (Math.abs(vertical) <= r.level_gap_vertical_mm && h <= r.level_gap_horizontal_mm) return "level";
  if (
    vertical <= r.step_above_platform_mm &&
    -vertical <= r.step_below_platform_mm &&
    h <= r.step_gap_horizontal_mm
  )
    return "step";
  return "aid";
}

/**
 * Purpose: the platform access and length check at every stop of a line.
 * Input: the drawing, the line, its train, and the rules per mode (`accessRules`).
 * Output: one entry per stop that exists in the drawing, in the line's order.
 */
export function lineAccess(
  doc: Network,
  line: ServiceLine,
  train: CatalogueTrain,
  rulesFor: (mode: RailMode) => AccessRules,
): StopAccess[] {
  const units = Math.max(1, Math.round(line.units));
  const trainLength = train.length_m * units;
  const own = train.floor_height_mm;
  return line.stations.flatMap((id) => {
    const st = doc.stations.find((s) => s.id === id);
    if (!st) return [];
    const r = rulesFor(st.mode ?? doc.mode);
    const floor = own ?? rulesFor(train.mode).vehicle_floor_height_mm;
    const vertical = floor - r.platform_height_mm;
    const horizontal =
      train.width_m === null ? null : Math.round((r.platform_edge_offset_m - train.width_m / 2) * 1000);
    return [
      {
        station: id,
        name: st.name,
        platform_height_mm: r.platform_height_mm,
        floor_height_mm: floor,
        floor_assumed: own === null,
        vertical_mm: Math.round(vertical),
        horizontal_mm: horizontal,
        access: judge(vertical, horizontal, r),
        platform_length_m: st.platform_length_m,
        needed_length_m: trainLength + r.stopping_tolerance_m,
        train_length_m: trainLength,
        stopping_tolerance_m: r.stopping_tolerance_m,
      },
    ];
  });
}

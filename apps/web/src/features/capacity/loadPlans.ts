import { paramValue as costParam } from "../costs/params";
import { engineLines } from "../railways/serviceLines";
import type { Network } from "../railways/types";
import type { SavedStreetLine } from "../street-lines/saved";
import { departures, type StreetRunParams, streetStops } from "./streetRun";
import type { CapacityParams, LineInfo } from "./types";

const H = 3600;

/** Purpose: the test settings that the street run shares with the capacity run. */
export function pickStreetParams(a: Partial<CapacityParams>): Partial<StreetRunParams> {
  const out: Partial<StreetRunParams> = {};
  for (const k of [
    "stability_runs",
    "seed",
    "late_threshold_s",
    "residual_delay_s",
    "warmup_s",
    "recovery_s",
  ] as const)
    if (a[k] !== undefined && Number.isFinite(a[k])) out[k] = a[k];
  return out;
}

/** Periods to pick from; "custom" lets the planner type the times. */
export const PERIODS = [
  { id: "am", from: 7 * H, to: 9 * H },
  { id: "midday", from: 11 * H, to: 13 * H },
  { id: "pm", from: 16 * H, to: 18 * H },
  { id: "evening", from: 20 * H, to: 22 * H },
] as const;

/** A line of the drawn network as the passenger loads see it, before the boardings are known. */
export interface LoadPlan {
  key: string;
  id: string;
  name: string;
  mode: string;
  sequences: string[][];
  loop: boolean;
  capacity: number;
  perHour: (hourS: number) => number;
}

/** Purpose: the drawn rail lines for the loads: stops by station name both ways, the train's places. */
export function railLoadPlans(railway: Network, infos: LineInfo[]): LoadPlan[] {
  const name = new Map(railway.stations.map((s) => [`st${s.id}`, s.name]));
  return engineLines(railway).map((l) => {
    const stops = l.stations.map((id) => name.get(id) ?? id);
    const bands = infos.find((i) => i.id === l.id)?.bands ?? [];
    return {
      key: `rail:${l.id}`,
      id: l.id,
      name: l.name,
      mode: l.mode,
      sequences: [stops, [...stops].reverse()],
      loop: false,
      capacity: l.vehicle.capacity * l.units,
      perHour: (h) => {
        const b = bands.find((x) => h + 1800 >= x.from_s && h + 1800 < x.to_s);
        return b && b.headway_s > 0 ? 3600 / b.headway_s : 0;
      },
    };
  });
}

/** Purpose: the street lines for the loads: stops in riding order, the mode's places per vehicle. */
export function streetLoadPlans(
  streets: readonly { line: SavedStreetLine; index: number }[],
  prefs: Record<string, number> | undefined,
): LoadPlan[] {
  return streets.map(({ line, index }) => {
    const { sequences, loop } = streetStops(line);
    return {
      key: `street:${index}`,
      id: `street:${index}`,
      name: line.name,
      mode: line.profile.mode,
      sequences,
      loop,
      capacity: costParam("mode.vehicle_capacity", line.profile.mode, prefs)[1],
      perHour: (h) => departures(line, h, h + 3600).length,
    };
  });
}

/**
 * Purpose: the road run's scenario from the project: each street line's circuit, departures in the run's
 * window, depot runs and vehicle; the depots the lines use with their driving network and a slot per vehicle
 * (the depot layout engine's `analyse`); the GIS tab's street setup and traffic peaks; the project values.
 */
import { stopName } from "../capacity/streetRun";
import { depotInput, lineVehicle } from "../depots/model";
import type { DepotEngine, SavedDepot } from "../depots/types";
import { projectServiceDay, servicePeriods } from "../journey-planner/network";
import { fullTiming } from "../street-lines/modes";
import { type SavedStreetLine, streetLineColor } from "../street-lines/saved";
import { lineServiceDay } from "../street-lines/service";
import type { JunctionSetup, StreetSetup } from "../street-setup/types";
import type { PreferencesDoc } from "../../workspace/preferences";
import { central } from "./params";
import type { Energy, RoadDepot, RoadLine, RoadScenario } from "./types";

/** Why a street line is left out of the road run. */
export type LineProblem = "notRouted" | "noService";

export interface BuiltScenario {
  scenario: RoadScenario;
  /** Lines left out, by their index in the project's street lines. */
  skipped: { index: number; name: string; problem: LineProblem }[];
  /** Lines that run without a shared depot (they start and end on the street). */
  noDepot: { index: number; name: string }[];
}

/** Purpose: a line's planned departures from its first stop in `[from, to)`, as the journey planner has them. */
export function lineDepartures(line: SavedStreetLine, from: number, to: number): number[] {
  const t = fullTiming(line.timing);
  if (t.headwayMin <= 0 || t.offPeakHeadwayMin <= 0) return [];
  const out: number[] = [];
  for (const p of servicePeriods(lineServiceDay(t), t.headwayMin * 60, t.offPeakHeadwayMin * 60)) {
    for (let s = p.start_time; s < p.end_time; s += p.headway_secs) if (s >= from && s < to) out.push(s);
  }
  return out;
}

/** Purpose: what a line's vehicle runs on: a trolleybus, a battery vehicle, or anything else. */
export function lineEnergy(line: SavedStreetLine): Energy {
  if (line.profile.mode === "trolleybus") return "trolleybus";
  return lineVehicle(line).battery ? "battery" : "other";
}

/**
 * Purpose: one street line for the road run, or the reason it cannot run. The circuit starts at the line's
 * first end stop (as in the system test); leg k runs from point k to point k + 1, the last back to point 0.
 */
export function roadLine(
  line: SavedStreetLine,
  index: number,
  from: number,
  to: number,
  prefs: PreferencesDoc["values"] | undefined,
  depotIds: ReadonlySet<string>,
): RoadLine | LineProblem {
  const v = line.view;
  const n = v.points.length;
  if (n < 2 || v.legs.length !== n || v.points.filter((p) => p.kind !== "via").length < 2) return "notRouted";
  if (v.legs.some((l) => l.coords.length < 2)) return "notRouted";
  const departures = lineDepartures(line, from, to);
  if (!departures.length) return "noService";
  const s = Math.max(
    0,
    v.points.findIndex((p) => p.kind === "end_stop"),
  );
  const order = Array.from({ length: n }, (_, j) => (s + j) % n);
  const at = (pointId: number) => {
    const i = v.points.findIndex((p) => p.id === pointId);
    return i < 0 ? 0 : (i - s + n) % n;
  };
  const trip = (kind: "pull_out" | "pull_in") => {
    const d = v.depot_trips.find((x) => x.kind === kind && x.coords.length >= 2);
    return d ? { coords: d.coords, time_s: d.time_s, at: at(d.stop) } : null;
  };
  const t = fullTiming(line.timing);
  const mode = line.profile.mode;
  const energy = lineEnergy(line);
  const veh = lineVehicle(line);
  return {
    index,
    name: line.name || `Street line ${index + 1}`,
    mode,
    color: streetLineColor(line),
    vehicle: {
      length_m: veh.length_m,
      width_m: veh.width_m,
      max_speed_kmh: line.profile.max_speed_kmh,
      weight_t: line.profile.weight_t,
      energy,
      battery_kwh: energy === "other" ? null : central("road.battery_capacity_kwh", mode, prefs),
      hvac_kw: central("energy.hvac_power_kw", mode, prefs),
    },
    dwell_s: t.dwellS,
    layover_s: t.layoverMin * 60,
    points: order.map((i) => {
      const p = v.points[i]!;
      return { name: stopName(p), kind: p.kind, lonlat: p.lonlat };
    }),
    legs: order.map((i) => ({ coords: v.legs[i]!.coords, time_s: v.legs[i]!.time_s })),
    departures,
    pull_out: trip("pull_out"),
    pull_in: trip("pull_in"),
    depot: line.depotId && depotIds.has(line.depotId) ? line.depotId : null,
  };
}

/** Purpose: a depot for the road run: its driving network and a slot for each vehicle of its lines. */
export function roadDepot(
  depot: SavedDepot,
  lines: readonly SavedStreetLine[],
  prefs: PreferencesDoc["values"] | undefined,
  engine: Pick<DepotEngine, "analyse">,
): RoadDepot {
  const report = engine.analyse(depotInput(depot, lines, prefs));
  return {
    id: depot.id,
    name: depot.name,
    network: report.network,
    lanes: (depot.layout?.lanes ?? []).map((l) => ({
      id: l.id,
      slots: l.slots.map((x) => ({
        id: x.id,
        center: x.center,
        heading_deg: x.heading_deg,
        length_m: x.length_m,
        charger: x.charger,
      })),
    })),
    assignments: report.capacity.assignments,
  };
}

/**
 * Purpose: the whole scenario of a road run for the period `[from, to)` with `warmup` seconds of service
 * before it. Lines the planner did not tick are left out without a message, and so are the depots only they
 * use. Depots without a layout are left out (their lines start and end on the street).
 */
export function buildScenario(input: {
  lines: readonly SavedStreetLine[];
  depots: readonly SavedDepot[];
  setups: readonly StreetSetup[];
  /** The GIS tab's junction setups: traffic lights given to or taken from junctions. */
  junctions?: readonly JunctionSetup[];
  prefs: PreferencesDoc["values"] | undefined;
  from: number;
  to: number;
  warmup: number;
  /** The lines the planner ticked, by their index in `lines`; left out, every line runs. */
  picked?: (index: number) => boolean;
  /** Null for a preview: which lines run and which depots they use, without the depots' networks. */
  engine: Pick<DepotEngine, "analyse"> | null;
}): BuiltScenario {
  const { lines, prefs } = input;
  const laidOut = input.depots.filter((d) => (d.layout?.lanes.length ?? 0) > 0);
  const ids = new Set(laidOut.map((d) => d.id));
  const out: RoadLine[] = [];
  const skipped: BuiltScenario["skipped"] = [];
  const noDepot: BuiltScenario["noDepot"] = [];
  lines.forEach((line, index) => {
    if (input.picked && !input.picked(index)) return;
    const r = roadLine(line, index, input.from - input.warmup, input.to, prefs, ids);
    const name = line.name || `Street line ${index + 1}`;
    if (typeof r === "string") skipped.push({ index, name, problem: r });
    else {
      out.push(r);
      if (!r.depot) noDepot.push({ index, name });
    }
  });
  const used = new Set(out.map((l) => l.depot).filter((d): d is string => d !== null));
  const engine = input.engine;
  const depots = engine
    ? laidOut.filter((d) => used.has(d.id)).map((d) => roadDepot(d, lines, prefs, engine))
    : [];
  const side = lines.find((l) => l.rules?.traffic_side)?.rules.traffic_side ?? "right";
  return {
    scenario: {
      driving_side: side,
      lines: out,
      depots,
      streets: input.setups.map((s) => ({
        way: s.way,
        oneway: s.oneway ?? null,
        traffic_lanes: s.traffic_lanes ?? null,
        bus_lane: s.bus_lane ?? null,
        sections: s.sections ?? null,
        cars_morning_peak: s.cars_morning_peak ?? null,
        cars_evening_peak: s.cars_evening_peak ?? null,
      })),
      junctions: (input.junctions ?? []).map((j) => ({ nodes: j.nodes, signals: j.signals })),
      traffic: {
        defaults: {
          trunk: central("street.peak_cars_trunk_vph", "*", prefs),
          primary: central("street.peak_cars_primary_vph", "*", prefs),
          secondary: central("street.peak_cars_secondary_vph", "*", prefs),
          tertiary: central("street.peak_cars_tertiary_vph", "*", prefs),
          local: central("street.peak_cars_local_vph", "*", prefs),
        },
        off_peak_share: central("road.off_peak_traffic_share", "*", prefs),
        peaks: projectServiceDay().peaks.map(([a, b]) => [a, b] as [number, number]),
      },
      trolley_charge_kw: central("road.trolley_wire_charge_kw", "*", prefs),
    },
    skipped,
    noDepot,
  };
}

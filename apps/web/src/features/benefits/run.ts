/**
 * Runs the steps of the benefit estimate that need the journey planner (ADR-0040): travel times between
 * stations in every scenario, then what each station's zone reaches.
 */
import type { ReachLoader, Timetable } from "../journey-planner/types";
import type { Estimate as CostEstimate } from "../costs/model";
import { isConstruction } from "../costs/model";
import type { Triple } from "./params";
import {
  access,
  matrix,
  type Prepared,
  type ReachFn,
  scenarios,
  scenarioTimetable,
  type Spending,
  type ZoneAccess,
} from "./model";

/** Purpose: what every zone reaches in every scenario (whole network, none, without each line and mode). */
export async function accessByScenario(
  P: Prepared,
  tt: Timetable,
  load: ReachLoader,
  prefs: Record<string, number> | undefined,
): Promise<Map<string, ZoneAccess[]>> {
  const out = new Map<string, ZoneAccess[]>();
  const stopsOf = P.zones.map((z) => P.net.stations.find((s) => s.id === z.id)?.stopIds ?? []);
  for (const s of scenarios(P.net)) {
    const part = scenarioTimetable(tt, s);
    if (!part) {
      out.set(s.key, access(P.zones, matrix(P.zones, stopsOf, null), prefs));
      continue;
    }
    const engine = await load(part, {});
    try {
      const reach: ReachFn = (from, t0) => {
        const r = engine.reach(from, t0);
        return new Map(r.stop_ids.map((id, i) => [id, r.arrive_s[i] ?? null]));
      };
      out.set(s.key, access(P.zones, matrix(P.zones, stopsOf, reach), prefs));
    } finally {
      engine.dispose();
    }
  }
  return out;
}

type Group = keyof Spending;

/** Purpose: which spending group a cost category belongs to. */
export function groupOf(category: string): Group {
  if (!isConstruction(category as never)) return "operating";
  if (category === "vehicles") return "vehicles";
  if (category === "systems" || category === "switches") return "systems";
  return "civil";
}

/**
 * Purpose: construction and operating spending per line from the cost tables, split into civil works,
 * systems, vehicles and operation. Items of one line count for it; items shared by a mode go to its lines by
 * vehicle-km, as in the cost tables, or to `:<mode>` when no line of the mode runs.
 */
export function spendingFrom(e: CostEstimate | null): Map<string, Spending> {
  const out = new Map<string, Spending>();
  if (!e) return out;
  const z = (): Triple => [0, 0, 0];
  const add = (id: string, g: Group, t: Triple, k: number) => {
    const row = out.get(id) ?? { civil: z(), systems: z(), vehicles: z(), operating: z() };
    row[g] = [row[g][0] + t[0] * k, row[g][1] + t[1] * k, row[g][2] + t[2] * k];
    out.set(id, row);
  };
  for (const x of e.items) {
    const g = groupOf(x.category);
    if (x.line) {
      add(x.line, g, x.amount, 1);
      continue;
    }
    const users = e.lines.filter((l) => l.mode === x.mode && l.kmPerYear > 0);
    const total = users.reduce((s, l) => s + l.kmPerYear, 0);
    if (!total) add(`:${x.mode}`, g, x.amount, 1);
    else for (const l of users) add(l.id, g, x.amount, l.kmPerYear / total);
  }
  return out;
}

/**
 * What the appraisal reads from the other tables (ADR-0045): the cost tables' spending per line, the benefit
 * tables' ridership, GDP growth and access, the demand run's users' benefit and car-km saved, and the fare
 * revenue table's ridership growth.
 */
import { tNow } from "../../i18n/i18n";
import type { Estimate as BenefitEstimate } from "../benefits/model";
import { modeLabel } from "../costs/CostTables";
import { paramValue as benefitValue, type Triple } from "../benefits/params";
import { spendingFrom } from "../benefits/run";
import type { Estimate as CostEstimate } from "../costs/model";
import type { DemandRidership } from "../demand/ridership";
import { type AppraisalLine, type McaLine, ridershipGrowth } from "./model";

const ZERO: Triple = [0, 0, 0];

/**
 * Purpose: the lines of the appraisal. Every line with costs or ridership counts; a mode's shared items that
 * no line runs on yet count in the mode and the total. The demand run's users' benefit and car-km saved go to
 * the lines by their share of the run's weekday boardings.
 * Inputs: the cost estimate, the benefit estimate, the demand run's ridership (null without a run), project
 * preferences, and the fare revenue table's own values. Output: the lines. No side effects.
 */
export function appraisalLines(
  costs: CostEstimate | null,
  benefits: BenefitEstimate | null,
  demand: DemandRidership | null,
  prefs: Record<string, number> | undefined,
  faresOwn: Record<string, number> | undefined,
): AppraisalLine[] {
  const spending = spendingFrom(costs);
  const rows = new Map((benefits?.rows ?? []).filter((r) => r.scope === "line").map((r) => [r.id, r]));
  const meta = new Map((costs?.lines ?? []).map((l) => [l.id, l]));
  const ids = [...new Set([...rows.keys(), ...[...spending.keys()].filter((k) => !k.startsWith(":"))])];
  const a = demand?.appraisal ?? null;
  const boardings = demand ? Object.values(demand.lines).reduce((s, v) => s + v, 0) : 0;
  const share = (id: string) => (a && boardings > 0 ? (demand!.lines[id] ?? 0) / boardings : 0);
  const out: AppraisalLine[] = [];
  for (const id of ids) {
    const r = rows.get(id);
    const m = meta.get(id);
    const mode = r?.mode ?? m?.mode;
    if (!mode) continue;
    const sp = spending.get(id) ?? { civil: ZERO, systems: ZERO, vehicles: ZERO, operating: ZERO };
    out.push({
      id,
      name: r?.name ?? m?.name ?? id,
      mode,
      color: r?.color ?? m?.color ?? "#475569",
      shown: true,
      spending: sp,
      annual: r?.values.ridership_annual ?? ZERO,
      gdp: r?.values.gdp ?? ZERO,
      userDay: a ? a.user_benefit * share(id) : null,
      carKmDay: a ? a.car_vehicle_km_saved * share(id) : null,
      days: benefitValue("benefit.ridership.days_per_year", mode, prefs)[1],
      growth: ridershipGrowth(mode, faresOwn),
    });
  }
  for (const [key, sp] of spending) {
    if (!key.startsWith(":")) continue;
    const mode = key.slice(1);
    out.push({
      id: key,
      name: tNow("apr.shared", { mode: modeLabel(mode) }),
      mode,
      color: "#94a3b8",
      shown: false,
      spending: sp,
      annual: ZERO,
      gdp: ZERO,
      userDay: a ? 0 : null,
      carKmDay: a ? 0 : null,
      days: benefitValue("benefit.ridership.days_per_year", mode, prefs)[1],
      growth: ridershipGrowth(mode, faresOwn),
    });
  }
  return out;
}

/** Purpose: the multi-criteria inputs per line from the appraisal's ENPV and the benefit tables. */
export function mcaLines(
  lines: AppraisalLine[],
  enpv: Map<string, number>,
  benefits: BenefitEstimate | null,
): McaLine[] {
  const rows = new Map((benefits?.rows ?? []).map((r) => [r.id, r]));
  return lines
    .filter((l) => l.shown)
    .map((l) => {
      const acc = rows.get(l.id)?.access;
      const gain = (keys: ("jobs" | "school" | "university" | "hospital" | "clinic")[]) =>
        acc ? keys.reduce((s, k) => s + (acc.after[k] ?? 0) - (acc.before[k] ?? 0), 0) : null;
      return {
        id: l.id,
        name: l.name,
        color: l.color,
        values: {
          enpv: enpv.get(l.id) ?? null,
          ridership: l.annual[1] > 0 ? l.annual[1] : null,
          jobs: gain(["jobs"]),
          education: gain(["school", "university"]),
          healthcare: gain(["hospital", "clinic"]),
          construction_cost: l.spending.civil[1] + l.spending.systems[1] + l.spending.vehicles[1],
        },
      };
    });
}

/**
 * Purpose: the appraisal lines that carry ridership but no costs at all, such as a people mover the cost
 * tables do not price yet. Their benefits and fares still count, which flatters the result.
 * Inputs: the appraisal lines. Output: those lines, in order. No side effects.
 */
export function uncostedLines(lines: readonly AppraisalLine[]): AppraisalLine[] {
  const sum = (x: Triple) => x[0] + x[1] + x[2];
  return lines.filter((l) => {
    const s = l.spending;
    return (
      l.shown && sum(l.annual) > 0 && sum(s.civil) + sum(s.systems) + sum(s.vehicles) + sum(s.operating) === 0
    );
  });
}

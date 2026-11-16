/**
 * The demand model's ridership where the project shows riders (ADR-0019, 09 §2): the benefit tables' ridership
 * rows (and so the service table's Riders column and the fare revenue table), and the system test's passenger
 * loads. The planner picks the run in the Demand section; without one, the Tables tab's formula estimate is used.
 */
import type { Estimate } from "../benefits/model";
import { paramValue, type Triple } from "../benefits/params";
import type { DemandAppraisal, DemandResult } from "./api";

/** A run's weekday boardings: per line id, per line and stop name, and per stop name over all lines. */
export interface DemandRidership {
  runId: string;
  /** When the run finished, for the note. */
  finishedAt: string | null;
  uncalibrated: boolean;
  lines: Record<string, number>;
  stations: Record<string, Record<string, number>>;
  stops: Record<string, number>;
  /** The run's users' benefit and car-km saved, for the appraisal (null for runs made before it). */
  appraisal: DemandAppraisal | null;
}

/** Purpose: a demand run's weekday boardings per line, per line and stop name, and per stop name. */
export function demandRidership(
  runId: string,
  finishedAt: string | null,
  result: DemandResult,
): DemandRidership {
  const lines: Record<string, number> = {};
  const stations: Record<string, Record<string, number>> = {};
  const name = (sid: string) => result.transit.stops[sid]?.name ?? sid;
  for (const l of result.transit.lines) {
    const byStop: Record<string, number> = (stations[l.id] ??= {});
    let total = 0;
    for (const p of l.patterns) {
      const day = p.boardings.day ?? [];
      p.stops.forEach((sid, k) => {
        const v = day[k] ?? 0;
        if (!(v > 0)) return;
        byStop[name(sid)] = (byStop[name(sid)] ?? 0) + v;
        total += v;
      });
    }
    lines[l.id] = (lines[l.id] ?? 0) + total;
  }
  const stops: Record<string, number> = {};
  for (const s of Object.values(result.transit.stops))
    if (s.boardings > 0) stops[s.name] = (stops[s.name] ?? 0) + s.boardings;
  return {
    runId,
    finishedAt,
    uncalibrated: result.uncalibrated,
    lines,
    stations,
    stops,
    appraisal: result.appraisal ?? null,
  };
}

/** Purpose: a model value with the low and high of the formula estimate's spread around it. */
function spread(v: number, formula: Triple): Triple {
  const [lo, mid, hi] = formula;
  if (!(mid > 0)) return [v, v, v];
  return [v * (lo / mid), v, v * (hi / mid)];
}

/**
 * Purpose: the benefit estimate with the demand model's ridership: each line the run has gets the model's
 * weekday boardings as its medium value, with the low and high spread of the formula estimate, and a year's
 * boardings by the mode's weekday equivalents a year. Mode and total rows add up their lines; the boardings by
 * station are the model's. Lines the run does not have keep the formula's numbers.
 */
export function withDemandRidership(
  est: Estimate,
  r: DemandRidership,
  prefs: Record<string, number> | undefined,
): Estimate {
  const lineRows = est.rows.filter((row) => row.scope === "line" && r.lines[row.id] !== undefined);
  if (!lineRows.length) return est;
  const daily = new Map<string, Triple>();
  const annual = new Map<string, Triple>();
  for (const row of est.rows) {
    if (row.scope !== "line" || r.lines[row.id] === undefined) continue;
    const d = spread(r.lines[row.id]!, row.values.ridership_daily);
    const days = paramValue("benefit.ridership.days_per_year", row.mode ?? "*", prefs)[1];
    daily.set(row.id, d);
    annual.set(row.id, [d[0] * days, d[1] * days, d[2] * days]);
  }
  const lineOf = new Map(est.rows.filter((row) => row.scope === "line").map((row) => [row.id, row]));
  const sum = (
    ids: string[],
    m: Map<string, Triple>,
    key: "ridership_daily" | "ridership_annual",
  ): Triple => {
    const out: Triple = [0, 0, 0];
    for (const id of ids) {
      const t = m.get(id) ?? lineOf.get(id)?.values[key] ?? [0, 0, 0];
      out[0] += t[0];
      out[1] += t[1];
      out[2] += t[2];
    }
    return out;
  };
  const rows = est.rows.map((row) => {
    let ids: string[];
    if (row.scope === "line") ids = [row.id];
    else if (row.scope === "mode")
      ids = [...lineOf.values()].filter((l) => l.mode === row.mode).map((l) => l.id);
    else ids = [...lineOf.keys()];
    if (!ids.some((id) => daily.has(id))) return row;
    return {
      ...row,
      values: {
        ...row.values,
        ridership_daily: sum(ids, daily, "ridership_daily"),
        ridership_annual: sum(ids, annual, "ridership_annual"),
      },
    };
  });
  const when = r.finishedAt ? ` of ${new Date(r.finishedAt).toLocaleDateString("en")}` : "";
  return {
    ...est,
    rows,
    stations: {
      ...est.stations,
      ...Object.fromEntries([...daily.keys()].map((id) => [id, r.stations[id] ?? {}])),
    },
    notes: [
      ...est.notes,
      `Ridership is the demand model run${when}${r.uncalibrated ? " (uncalibrated)" : ""}, with the formula's low–high spread.`,
    ],
  };
}

/**
 * Purpose: weekday boardings at each stop name for the system test, from the demand model run: a stop's
 * boardings shared among the test's lines that call there.
 */
export function demandStopBoardings(
  names: readonly string[],
  r: DemandRidership,
  linesAt: (name: string) => number,
): Record<string, number> {
  const byName = new Map(Object.entries(r.stops).map(([k, v]) => [norm(k), v]));
  const out: Record<string, number> = {};
  for (const n of names) {
    const v = byName.get(norm(n));
    if (v !== undefined) out[n] = v / Math.max(1, linesAt(n));
  }
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

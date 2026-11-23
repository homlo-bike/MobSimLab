import { type Translate, type TranslatePlural, translate, translatePlural } from "../../i18n/i18n";
import type { RunStatus, SavedRunDetail } from "./server";
import type { Point, Verdict } from "./types";

/** English, for the helpers when no translator is given (tests, logs). */
const EN: Translate = (key, vars) => translate("en", key, vars);
const EN_N: TranslatePlural = (key, count, vars) => translatePlural("en", key, count, vars);

/** Verdict wording and colours, best first. */
export const VERDICTS: Record<Verdict, { tone: string; rank: number }> = {
  works: { tone: "bg-emerald-100 text-emerald-900 border-emerald-300", rank: 0 },
  near_limit: { tone: "bg-lime-100 text-lime-900 border-lime-300", rank: 1 },
  over_limit: { tone: "bg-amber-100 text-amber-900 border-amber-300", rank: 2 },
  delays_pile_up: { tone: "bg-orange-100 text-orange-900 border-orange-300", rank: 3 },
  not_enough_capacity: { tone: "bg-red-100 text-red-900 border-red-300", rank: 4 },
};

/** Purpose: a verdict's title and one-sentence explanation in the reader's language. */
export function verdictText(v: Verdict, t: Translate = EN): { title: string; text: string } {
  return { title: t(`capacity.verdict.${v}.title`), text: t(`capacity.verdict.${v}.text`) };
}

export const pct = (x: number) => `${Math.round(x * 100)} %`;
export const perHour = (x: number) =>
  Math.abs(x - Math.round(x)) < 0.05 ? `${Math.round(x)}` : x.toFixed(1);
export const secs = (s: number, t: Translate = EN) =>
  s < 90 ? t("capacity.seconds", { n: Math.round(s) }) : t("capacity.minutes", { n: (s / 60).toFixed(1) });
export const every = (h: number, t: Translate = EN) => {
  const m = h / 60;
  return t("capacity.every", { n: Number.isInteger(m) ? m : m.toFixed(1) });
};

/** Purpose: the practical maximum: the highest frequency that works (placed, under the limit, stable). */
export function practicalMaximum(points: Point[]): number | null {
  const ok = points.filter((p) => VERDICTS[p.verdict].rank <= 1).map((p) => p.per_hour);
  return ok.length ? Math.max(...ok) : null;
}

/** Purpose: one sentence that says why a point got its verdict. */
export function explain(p: Point, limit: number, t: Translate = EN, tn: TranslatePlural = EN_N): string {
  if (p.unplaced > 0) return tn("capacity.unplaced", p.unplaced);
  if (p.problems.length && p.verdict === "not_enough_capacity")
    return t("capacity.stopped", { problem: p.problems[0]! });
  const part =
    p.terminal_share > p.consumption
      ? t("capacity.partTerminal", { name: p.terminal })
      : t("capacity.partLine", { name: p.bottleneck });
  const use = t("capacity.busiest", {
    part,
    share: pct(Math.max(p.consumption, p.terminal_share)),
    limit: pct(limit),
  });
  if (!p.stable) return `${use} ${t("capacity.stillLate", { late: secs(p.residual_delay_s, t) })}`;
  return use;
}

/**
 * Purpose: how many of the line's planned trips ran, when some were left out, so the on-time
 * share and the delay figures are read against the trips that ran (Damascus test).
 * Output: null when every planned trip ran.
 */
export function ranText(p: Point, t: Translate = EN, tn: TranslatePlural = EN_N): string | null {
  if (p.unplaced <= 0) return null;
  // Runs saved before the count of trips that ran was kept.
  if (p.trips === undefined) return tn("capacity.notFit", p.unplaced);
  const planned = p.trips + p.unplaced;
  if (p.trips === 0) return t("capacity.noneRan", { planned });
  return t("capacity.ranOf", {
    ran: p.trips,
    planned,
    share: pct(p.trips / planned),
    left: p.unplaced,
  });
}

/** Tag colours of a saved run's status. */
export const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-300",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  cancelled: "bg-amber-50 text-amber-900 border-amber-200",
};

export const isVerdict = (v: string | null): v is Verdict => v !== null && Object.hasOwn(VERDICTS, v);

/** Purpose: what a saved run that is still going is doing now, in the reader's language. */
export function serverStatus(r: SavedRunDetail, t: Translate): string {
  if (r.status === "queued") return t("capacity.waiting");
  if (r.cancelRequested) return t("capacity.stopping");
  const p = r.progress;
  if (p?.step === "sweeping" && p.headway_s !== undefined && p.n !== undefined && p.total !== undefined)
    return t("capacity.trying", { line: p.line, every: every(p.headway_s, t), n: p.n, total: p.total });
  if (p?.step === "sweeping") return t("capacity.tryingOthers");
  return t("capacity.planning");
}

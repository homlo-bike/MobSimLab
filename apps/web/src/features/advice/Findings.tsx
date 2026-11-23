/**
 * What to improve after a run: the problems a simulation found, worst first, each with what the planner can
 * do about it and, where the problem has a place, a button that shows it on the map. Used by the system test
 * (Simulator → Test the system) and the road run (Simulator → Road simulation).
 */
import { useI18n } from "../../i18n/i18n";
import type { LonLat } from "../street-lines/types";

/** How bad a finding is: a problem stops the plan working; a warning works but needs attention. */
export type Severity = "problem" | "warning";

/** One thing a run found, with advice. */
export interface Finding {
  /** Stable key (for React). */
  key: string;
  severity: Severity;
  /** Ranks findings of the same severity: larger is worse. */
  weight: number;
  /** What the run found, in one sentence. */
  title: string;
  /** What to do about it, in one or two sentences. */
  advice: string;
  /** Where it is, when it has a place. */
  at?: LonLat;
}

const ORDER: Record<Severity, number> = { problem: 0, warning: 1 };

/** Purpose: the findings worst first: problems before warnings, then by weight, then by title. */
export function rankFindings(fs: readonly Finding[]): Finding[] {
  return [...fs].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight || a.title.localeCompare(b.title),
  );
}

const TONE: Record<Severity, string> = {
  problem: "border-red-300 bg-red-50",
  warning: "border-amber-300 bg-amber-50",
};

/**
 * Purpose: the ranked list of findings under "What to improve", or a line saying nothing needs it.
 * Inputs: the findings (ranked here), and `onShow` to move the map to a finding's place (no button without it).
 */
export function FindingsList({
  findings,
  onShow,
  limit = 12,
}: {
  findings: readonly Finding[];
  onShow?: (at: LonLat) => void;
  limit?: number;
}) {
  const { t } = useI18n();
  const ranked = rankFindings(findings);
  return (
    <section aria-label={t("advice.title")} className="rounded-xl border border-slate-200 bg-white p-3.5">
      <h3 className="font-semibold">{t("advice.title")}</h3>
      {ranked.length === 0 ? (
        <p className="mt-1 text-sm text-emerald-800">{t("advice.none")}</p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-slate-600">{t("advice.intro")}</p>
          <ol className="mt-2 space-y-1.5">
            {ranked.slice(0, limit).map((f, i) => (
              <li key={f.key} className={`rounded-lg border px-2.5 py-2 text-sm ${TONE[f.severity]}`}>
                <p className="font-medium">
                  <span className="tabular-nums">{i + 1}.</span>{" "}
                  <span className="sr-only">{t(`advice.severity.${f.severity}`)}: </span>
                  {f.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-700">{f.advice}</p>
                {f.at && onShow && (
                  <button
                    type="button"
                    className="mt-1 text-xs font-medium text-blue-800 underline"
                    onClick={() => onShow(f.at!)}
                  >
                    {t("advice.show")}
                  </button>
                )}
              </li>
            ))}
          </ol>
          {ranked.length > limit && (
            <p className="mt-1 text-xs text-slate-500">{t("advice.more", { n: ranked.length - limit })}</p>
          )}
        </>
      )}
    </section>
  );
}

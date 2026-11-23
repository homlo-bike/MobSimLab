import { clock } from "../journey-planner/format";
import { type EngineNote, noteFinding, useEngineText } from "../../i18n/engine";
import { useI18n } from "../../i18n/i18n";
import { paramValue } from "../benefits/params";
import {
  explain,
  every,
  pct,
  perHour,
  practicalMaximum,
  ranText,
  secs,
  VERDICTS,
  verdictText,
} from "./capacityText";
import { pickStreetParams } from "./loadPlans";
import type { LineLoad } from "./loads";
import { STREET_RUN_DEFAULTS, type StreetLineResult, TRAFFIC_FACTOR } from "./streetRun";
import { LoadMetrics, StreetCard } from "./SystemResults";
import type { CapacityParams, CapacityRun as Run, LineInfo, Point } from "./types";

/** A rail line's result: its planned service and the other frequencies tried. */
export type LineState = { info: LineInfo; planned: Point; sweep: Point[]; sweeping: boolean };

/** Purpose: the rail test's verdict, one card per line, and the planner's and importer's notes. */
export function RunResults({
  run: shownRun,
  lines: shownLines,
  notes: shownNotes,
  loads,
}: {
  run: Run;
  lines: LineState[];
  notes: EngineNote[];
  loads: Record<string, LineLoad>;
}) {
  const { t } = useI18n();
  const tx = useEngineText();
  const limit = shownRun.params.occupancy_limit_share ?? 0.85;
  return (
    <div className="space-y-3" data-testid="capacity-result">
      <div className={`rounded-xl border px-3.5 py-3 ${VERDICTS[shownRun.verdict].tone}`}>
        <p className="text-base font-semibold">{verdictText(shownRun.verdict, t).title}</p>
        <p className="mt-0.5 text-sm">{verdictText(shownRun.verdict, t).text}</p>
        <p className="mt-1.5 text-xs opacity-80">
          {t("capacity.summary", {
            period: `${clock(shownRun.params.from_s)}–${clock(shownRun.params.to_s)}`,
            trips: shownRun.fleet.trips,
            out: shownRun.fleet.peak_out,
            reserve: shownRun.fleet.reserve,
          })}
        </p>
      </div>
      {shownLines.map((l) => (
        <LineCard key={l.info.id} line={l} limit={limit} load={loads[`rail:${l.info.id}`]} />
      ))}
      {shownNotes.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">{t("capacity.importNotes", { n: shownNotes.length })}</summary>
          <ul className="mt-1 list-disc pl-4">
            {shownNotes.map((n, i) => (
              <li key={i}>{tx(noteFinding(n))}</li>
            ))}
          </ul>
        </details>
      )}
      {shownRun.issues.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">
            {t("capacity.plannerNotes", { n: shownRun.issues.length })}
          </summary>
          <ul className="mt-1 list-disc pl-4 break-all">
            {shownRun.issues.slice(0, 20).map((n, i) => (
              <li key={i}>{tx({ text: n, msg: shownRun.issue_msgs?.[i] })}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-slate-500">
        {t("capacity.method", {
          runs: shownRun.params.stability_runs,
          share: pct(shownRun.params.delayed_share),
          late: secs(shownRun.params.primary_delay_max_s, t),
        })}
      </p>
    </div>
  );
}

/** Purpose: the street lines' results, and how the passenger loads were worked out. */
export function StreetResults({
  results: streetResults,
  loads,
  advanced,
  prefs,
}: {
  results: StreetLineResult[];
  loads: Record<string, LineLoad>;
  advanced: Partial<CapacityParams>;
  prefs?: Record<string, number>;
}) {
  const { t } = useI18n();
  return (
    <>
      {streetResults.length > 0 && (
        <div className="space-y-3" data-testid="street-result">
          <h3 className="caps">{t("capacity.street.title")}</h3>
          {streetResults.map((r) => (
            <StreetCard key={r.index} r={r} load={loads[`street:${r.index}`]} />
          ))}
          <p className="text-xs text-slate-500">
            {t("capacity.street.method", {
              runs: pickStreetParams(advanced).stability_runs ?? STREET_RUN_DEFAULTS.stability_runs,
              low: TRAFFIC_FACTOR[0].toFixed(1),
              high: TRAFFIC_FACTOR[2].toFixed(1),
            })}
          </p>
        </div>
      )}
      {Object.keys(loads).length > 0 && (
        <p className="text-xs text-slate-500">
          {t("capacity.loads.method", {
            peak: `${Math.round(paramValue("benefit.ridership.peak_hour_share", "*", prefs)[1] * 100)} %`,
            dir: `${Math.round(paramValue("benefit.ridership.peak_direction_share", "*", prefs)[1] * 100)} %`,
          })}
        </p>
      )}
    </>
  );
}

function LineCard({ line, limit, load }: { line: LineState; limit: number; load?: LineLoad }) {
  const { t, tn } = useI18n();
  const tx = useEngineText();
  const p = line.planned;
  const all = [p, ...line.sweep].sort((a, b) => b.headway_s - a.headway_s);
  const max = practicalMaximum(all);
  const v = { ...VERDICTS[p.verdict], ...verdictText(p.verdict, t) };
  // When planned trips were left out, the on-time share and the delays only describe the trips
  // that ran; with none run there is nothing to measure.
  const ran = ranText(p, t, tn);
  const noneRan = p.unplaced > 0 && p.trips === 0;
  const metric = (label: string, value: string, hint?: string, qualifier?: string | null) => (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
      {qualifier && <dd className="text-xs font-medium text-amber-800">{qualifier}</dd>}
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
  return (
    <article
      aria-label={t("capacity.line", { name: line.info.name })}
      className="rounded-xl border border-slate-200 bg-white p-3.5"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {line.info.name}{" "}
          <span className="text-sm font-normal text-slate-500">
            {every(p.headway_s, t)} · {t("capacity.eachWay", { n: perHour(p.per_hour) })}
          </span>
        </h3>
        <span className={`tag border ${v.tone}`}>{v.title}</span>
      </header>
      <p className="mt-1.5 text-sm text-slate-700">{explain(p, limit, t, tn, tx)}</p>
      <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
        {metric(
          t("capacity.used"),
          pct(Math.max(p.consumption, p.terminal_share)),
          t("capacity.usedHint", {
            line: pct(p.consumption),
            terminal: p.terminal || t("capacity.terminal"),
            share: pct(p.terminal_share),
          }),
        )}
        {metric(
          t("capacity.room"),
          t("capacity.roomValue", { n: perHour(p.theoretical_per_hour) }),
          t("capacity.roomHint", { n: perHour(p.limit_per_hour) }),
        )}
        {metric(
          t("capacity.onTime"),
          noneRan ? "–" : pct(p.punctuality),
          noneRan ? undefined : t("capacity.onTimeHint", { share: pct(p.disturbed_punctuality) }),
          ran,
        )}
        {metric(
          t("capacity.delays"),
          noneRan ? "–" : p.stable ? t("capacity.dieOut") : t("capacity.pileUp"),
          noneRan
            ? undefined
            : t("capacity.delaysHint", { passed: secs(p.knock_on_s, t), left: secs(p.residual_delay_s, t) }),
          ran,
        )}
      </dl>
      {(line.sweep.length > 0 || line.sweeping) && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            {max !== null
              ? t("capacity.worksUpTo", { n: perHour(max) })
              : line.sweeping
                ? t("capacity.tryingOthers")
                : t("capacity.noneWorks")}
          </p>
          <table className="mt-1.5 w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.service")}</th>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.used")}</th>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.delays")}</th>
                <th className="py-1 pr-2 font-medium">{t("capacity.col.result")}</th>
              </tr>
            </thead>
            <tbody>
              {all.map((x) => (
                <tr
                  key={x.headway_s}
                  className={`border-t border-slate-100 ${x === p ? "font-semibold" : ""}`}
                >
                  <td className="py-1 pr-2">
                    {t(x === p ? "capacity.ratePlanned" : "capacity.rate", { n: perHour(x.per_hour) })}
                  </td>
                  <td className="py-1 pr-2">
                    {x.unplaced > 0
                      ? tn("capacity.notFit", x.unplaced)
                      : pct(Math.max(x.consumption, x.terminal_share))}
                  </td>
                  <td className="py-1 pr-2">
                    {x.unplaced > 0 ? "–" : x.stable ? t("capacity.dieOutRow") : t("capacity.pileUpRow")}
                  </td>
                  <td className="py-1 pr-2">{verdictText(x.verdict, t).title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.problems.length > 0 && (
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">{t("capacity.kernelNotes", { n: p.problems.length })}</summary>
          <ul className="mt-1 list-disc pl-4">
            {p.problems.map((x, i) => (
              <li key={x}>{tx({ text: x, msg: p.problem_msgs?.[i] })}</li>
            ))}
          </ul>
        </details>
      )}
      {load && <LoadMetrics load={load} />}
    </article>
  );
}

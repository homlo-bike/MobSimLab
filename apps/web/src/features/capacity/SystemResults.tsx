import { useState } from "react";
import { clock } from "../journey-planner/format";
import { useI18n } from "../../i18n/i18n";
import type { LineLoad } from "./loads";
import type { Boardings } from "./ridership";
import type { StreetLineResult } from "./streetRun";

const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : "–");
const count = (x: number) => new Intl.NumberFormat().format(Math.round(x));
const mins = (s: number) => (s / 60).toFixed(s < 600 ? 1 : 0);

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  );
}

/** Purpose: a line's passenger load: the busiest point of the period and who is left behind. */
export function LoadMetrics({ load }: { load: LineLoad }) {
  const { t } = useI18n();
  const b = load.busiest;
  if (!b || load.daily <= 0) return <p className="mt-2 text-xs text-slate-600">{t("capacity.loads.none")}</p>;
  const tone = b.occupancy > 1 ? "text-red-800" : b.occupancy > 0.8 ? "text-amber-800" : "text-emerald-800";
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{t("capacity.loads.title")}</p>
      <p className="text-xs text-slate-600">
        {t("capacity.loads.busiest", {
          from: b.from,
          to: b.to,
          time: `${clock(b.hour_s)}–${clock(b.hour_s + 3600)}`,
        })}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-1.5">
        <Metric
          label={t("capacity.loads.full")}
          value={pct(b.occupancy)}
          hint={t("capacity.loads.fullHint", { riders: count(b.riders), places: count(b.places) })}
        />
        <Metric
          label={t("capacity.loads.left")}
          value={count(load.left_behind)}
          hint={t("capacity.loads.leftHint")}
        />
      </dl>
      <p className={`mt-1 text-xs ${tone}`}>
        {b.occupancy > 1 ? t("capacity.loads.over") : t("capacity.loads.fits")}
      </p>
      {load.missing.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {t("capacity.loads.missing", { stops: load.missing.join(", ") })}
        </p>
      )}
    </div>
  );
}

/** Purpose: one street line's run: on time or not, circuit, vehicles, bunching and its passengers. */
export function StreetCard({ r, load }: { r: StreetLineResult; load?: LineLoad }) {
  const { t } = useI18n();
  const tone = r.stable
    ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : "bg-orange-100 text-orange-900 border-orange-300";
  return (
    <article
      aria-label={t("capacity.line", { name: r.name })}
      className="rounded-xl border border-slate-200 bg-white p-3.5"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">
          {r.name}{" "}
          <span className="text-sm font-normal text-slate-500">
            {t("capacity.every", { n: mins(r.headway_s) })} ·{" "}
            {t("capacity.street.perHour", { n: r.per_hour })}
          </span>
        </h3>
        <span className={`tag border ${tone}`}>
          {r.stable ? t("capacity.street.keepsTime") : t("capacity.verdict.delays_pile_up.title")}
        </span>
      </header>
      <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
        <Metric
          label={t("capacity.onTime")}
          value={pct(r.punctuality)}
          hint={t("capacity.street.onTimeHint", { mean: mins(r.mean_delay_s), p95: mins(r.p95_delay_s) })}
        />
        <Metric
          label={t("capacity.street.cycle")}
          value={t("capacity.minutes", { n: mins(r.cycle_s) })}
          hint={t("capacity.street.cycleHint", {
            traffic: mins(r.traffic_delay_s),
            run: mins(r.run_cycle_s),
          })}
        />
        <Metric
          label={t("capacity.street.vehicles")}
          value={String(r.vehicles)}
          hint={t("capacity.every", { n: mins(r.headway_s) })}
        />
        <Metric
          label={t("capacity.street.bunching")}
          value={pct(r.bunched_share)}
          hint={t("capacity.street.bunchingHint", { left: mins(r.residual_delay_s) })}
        />
      </dl>
      {load && <LoadMetrics load={load} />}
    </article>
  );
}

/**
 * Purpose: the planner's own weekday boardings per station or stop, next to the Tables tab's estimate.
 * Inputs: the stop names, the estimate per name (all lines together), the planner's numbers and where to
 * save them (`null` when the project is read-only).
 */
export function BoardingsEditor({
  names,
  estimate,
  own,
  onOwn,
  onOpen,
}: {
  names: string[];
  estimate: Record<string, number> | null;
  own: Boardings;
  onOwn: ((b: Boardings) => void) | null;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!names.length) return null;
  const set = (name: string, text: string) => {
    setDraft((d) => ({ ...d, [name]: text }));
    if (!onOwn) return;
    const v = Number(text);
    const next = { ...own };
    if (text.trim() === "" || !Number.isFinite(v) || v < 0) delete next[name];
    else next[name] = Math.round(v);
    onOwn(next);
  };
  return (
    <details
      className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2"
      onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && onOpen?.()}
    >
      <summary className="cursor-pointer text-sm font-medium">{t("capacity.loads.editor")}</summary>
      <p className="mt-1 text-xs text-slate-500">{t("capacity.loads.editorHelp")}</p>
      <div className="mt-2 space-y-1.5">
        {names.map((n) => (
          <label key={n} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{n}</span>
              <span className="block text-xs text-slate-500">
                {estimate === null
                  ? t("capacity.loads.estimatePending")
                  : estimate[n] !== undefined
                    ? t("capacity.loads.estimate", { n: count(estimate[n]!) })
                    : t("capacity.loads.noEstimate")}
              </span>
            </span>
            <input
              type="number"
              min={0}
              step={100}
              aria-label={n}
              disabled={!onOwn}
              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right"
              value={draft[n] ?? (own[n] !== undefined ? String(own[n]) : "")}
              placeholder={estimate?.[n] !== undefined ? String(Math.round(estimate[n]!)) : ""}
              onChange={(e) => set(n, e.target.value)}
            />
          </label>
        ))}
      </div>
    </details>
  );
}

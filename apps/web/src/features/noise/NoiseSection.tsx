import { tNow, useI18n } from "../../i18n/i18n";
import { LEGEND } from "./mapLayer";
import type { Flows, Indicator, NoiseBand, NoiseView } from "./types";

/** Purpose: a distance for the panel, rounded to what the estimate supports. */
export function fmtDistance(m: number): string {
  const r = rounded(m);
  return r >= 1000 ? tNow("noise.km", { n: (r / 1000).toFixed(1) }) : tNow("noise.m", { n: r });
}

function rounded(m: number): number {
  if (m <= 0) return 0;
  return m < 20 ? Math.round(m) : Math.round(m / 5) * 5;
}

/** Purpose: "about 38 m (30–46 m)", or one figure when the range collapses. */
export function fmtBand(b: NoiseBand): string {
  const [lo, c, hi] = b.typical_m.map(fmtDistance) as [string, string, string];
  if (lo === hi) return c;
  // The low end drops its unit when it is in metres: "30–45 m".
  const low = rounded(b.typical_m[0]!);
  return tNow("noise.about", { c, lo: low < 1000 ? String(low) : lo, hi });
}

interface Props {
  on: boolean;
  setOn: (v: boolean) => void;
  indicator: Indicator;
  setIndicator: (v: Indicator) => void;
  flows: Flows;
  setFlows: (f: Flows) => void;
  /** "Buses per hour" or "Trains per hour, each track". */
  flowsLabel: string;
  /** Explains a day flow taken from elsewhere (the headway); the field is then read-only. */
  dayFrom?: string;
  /** Battery bus toggle for street modes. */
  electric?: { value: boolean; onChange: (v: boolean) => void; fixed?: boolean };
  view: NoiseView | null;
  error: string | null;
}

function FlowField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-slate-600">{label}</span>
      <input
        type="number"
        min={0}
        step={0.5}
        value={Math.round(value * 10) / 10}
        readOnly={readOnly}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className={`w-full rounded border border-slate-300 px-1 py-0.5 text-end ${readOnly ? "bg-slate-100 text-slate-500" : ""}`}
      />
    </label>
  );
}

/**
 * Purpose: the noise plugin's section in an editor side panel (ADR-0038 §1): the Noise toggle,
 * the indicator, flows per period, the band distances as stat tiles and the legend.
 * The checks go into the editor's own Checks list.
 */
export function NoiseSection(p: Props) {
  const { t } = useI18n();
  const v = p.view;
  const band = v ? (p.indicator === "lnight" ? v.lnight : v.lden) : null;
  return (
    <section className="flex flex-col gap-2 border-t border-slate-200 pt-3" aria-label={t("noise.title")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t("noise.title")}</h3>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={p.on} onChange={(e) => p.setOn(e.target.checked)} />
          {t("noise.showBand")}
        </label>
      </div>
      {p.on && (
        <>
          <div
            role="radiogroup"
            aria-label={t("noise.indicator")}
            className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
          >
            {(
              [
                ["lden", t("noise.lden")],
                ["lnight", "L_night"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={p.indicator === id}
                onClick={() => p.setIndicator(id)}
                className={`flex-1 rounded px-1 py-1 text-xs ${p.indicator === id ? "bg-white font-semibold shadow" : "text-slate-600"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">{p.flowsLabel}</span>
            <div className="grid grid-cols-3 gap-2">
              <FlowField
                label={t("noise.day")}
                value={p.flows.day}
                readOnly={!!p.dayFrom}
                onChange={(d) => p.setFlows({ ...p.flows, day: d })}
              />
              <FlowField
                label={t("noise.evening")}
                value={p.flows.evening}
                onChange={(e) => p.setFlows({ ...p.flows, evening: e })}
              />
              <FlowField
                label={t("noise.night")}
                value={p.flows.night}
                onChange={(n) => p.setFlows({ ...p.flows, night: n })}
              />
            </div>
            {p.dayFrom && <p className="text-xs text-slate-500">{p.dayFrom}</p>}
          </div>
          {p.electric && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={p.electric.value}
                disabled={p.electric.fixed}
                onChange={(e) => p.electric!.onChange(e.target.checked)}
              />
              {t("noise.electric")}
            </label>
          )}
          {v && (
            <div className="grid grid-cols-2 gap-2">
              {[v.lden, v.lnight].map((b, i) => (
                <div
                  key={i}
                  className={`rounded border px-2 py-1.5 ${b === band ? "border-slate-400 bg-white" : "border-slate-200 bg-slate-50"}`}
                >
                  <div className="text-base font-semibold">{fmtBand(b)}</div>
                  <div className="text-xs text-slate-600">
                    {t("noise.bandEachSide", {
                      db: Math.round(b.threshold_db),
                      indicator: i === 0 ? "L_den" : "L_night",
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {band && (
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
              aria-label={t("noise.legend")}
            >
              {LEGEND.filter((l) => l.from_db >= band.threshold_db).map((l) => (
                <span key={l.from_db} className="flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-slate-300"
                    style={{ background: l.color }}
                  />
                  {l.from_db}
                </span>
              ))}
              <span>dB</span>
            </div>
          )}
          <p className="text-xs text-slate-500">{t("noise.sectionNote")}</p>
          {p.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{p.error}</p>}
        </>
      )}
    </section>
  );
}

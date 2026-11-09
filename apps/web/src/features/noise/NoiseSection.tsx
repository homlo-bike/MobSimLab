import { LEGEND } from "./mapLayer";
import type { Flows, Indicator, NoiseBand, NoiseView } from "./types";

/** Purpose: a distance for the panel, rounded to what the estimate supports. */
export function fmtDistance(m: number): string {
  if (m <= 0) return "0 m";
  const r = m < 20 ? Math.round(m) : Math.round(m / 5) * 5;
  return r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`;
}

/** Purpose: "about 38 m (30–46 m)", or one figure when the range collapses. */
export function fmtBand(b: NoiseBand): string {
  const [lo, c, hi] = b.typical_m.map(fmtDistance) as [string, string, string];
  return lo === hi ? c : `about ${c} (${lo.replace(" m", "")}–${hi})`;
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
        className={`w-full rounded border border-slate-300 px-1 py-0.5 text-right ${readOnly ? "bg-slate-100 text-slate-500" : ""}`}
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
  const v = p.view;
  const band = v ? (p.indicator === "lnight" ? v.lnight : v.lden) : null;
  return (
    <section className="flex flex-col gap-2 border-t border-slate-200 pt-3" aria-label="Noise">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Noise</h3>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={p.on} onChange={(e) => p.setOn(e.target.checked)} />
          Show noise band
        </label>
      </div>
      {p.on && (
        <>
          <div
            role="radiogroup"
            aria-label="Noise indicator"
            className="flex rounded border border-slate-300 bg-slate-50 p-0.5"
          >
            {(
              [
                ["lden", "L_den (day–evening–night)"],
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
                label="Day 07–19"
                value={p.flows.day}
                readOnly={!!p.dayFrom}
                onChange={(d) => p.setFlows({ ...p.flows, day: d })}
              />
              <FlowField
                label="Evening 19–23"
                value={p.flows.evening}
                onChange={(e) => p.setFlows({ ...p.flows, evening: e })}
              />
              <FlowField
                label="Night 23–07"
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
              Electric vehicles (quieter when pulling away)
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
                    {Math.round(b.threshold_db)} dB {i === 0 ? "L_den" : "L_night"} band, each side
                  </div>
                </div>
              ))}
            </div>
          )}
          {band && (
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
              aria-label="Noise legend"
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
          <p className="text-xs text-slate-500">
            Estimate from planned service: free field, no buildings (no screening), so an upper bound. Service
            lines only, without general traffic. Values in Project Preferences → Noise.
          </p>
          {p.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{p.error}</p>}
        </>
      )}
    </section>
  );
}

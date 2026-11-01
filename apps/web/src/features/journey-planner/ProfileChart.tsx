import { useState } from "react";
import { clock, duration, PARTS } from "./format";
import type { ProfilePoint } from "./types";

interface Props {
  points: ProfilePoint[];
  /** The asked time, marked on the chart. */
  selected: number | null;
  onSelect: (time_s: number) => void;
}

const W = 340;
const HGT = 170;
const PAD = { l: 34, r: 6, t: 16, b: 22 };

/** Purpose: a round axis step in minutes for a maximum of `max` minutes. */
function niceStep(max: number): number {
  for (const s of [5, 10, 15, 20, 30, 60, 120]) if (max / s <= 5) return s;
  return 240;
}

/**
 * Purpose: total journey time through the day as stacked bars (walking, waiting, in vehicle, change,
 * early arrival), one bar per asked time. Hovering shows the parts; clicking a bar asks that time.
 */
export function ProfileChart({ points, selected, onSelect }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return null;
  const maxS = Math.max(60, ...points.map((p) => p.journey?.total_s ?? 0));
  const step = niceStep(maxS / 60);
  const top = Math.ceil(maxS / 60 / step) * step;
  const iw = W - PAD.l - PAD.r;
  const ih = HGT - PAD.t - PAD.b;
  const bw = iw / points.length;
  const y = (min: number) => PAD.t + ih - (min / top) * ih;
  const t0 = points[0]!.time_s;
  const t1 = points[points.length - 1]!.time_s;
  const hours: number[] = [];
  for (let h = Math.ceil(t0 / 3600); h * 3600 <= t1; h += 3) hours.push(h * 3600);
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (iw - bw) + bw / 2;
  const ticks = hours.filter((h) => x(h) > PAD.l + 10 && x(h) < W - 14);
  const hp = hover !== null ? points[hover] : null;
  const gap = bw > 4 ? 1 : 0;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${HGT}`}
        className="w-full"
        role="img"
        aria-label="Journey time through the day, stacked by walking, waiting, in vehicle and change time"
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((m) => (
          <g key={m}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(m)} y2={y(m)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(m) + 3} textAnchor="end" fontSize={9} fill="#64748b">
              {m}
            </text>
          </g>
        ))}
        <text x={PAD.l - 4} y={8} textAnchor="end" fontSize={9} fill="#64748b">
          min
        </text>
        {ticks.map((h) => (
          <text key={h} x={x(h)} y={HGT - 6} textAnchor="middle" fontSize={9} fill="#64748b">
            {clock(h)}
          </text>
        ))}
        {points.map((p, i) => {
          const bx = PAD.l + i * bw;
          if (!p.journey) {
            return (
              <rect
                key={p.time_s}
                x={bx + gap / 2}
                y={y(0) - 2}
                width={Math.max(1, bw - gap)}
                height={2}
                fill="#cbd5e1"
              >
                <title>{`${clock(p.time_s)}: no journey`}</title>
              </rect>
            );
          }
          let acc = 0;
          const segs = PARTS.map((part) => {
            const v = p.journey!.breakdown[part.key] / 60;
            const seg = { key: part.key, color: part.color, y0: acc, y1: acc + v };
            acc += v;
            return seg;
          }).filter((s) => s.y1 > s.y0);
          return (
            <g key={p.time_s} opacity={hover === null || hover === i ? 1 : 0.55}>
              {segs.map((s) => (
                <rect
                  key={s.key}
                  x={bx + gap / 2}
                  y={y(s.y1)}
                  width={Math.max(1, bw - gap)}
                  height={Math.max(0, y(s.y0) - y(s.y1) - (s.y0 > 0 && bw > 4 ? 0.5 : 0))}
                  fill={s.color}
                />
              ))}
            </g>
          );
        })}
        {selected !== null && selected >= t0 && selected <= t1 && (
          <line
            x1={x(selected)}
            x2={x(selected)}
            y1={PAD.t}
            y2={y(0)}
            stroke="#0f172a"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        )}
        {/* Hit targets wider than the bars. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.time_s}`}
            data-testid={`profile-bar-${p.time_s}`}
            x={PAD.l + i * bw}
            y={PAD.t}
            width={bw}
            height={ih}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(i)}
            onClick={() => onSelect(p.time_s)}
          />
        ))}
      </svg>
      {hp && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 rounded border border-slate-300 bg-white px-2 py-1 text-xs shadow"
          style={{ left: `${Math.min(60, (hover! / points.length) * 100)}%` }}
        >
          <div className="font-semibold">
            {clock(hp.time_s)} · {hp.journey ? duration(hp.journey.total_s) : "no journey"}
          </div>
          {hp.journey &&
            PARTS.filter((p) => hp.journey!.breakdown[p.key] > 0).map((p) => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
                <span className="text-slate-600">{p.label}</span>
                <span className="ml-auto pl-2 tabular-nums">{duration(hp.journey!.breakdown[p.key])}</span>
              </div>
            ))}
          {hp.journey && (
            <div className="text-slate-500">
              {hp.journey.transfers} change{hp.journey.transfers === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Purpose: legend of the time parts (identity is never colour alone: labels are always shown). */
export function PartsLegend({ arriveBy }: { arriveBy: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600" aria-label="Legend">
      {PARTS.filter((p) => arriveBy || p.key !== "early_arrival_s").map((p) => (
        <li key={p.key} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
          {p.label}
        </li>
      ))}
    </ul>
  );
}

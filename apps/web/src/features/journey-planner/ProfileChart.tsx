import { useState } from "react";
import { clock, duration, PARTS } from "./format";
import type { ProfilePoint } from "./types";

interface Props {
  points: ProfilePoint[];
  /** The asked time, marked with a dashed line. */
  selected: number | null;
  /** Peak windows `[from, to)` in seconds, shaded behind the line. */
  peaks: [number, number][];
  onSelect: (time_s: number) => void;
}

const W = 376;
const HGT = 112;
const PAD = { l: 26, r: 4, t: 6, b: 18 };

/** Purpose: a round axis step in minutes for a maximum of `max` minutes. */
function niceStep(max: number): number {
  for (const s of [5, 10, 15, 20, 30, 60, 120]) if (max / s <= 3) return s;
  return 240;
}

/**
 * Purpose: total journey time through the day as one line (design A), peak hours shaded. Hovering shows
 * the split of that journey; clicking plans that time. Times without a journey break the line.
 */
export function ProfileChart({ points, selected, peaks, onSelect }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return null;
  const maxS = Math.max(60, ...points.map((p) => p.journey?.total_s ?? 0));
  const step = niceStep(maxS / 60);
  const top = Math.ceil(maxS / 60 / step) * step;
  const iw = W - PAD.l - PAD.r;
  const ih = HGT - PAD.t - PAD.b;
  const t0 = points[0]!.time_s;
  const t1 = points[points.length - 1]!.time_s;
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (min: number) => PAD.t + ih - (min / top) * ih;
  // Paths with gaps where there is no journey: every asked time (faint) and the one-hour average (bold),
  // since waits make the raw line a sawtooth that hides the trend through the day.
  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(points[i]!.time_s).toFixed(1)} ${y(v / 60).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const raw = points.map((p) => p.journey?.total_s ?? null);
  const half = 1800;
  const avg = points.map((p) => {
    if (!p.journey) return null;
    const near = points.filter((q) => q.journey && Math.abs(q.time_s - p.time_s) <= half);
    return near.reduce((s, q) => s + q.journey!.total_s, 0) / near.length;
  });
  const ticks: number[] = [];
  for (let h = Math.ceil(t0 / 3600 / 3) * 3; h * 3600 <= t1; h += 3) ticks.push(h * 3600);
  const slot = iw / points.length;
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${HGT}`}
        className="w-full"
        role="img"
        aria-label="Journey time through the day: every asked time and the one-hour average; peak hours are shaded"
        onMouseLeave={() => setHover(null)}
      >
        {peaks.map(([a, b]) => {
          const xa = Math.max(PAD.l, x(a));
          const xb = Math.min(W - PAD.r, x(b));
          return xb > xa ? (
            <g key={a}>
              <rect x={xa} y={PAD.t} width={xb - xa} height={ih} fill="#f1f5f9" />
              <text x={xa + 3} y={PAD.t + 9} fontSize={8} fill="#64748b">
                peak
              </text>
            </g>
          ) : null;
        })}
        {[0, step, top]
          .filter((m, i, a) => a.indexOf(m) === i)
          .map((m) => (
            <g key={m}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(m)} y2={y(m)} stroke={m === 0 ? "#cbd5e1" : "#eef2f6"} />
              <text x={PAD.l - 4} y={y(m) + 3} textAnchor="end" fontSize={8} fill="#64748b">
                {m}
              </text>
            </g>
          ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={HGT - 5} textAnchor="middle" fontSize={8} fill="#64748b">
            {clock(t)}
          </text>
        ))}
        <path d={path(raw)} fill="none" stroke="#94a3b8" strokeWidth={1} strokeLinejoin="round" />
        <path d={path(avg)} fill="none" stroke="#0f172a" strokeWidth={2} strokeLinejoin="round" />
        {selected !== null && selected >= t0 && selected <= t1 && (
          <line
            x1={x(selected)}
            x2={x(selected)}
            y1={PAD.t}
            y2={y(0)}
            stroke="#1d4ed8"
            strokeDasharray="3 3"
          />
        )}
        {hp?.journey && (
          <circle
            cx={x(hp.time_s)}
            cy={y(hp.journey.total_s / 60)}
            r={3.5}
            fill="#0f172a"
            stroke="#fff"
            strokeWidth={1.5}
          />
        )}
        {points.map((p, i) => (
          <rect
            key={p.time_s}
            data-testid={`profile-bar-${p.time_s}`}
            x={x(p.time_s) - slot / 2}
            y={PAD.t}
            width={slot}
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
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow"
          style={{ left: `${Math.min(58, (hover! / points.length) * 100)}%` }}
        >
          <div className="font-semibold">
            {clock(hp.time_s)} · {hp.journey ? duration(hp.journey.total_s) : "no journey"}
          </div>
          {hp.journey &&
            PARTS.filter((p) => hp.journey!.breakdown[p.key] > 0).map((p) => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
                <span className="text-slate-600">{p.short}</span>
                <span className="ml-auto pl-2 tabular-nums">{duration(hp.journey!.breakdown[p.key])}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

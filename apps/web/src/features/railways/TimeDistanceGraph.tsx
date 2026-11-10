import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { Dialog } from "../../shell/Dialog";
import { hhmm } from "./serviceLines";
import { inWindow, type TdGraph, timeDistance, WINDOWS, type WindowKey, windowRange } from "./timeDistance";
import type { ServicePublication } from "./types";

const W = 880;
const PAD = { l: 132, r: 24, t: 12, b: 26 };
/** Height per km of line, clamped so short and long lines both read well. */
const plotHeight = (km: number) => Math.max(180, Math.min(420, 60 + km * 14));
const SHIFTED = "#b45309";

/** Purpose: a round time-axis step in minutes for a window of `min` minutes. */
function tickStep(min: number): number {
  for (const s of [10, 15, 30, 60, 120]) if (min / s <= 12) return s;
  return 180;
}

/** Purpose: "+2 min" or "−1.5 min" for a shift in seconds. */
function shiftText(s: number): string {
  const m = Math.round((s / 60) * 10) / 10;
  return `${m >= 0 ? "+" : "−"}${Math.abs(m)} min`;
}

/**
 * Purpose: the time-distance graph of a published rail line in a dialog: stations down the side by
 * distance along the track, time across, one sloping line per train. Other lines' trains on the same
 * stations are drawn thin and grey; departures the planner moved to keep clear of other trains are
 * drawn in amber, and the conflicts are listed below.
 */
export function TimeDistanceGraph({
  publication,
  lineId,
  lineName,
  onClose,
}: {
  publication: ServicePublication;
  lineId: string;
  lineName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const graph = useMemo(() => timeDistance(publication, lineId), [publication, lineId]);
  const [win, setWin] = useState<WindowKey>("morning");

  return (
    <Dialog title={t("rail.tdg.title", { line: lineName })} onClose={onClose} width="max-w-5xl">
      {graph ? (
        <>
          <p className="text-sm text-slate-600">
            {t("rail.tdg.intro", {
              from: graph.stations[0]!.name,
              to: graph.stations[graph.stations.length - 1]!.name,
            })}
          </p>
          <div className="seg mt-3 flex-wrap text-sm" role="tablist" aria-label={t("rail.tdg.window")}>
            {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={win === k} onClick={() => setWin(k)}>
                {t(`rail.tdg.${k}` as MessageKey)}
              </button>
            ))}
          </div>
          <Chart graph={graph} range={windowRange(graph, win)} lineName={lineName} />
          <Conflicts graph={graph} />
        </>
      ) : (
        <p className="text-sm text-slate-600">{t("rail.tdg.noData")}</p>
      )}
    </Dialog>
  );
}

function Chart({ graph, range, lineName }: { graph: TdGraph; range: [number, number]; lineName: string }) {
  const { t } = useI18n();
  const [from, to] = range;
  const total = graph.stations[graph.stations.length - 1]!.km;
  const ih = plotHeight(total);
  const H = PAD.t + ih + PAD.b;
  const iw = W - PAD.l - PAD.r;
  const x = (s: number) => PAD.l + ((s - from) / Math.max(1, to - from)) * iw;
  const y = (km: number) => PAD.t + (km / Math.max(total, 1e-6)) * ih;
  const step = tickStep((to - from) / 60) * 60;
  const ticks: number[] = [];
  for (let s = Math.ceil(from / step) * step; s <= to; s += step) ticks.push(s);
  const shown = graph.trains.filter((tr) => inWindow(tr, from, to));
  // Other lines first, so the line's own trains are drawn on top.
  shown.sort(
    (a, b) => Number(a.own) - Number(b.own) || Number(a.shifted_s !== 0) - Number(b.shifted_s !== 0),
  );
  const own = shown.filter((tr) => tr.own);
  const clip = `tdg-clip-${graph.stations[0]!.station_id.replace(/[^\w-]/g, "")}`;
  const ownColor = own[0]?.color ?? "#1d4ed8";

  return (
    <figure className="mt-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[640px]"
          role="img"
          aria-label={t("rail.tdg.chart", { line: lineName })}
          // A time axis: it runs left to right in every language.
          direction="ltr"
          data-testid="tdg-chart"
        >
          <defs>
            <clipPath id={clip}>
              <rect x={PAD.l} y={PAD.t - 4} width={iw} height={ih + 8} />
            </clipPath>
          </defs>
          {ticks.map((s) => (
            <g key={s}>
              <line x1={x(s)} x2={x(s)} y1={PAD.t} y2={PAD.t + ih} stroke="#eef2f6" />
              <text x={x(s)} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">
                {hhmm(s / 60)}
              </text>
            </g>
          ))}
          {graph.stations.map((st) => (
            <g key={st.station_id}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(st.km)} y2={y(st.km)} stroke="#cbd5e1" />
              <text x={PAD.l - 6} y={y(st.km) + 4} textAnchor="end" fontSize={11} fill="#334155">
                {st.name.length > 18 ? `${st.name.slice(0, 17)}…` : st.name}
                <title>{`${st.name} · ${st.km.toFixed(1)} km`}</title>
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clip})`}>
            {shown.map((tr) =>
              tr.segments.map((seg, i) => (
                <polyline
                  key={`${tr.trip}-${i}`}
                  data-testid={tr.own ? `tdg-trip-${tr.trip}` : undefined}
                  points={seg.map(([s, km]) => `${x(s).toFixed(1)},${y(km).toFixed(1)}`).join(" ")}
                  fill="none"
                  stroke={tr.own ? (tr.shifted_s ? SHIFTED : tr.color) : "#94a3b8"}
                  strokeWidth={tr.own ? (tr.shifted_s ? 2.4 : 1.6) : 1}
                  strokeDasharray={tr.own && tr.direction === 1 ? "6 3" : undefined}
                  strokeLinejoin="round"
                >
                  <title>
                    {tr.shifted_s
                      ? `${tr.trip} · ${t("rail.tdg.shifted")} ${shiftText(tr.shifted_s)}`
                      : tr.trip}
                  </title>
                </polyline>
              )),
            )}
          </g>
        </svg>
      </div>
      {own.length === 0 && <p className="mt-1 text-sm text-slate-500">{t("rail.tdg.noTrips")}</p>}
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <Key color={ownColor} label={t("rail.tdg.towards", { to: graph.stations.at(-1)!.name })} />
        <Key color={ownColor} dashed label={t("rail.tdg.towards", { to: graph.stations[0]!.name })} />
        <Key color={SHIFTED} label={t("rail.tdg.shifted")} />
        <Key color="#94a3b8" label={t("rail.tdg.otherLines")} />
      </figcaption>
    </figure>
  );
}

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="22" height="8" aria-hidden="true">
        <line
          x1="1"
          x2="21"
          y1="4"
          y2="4"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? "5 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

function Conflicts({ graph }: { graph: TdGraph }) {
  const { t } = useI18n();
  const n = graph.shifted.length + graph.unplaced.length;
  return (
    <section className="mt-4" aria-label={t("rail.tdg.conflicts")}>
      <h3 className="text-sm font-semibold">
        {t("rail.tdg.conflicts")} · {n}
      </h3>
      {n === 0 ? (
        <p className="mt-1 text-sm text-slate-600">{t("rail.tdg.noConflicts")}</p>
      ) : (
        <ul
          className="mt-1 flex max-h-56 flex-col gap-0.5 overflow-y-auto text-sm"
          data-testid="tdg-conflicts"
        >
          {graph.unplaced.map((u) => (
            <li key={u.trip} className="text-red-800">
              {u.blocked_by
                ? t("rail.tdg.unplacedBy", { trip: u.trip, reason: u.reason, other: u.blocked_by })
                : t("rail.tdg.unplaced", { trip: u.trip, reason: u.reason })}
            </li>
          ))}
          {graph.shifted.map((s) => (
            <li key={s.trip} className="text-amber-900">
              {t("rail.tdg.shiftedRow", {
                trip: s.trip,
                time: s.depart_s === null ? "—" : hhmm(s.depart_s / 60),
                by: shiftText(s.by_s),
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

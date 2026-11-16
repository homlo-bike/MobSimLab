import type { ReactNode } from "react";
import { useTip } from "../costs/charts";
import type { CashYear, Present } from "./model";

/**
 * Charts of the appraisal (ADR-0045). Colours are the data-viz reference palette's categorical slots in fixed
 * order; every chart has a legend with values or a table beside it, so no number depends on colour alone.
 */
export const SLOT: [string, string, string, string, string, string] = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
];
/** Benefits above the axis and costs below it, in the cash flow chart. */
const BENEFIT = SLOT[0];
const COST = SLOT[1];

function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-slate-700">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: i.color }}
            aria-hidden="true"
          />
          {i.label}
          {i.value && <span className="tabular-nums text-slate-500">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A focusable chart mark that shows a tooltip on hover or focus. */
function Mark({
  label,
  body,
  show,
  hide,
  className,
  style,
}: {
  label: string;
  body: ReactNode;
  show: (e: { currentTarget: Element; clientX?: number; clientY?: number }, body: ReactNode) => void;
  hide: () => void;
  className: string;
  style: React.CSSProperties;
}) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={label}
      className={`${className} focus:outline-2 focus:outline-offset-1 focus:outline-slate-900`}
      style={style}
      onMouseMove={(e) => show(e, body)}
      onFocus={(e) => show(e, body)}
      onBlur={hide}
    />
  );
}

/**
 * Purpose: the present value of the benefits and of the costs as two stacked bars on one scale, split into
 * their items, so the size of each and what makes it up show at a glance.
 */
export function BenefitCostChart({ p, money }: { p: Present; money: (v: number) => string }) {
  const { show, hide, bubble } = useTip();
  const benefits = [
    { label: "Users' benefit", v: p.user, color: SLOT[0] },
    { label: "Fare revenue", v: p.fares, color: SLOT[1] },
    { label: "Car-km saved", v: p.external, color: SLOT[2] },
    { label: "GDP growth", v: p.gdp, color: SLOT[3] },
  ];
  const costs = [
    { label: "Construction and renewals", v: p.capital, color: SLOT[4] },
    { label: "Operating cost", v: p.operating, color: SLOT[5] },
  ];
  const max = Math.max(p.benefits, p.costs, 1);
  const bar = (name: string, total: number, parts: typeof benefits) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{name}</span>
        <span className="tabular-nums text-slate-700">{money(total)}</span>
      </div>
      <div className="flex h-6 gap-[2px]" style={{ width: `${(Math.max(0, total) / max) * 100}%` }}>
        {parts
          .filter((x) => x.v > 0)
          .map((x) => {
            const share = Math.round((x.v / total) * 100);
            return (
              <Mark
                key={x.label}
                label={`${name}, ${x.label}: ${money(x.v)}, ${share} %`}
                body={
                  <>
                    <b className="font-semibold">{x.label}</b>
                    <br />
                    {money(x.v)} ({share} % of {name.toLowerCase()})
                  </>
                }
                show={show}
                hide={hide}
                className="h-full min-w-[3px] first:rounded-l last:rounded-r"
                style={{ flexGrow: x.v, flexBasis: 0, background: x.color }}
              />
            );
          })}
      </div>
    </div>
  );
  return (
    <figure className="m-0" aria-label="Present value of the benefits and the costs">
      <Legend
        items={[...benefits, ...costs].filter((x) => x.v > 0).map((x) => ({ ...x, value: money(x.v) }))}
      />
      <div data-chart className="relative mt-3 flex flex-col gap-3" onMouseLeave={hide}>
        {bar("Benefits", p.benefits, benefits)}
        {bar("Costs", p.costs, costs)}
        {bubble}
      </div>
    </figure>
  );
}

/**
 * Purpose: the cash flow year by year, benefits above the axis and costs below, then the discounted net value
 * added up year by year with the year it turns positive marked.
 */
export function CashFlowChart({
  years,
  rate,
  cf,
  money,
}: {
  years: CashYear[];
  rate: number;
  cf: number;
  money: (v: number) => string;
}) {
  const { show, hide, bubble } = useTip();
  const rows = years.map((y) => {
    const benefits = y.user + y.fares + y.external + y.gdp;
    const costs = cf * (y.construction + y.renewals + y.operating - y.residual);
    return { y, benefits, costs };
  });
  let run = 0;
  const cum = rows.map((r, t) => (run += (r.benefits - r.costs) / (1 + rate) ** t));
  const breakEven = cum.findIndex((v, i) => v >= 0 && i > 0 && cum[i - 1]! < 0);
  const up = Math.max(1, ...rows.map((r) => r.benefits));
  const down = Math.max(1, ...rows.map((r) => Math.max(0, r.costs)));
  const H = 180;
  const zero = (up / (up + down)) * H;
  const cmin = Math.min(0, ...cum);
  const cmax = Math.max(0, ...cum);
  const cy = (v: number) => 90 - ((v - cmin) / (cmax - cmin || 1)) * 90;
  const n = rows.length;
  const w = 100 / n;
  const path = cum.map((v, i) => `${i ? "L" : "M"}${(i + 0.5) * w},${cy(v)}`).join(" ");
  return (
    <figure className="m-0" aria-label="Cash flow by year and the discounted net value over time">
      <Legend
        items={[
          { label: "Benefits", color: BENEFIT },
          { label: "Costs (after the conversion factor)", color: COST },
        ]}
      />
      <div data-chart className="relative mt-3" onMouseLeave={hide}>
        <div className="relative" style={{ height: H }}>
          <span className="absolute inset-x-0 h-px bg-slate-400" style={{ top: zero }} aria-hidden="true" />
          {rows.map((r, i) => {
            const body = (
              <>
                <b className="font-semibold">
                  Year {r.y.year} {r.y.op ? `(operation year ${r.y.op})` : "(building)"}
                </b>
                <br />
                Benefits {money(r.benefits)} · costs {money(r.costs)}
                <br />
                Net {money(r.benefits - r.costs)}
              </>
            );
            const label = `Year ${r.y.year}: benefits ${money(r.benefits)}, costs ${money(r.costs)}`;
            const bh = (r.benefits / up) * zero;
            const ch = (Math.max(0, r.costs) / down) * (H - zero);
            return (
              <div
                key={r.y.year}
                className="absolute top-0 h-full"
                style={{ left: `${i * w}%`, width: `${w}%` }}
              >
                {bh > 0 && (
                  <Mark
                    label={label}
                    body={body}
                    show={show}
                    hide={hide}
                    className="absolute inset-x-[15%] rounded-t-[3px]"
                    style={{ top: zero - bh, height: bh, background: BENEFIT }}
                  />
                )}
                {ch > 0 && (
                  <Mark
                    label={label}
                    body={body}
                    show={show}
                    hide={hide}
                    className="absolute inset-x-[15%] rounded-b-[3px]"
                    style={{ top: zero + 1, height: ch, background: COST }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="caps mt-4 mb-1 text-slate-600">Discounted net value, added up</p>
        <div className="relative h-[90px]">
          <svg
            viewBox="0 0 100 90"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <line
              x1="0"
              x2="100"
              y1={cy(0)}
              y2={cy(0)}
              stroke="#94a3b8"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <path d={path} fill="none" stroke="#0f172a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          {cum.map((v, i) => (
            <Mark
              key={i}
              label={`Year ${i + 1}: discounted net value so far ${money(v)}`}
              body={
                <>
                  <b className="font-semibold">Year {i + 1}</b>
                  <br />
                  Discounted net value so far {money(v)}
                </>
              }
              show={show}
              hide={hide}
              className="absolute top-0 h-full opacity-0"
              style={{ left: `${i * w}%`, width: `${w}%` }}
            />
          ))}
          {breakEven > 0 && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 rounded bg-white px-1 text-xs font-medium whitespace-nowrap text-slate-900 shadow"
              style={{ left: `${Math.min(90, (breakEven + 0.5) * w)}%`, top: Math.min(70, cy(0) + 6) }}
            >
              Pays back in year {breakEven + 1}
            </span>
          )}
        </div>
        <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500">
          <span>Year 1 · lowest {money(cmin)}</span>
          <span>
            Year {n} · {money(cum[cum.length - 1] ?? 0)}
          </span>
        </div>
        {bubble}
      </div>
    </figure>
  );
}

/**
 * Purpose: how the ENPV spreads over the Monte Carlo draws: a histogram with 0 and the 10th, 50th and 90th
 * percentiles marked.
 */
export function DrawsChart({
  draws,
  p,
  money,
}: {
  draws: number[];
  p: [number, number, number];
  money: (v: number) => string;
}) {
  const { show, hide, bubble } = useTip();
  const xs = draws.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const lo = Math.min(...xs, 0);
  const hi = Math.max(...xs, 0);
  const span = hi - lo || 1;
  const bins = 24;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of xs) counts[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))]!++;
  const top = Math.max(...counts, 1);
  const x = (v: number) => ((v - lo) / span) * 100;
  const marks: [string, number][] = [
    ["Low (P10)", p[0]],
    ["Medium (P50)", p[1]],
    ["High (P90)", p[2]],
  ];
  return (
    <figure className="m-0" aria-label="Spread of the economic net present value over the draws">
      <div data-chart className="relative mt-2" onMouseLeave={hide}>
        <div className="relative h-28">
          {counts.map((c, i) => {
            const a = lo + (i / bins) * span;
            const b = lo + ((i + 1) / bins) * span;
            const below = b <= 0;
            return (
              <Mark
                key={i}
                label={`${money(a)} to ${money(b)}: ${c} draws`}
                body={
                  <>
                    {money(a)} – {money(b)}
                    <br />
                    {c} of {xs.length} draws
                  </>
                }
                show={show}
                hide={hide}
                className="absolute bottom-0 rounded-t-[3px]"
                style={{
                  left: `calc(${(i / bins) * 100}% + 1px)`,
                  width: `calc(${100 / bins}% - 2px)`,
                  height: `${(c / top) * 100}%`,
                  background: below ? COST : BENEFIT,
                }}
              />
            );
          })}
          <span
            className="absolute -top-1 bottom-0 w-[2px] bg-slate-900"
            style={{ left: `calc(${x(0)}% - 1px)` }}
            aria-hidden="true"
          />
          <span
            className="absolute -top-1 ml-1 text-xs font-medium text-slate-900"
            style={{ left: `${x(0)}%` }}
            aria-hidden="true"
          >
            0
          </span>
        </div>
        <div className="relative mt-1 h-10 text-xs text-slate-600">
          {marks.map(([label, v], i) => (
            <span
              key={label}
              className="absolute -translate-x-1/2 text-center whitespace-nowrap tabular-nums"
              style={{ left: `${Math.min(92, Math.max(8, x(v)))}%`, top: i === 1 ? 0 : 18 }}
            >
              ▲ {label} {money(v)}
            </span>
          ))}
        </div>
        {bubble}
      </div>
      <Legend
        items={[
          { label: "ENPV above 0", color: BENEFIT },
          { label: "ENPV 0 or below", color: COST },
        ]}
      />
    </figure>
  );
}

/** Purpose: the lines ranked by their multi-criteria score, as bars from 0 to 100. */
export function RankingChart({
  lines,
}: {
  lines: { id: string; name: string; color: string; total: number; rank: number }[];
}) {
  const sorted = [...lines].sort((a, b) => a.rank - b.rank);
  return (
    <figure className="m-0" aria-label="Lines ranked by their multi-criteria score">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {sorted.map((l) => (
          <li key={l.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <span className="w-5 text-slate-500 tabular-nums">{l.rank}.</span>
                <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: l.color }} />
                {l.name}
              </span>
              <span className="font-semibold tabular-nums">{l.total.toFixed(1)}</span>
            </div>
            <div className="h-3 rounded bg-slate-100">
              <div
                className="h-full rounded"
                style={{ width: `${Math.max(0, Math.min(100, l.total))}%`, background: SLOT[0] }}
              />
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

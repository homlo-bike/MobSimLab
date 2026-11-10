import { type ReactNode, useState } from "react";
import type { Category, Estimate } from "./model";
import { isConstruction, sum } from "./model";
import type { Triple } from "./params";

/**
 * Charts of the cost tables (ADR-0039). Colours are the data-viz reference palette's first five categorical
 * slots, in fixed order, validated for colour vision deficiency on the light surface; three of them are below
 * 3:1 contrast, so every chart has a legend with values and the tables below give every number as text.
 */
export const GROUPS: { id: string; label: string; cats: Category[]; color: string }[] = [
  {
    id: "alignment",
    label: "Track and structures",
    cats: ["at_grade", "elevated", "viaduct", "bridge", "ramp", "cut_and_cover", "tbm"],
    color: "#2a78d6",
  },
  {
    id: "systems",
    label: "Systems and street works",
    cats: ["systems", "switches", "street_works"],
    color: "#eb6834",
  },
  { id: "stations", label: "Stations and stops", cats: ["stations"], color: "#1baf7a" },
  { id: "fleet", label: "Vehicles and depots", cats: ["vehicles", "depots"], color: "#eda100" },
  { id: "soft", label: "Design and contingency", cats: ["engineering", "contingency"], color: "#e87ba4" },
];

/** Sequential single hue for one-series bars. */
const BAR = "#2a78d6";

interface Tip {
  x: number;
  y: number;
  body: ReactNode;
}

/** Purpose: a hover tooltip anchored in a relatively positioned chart; returns the handlers and the bubble. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: { currentTarget: Element; clientX?: number; clientY?: number }, body: ReactNode) => {
    const box = (e.currentTarget.closest("[data-chart]") as HTMLElement | null)?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientX ?? r.left + r.width / 2) - (box?.left ?? 0);
    // Keep the bubble (up to 16rem wide, centred on x) inside the chart.
    const half = Math.min(128, (box?.width ?? 256) / 2);
    const x = Math.max(half, Math.min((box?.width ?? raw) - half, raw));
    const y = (e.clientY ?? r.top) - (box?.top ?? 0);
    setTip({ x, y, body });
  };
  const bubble = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.body}
    </div>
  );
  return { show, hide: () => setTip(null), bubble };
}

/**
 * Purpose: construction cost of each mode and the total as stacked bars on one shared axis, split into the
 * five cost groups, so both the size and the make-up of each mode show at a glance.
 */
export function CompositionChart({
  est,
  money,
  labelOf,
}: {
  est: Estimate;
  money: (v: number) => string;
  labelOf: (mode: string) => string;
}) {
  const { show, hide, bubble } = useTip();
  const rowOf = (mode: string | null) =>
    GROUPS.map((g) =>
      sum(
        est.items
          .filter((x) => (mode === null || x.mode === mode) && g.cats.includes(x.category))
          .map((x) => x.amount),
      ),
    );
  const rows = [
    ...est.modes.map((m) => ({ id: m, label: labelOf(m), parts: rowOf(m) })),
    ...(est.modes.length > 1 ? [{ id: "*", label: "Total", parts: rowOf(null) }] : []),
  ];
  const totals = rows.map((r) => r.parts.reduce((s, p) => s + p[1], 0));
  const max = Math.max(...totals, 1);
  const present = GROUPS.filter((_, i) => rows.some((r) => r.parts[i]![1] > 0));
  return (
    <figure className="m-0" aria-label="Construction cost by mode and cost group">
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-slate-700">
        {present.map((g) => (
          <li key={g.id} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: g.color }}
              aria-hidden="true"
            />
            {g.label}
          </li>
        ))}
      </ul>
      <div data-chart className="relative mt-3 flex flex-col gap-3" onMouseLeave={hide}>
        {rows.map((r, ri) => (
          <div key={r.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={r.id === "*" ? "font-semibold" : ""}>{r.label}</span>
              <span className="tabular-nums text-slate-700">{money(totals[ri]!)}</span>
            </div>
            <div className="flex h-4 gap-[2px]" style={{ width: `${(totals[ri]! / max) * 100}%` }}>
              {GROUPS.map((g, gi) => {
                const v = r.parts[gi]!;
                if (!(v[1] > 0)) return null;
                const pct = Math.round((v[1] / totals[ri]!) * 100);
                const body = (
                  <>
                    <b className="font-semibold">{r.label}</b> · {g.label}
                    <br />
                    {money(v[1])} ({pct} %), {money(v[0])} – {money(v[2])}
                  </>
                );
                return (
                  <span
                    key={g.id}
                    tabIndex={0}
                    role="img"
                    aria-label={`${r.label}, ${g.label}: ${money(v[1])}, ${pct} %`}
                    className="h-full min-w-[3px] first:rounded-l last:rounded-r focus:outline-2 focus:outline-offset-1 focus:outline-slate-900"
                    style={{ flexGrow: v[1], flexBasis: 0, background: g.color }}
                    onMouseMove={(e) => show(e, body)}
                    onFocus={(e) => show(e, body)}
                    onBlur={hide}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {bubble}
      </div>
    </figure>
  );
}

/** One bar of a bar list. */
export interface BarRow {
  id: string;
  label: string;
  value: Triple;
}

/**
 * Purpose: a sorted horizontal bar list of one series: the bar is the medium estimate, the thin line across
 * it runs from low to high.
 */
export function BarList({
  rows,
  money,
  label,
}: {
  rows: BarRow[];
  money: (v: number) => string;
  label: string;
}) {
  const { show, hide, bubble } = useTip();
  const sorted = rows.filter((r) => r.value[2] > 0).sort((a, b) => b.value[1] - a.value[1]);
  const max = Math.max(...sorted.map((r) => r.value[2]), 1);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure className="m-0" aria-label={label}>
      <div data-chart className="relative flex flex-col gap-2" onMouseLeave={hide}>
        {sorted.map((r) => {
          const body = (
            <>
              <b className="font-semibold">{r.label}</b>
              <br />
              medium {money(r.value[1])}
              <br />
              low {money(r.value[0])}, high {money(r.value[2])}
            </>
          );
          return (
            <div
              key={r.id}
              tabIndex={0}
              aria-label={`${r.label}: ${money(r.value[1])}, from ${money(r.value[0])} to ${money(r.value[2])}`}
              className="grid grid-cols-[1fr_auto] gap-y-1 sm:grid-cols-[minmax(8rem,15rem)_1fr_auto] items-center gap-2 rounded text-sm focus:outline-2 focus:outline-slate-900"
              onMouseMove={(e) => show(e, body)}
              onFocus={(e) => show(e, body)}
              onBlur={hide}
            >
              <span className="truncate text-slate-700" title={r.label}>
                {r.label}
              </span>
              <span className="relative order-last col-span-2 h-3 sm:order-none sm:col-span-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-r"
                  style={{ width: pct(r.value[1]), background: BAR }}
                />
                <span
                  className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-slate-500"
                  style={{ left: pct(r.value[0]), width: `calc(${pct(r.value[2] - r.value[0])})` }}
                  aria-hidden="true"
                />
              </span>
              <span className="w-16 text-right tabular-nums text-slate-700">{money(r.value[1])}</span>
            </div>
          );
        })}
        {bubble}
      </div>
      <figcaption className="mt-2 text-xs text-slate-500">
        Bar: medium estimate. Line: from low to high.
      </figcaption>
    </figure>
  );
}

/** Purpose: a thin bar under a table value, its length a share of the column's largest value. */
export function InlineBar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="mt-1 ml-auto block h-1.5 w-24 rounded-full bg-slate-100" aria-hidden="true">
      <span className="block h-full rounded-full" style={{ width: `${w * 100}%`, background: BAR }} />
    </span>
  );
}

/** Purpose: the construction and the operating total of the items a filter keeps. */
export function totalsOf(est: Estimate, keep: (c: Category, mode: string) => boolean) {
  const xs = est.items.filter((x) => keep(x.category, x.mode));
  return {
    construction: sum(xs.filter((x) => isConstruction(x.category)).map((x) => x.amount)),
    operating: sum(xs.filter((x) => !isConstruction(x.category)).map((x) => x.amount)),
  };
}

import { useMemo } from "react";
import type { Estimate as BenefitEstimate } from "../benefits/model";
import type { Triple } from "../benefits/params";
import { useTip } from "../costs/charts";
import { card, modeLabel, num, td, th, Tile } from "../costs/CostTables";
import { BenefitCostChart, CashFlowChart, DrawsChart, RankingChart } from "./charts";
import type { Estimate as CostEstimate } from "../costs/model";
import type { DemandRidership } from "../demand/ridership";
import type { FareInput } from "../fares/model";
import { type PreferencesDoc, withPref } from "../../workspace/preferences";
import { appraisalLines, mcaLines } from "./inputs";
import { TablePart } from "../tables/sections";
import {
  type Appraisal,
  type AppraisalDoc,
  type AppraisalRow,
  appraisalSettingGroups,
  appraise,
  libraryValue,
  mca,
  newId,
  type OwnCriterion,
  PARAMS,
  paramValue,
  POLICY,
  type Present,
  socialRateKey,
} from "./model";

interface Props {
  /**
   * From the cost tables: the estimate, its currency, the World Bank income group of the country (HIC, UMC,
   * LMC, LIC, or null) and units per int. $.
   */
  costs: { estimate: CostEstimate; currency: string | null; income: string | null; perIntl: number } | null;
  /** The benefit tables' estimate (ridership, GDP growth, access). */
  benefits: BenefitEstimate | null;
  /** The fare revenue table's input (null until it has priced the lines). */
  fares: FareInput | null;
  /** The demand run picked for ridership, with its users' benefit and car-km saved. */
  demand: DemandRidership | null;
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
  doc: AppraisalDoc | null;
  onDoc?: (doc: AppraisalDoc) => void;
  draws?: number;
}

const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(1)} %`);
const ratio = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : v.toFixed(2));
/** Purpose: money in short form with three significant digits and a true minus sign. */
export function fmtMoney(v: number, currency: string | null): string {
  const opts: Intl.NumberFormatOptions = { notation: "compact", maximumSignificantDigits: 3 };
  const s = currency
    ? new Intl.NumberFormat("en", { ...opts, style: "currency", currency }).format(v)
    : `${new Intl.NumberFormat("en", opts).format(v)} LCU`;
  return s.replace(/^-/, "−");
}
const sig = (v: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(v);

/** Colours of the tornado chart: the value at its low and at its high (categorical slots 1 and 2). */
const LOW = "#2a78d6";
const HIGH = "#eb6834";

/** Years the cash flow table shows: the construction years, the first five of operation, then every fifth. */
function shownYears(a: Appraisal): number[] {
  return a.years
    .filter((y) => y.op === 0 || y.op <= 5 || y.op % 5 === 0 || y.year === a.years.length)
    .map((y) => y.year);
}

/**
 * The appraisal of the Tables tab (ADR-0045): ENPV, ERR, BCR, FNPV and FIRR per line, per mode and in total,
 * from the cost tables, the fare revenue table, the demand run and the benefit tables; a cash flow by year; a
 * tornado chart, switching values and standard tests; a weighted-sum multi-criteria analysis of the lines;
 * and every appraisal value, editable. Side effects: none beyond `onPreferences` and `onDoc`.
 */
export function AppraisalSection({
  costs,
  benefits,
  fares,
  demand,
  preferences,
  onPreferences,
  doc,
  onDoc,
  draws,
}: Props) {
  const prefs = preferences?.values;
  const faresOwn = fares?.own;
  const lines = useMemo(
    () => appraisalLines(costs?.estimate ?? null, benefits, demand, prefs, faresOwn),
    [costs?.estimate, benefits, demand, prefs, faresOwn],
  );
  const perIntl = costs?.perIntl ?? 1;
  const income = costs?.income ?? null;
  const result = useMemo(
    () => (costs && lines.length ? appraise({ lines, fares, prefs, perIntl, income }, draws) : null),
    [costs, lines, fares, prefs, perIntl, income, draws],
  );
  const mcaResult = useMemo(() => {
    if (!result) return null;
    const enpv = new Map(result.rows.filter((r) => r.scope === "line").map((r) => [r.id, r.central.enpv]));
    return mca(mcaLines(lines, enpv, benefits), doc, prefs);
  }, [result, lines, benefits, doc, prefs]);

  const currency = costs?.currency ?? null;
  const money = (v: number) => fmtMoney(v, currency);
  const editable = !!onPreferences;
  const setValue = (id: string, v: number | null) => onPreferences?.(withPref(preferences, id, v));
  const total = result?.rows.find((r) => r.id === "total") ?? null;
  const currencyNote =
    demand?.appraisal && currency && demand.appraisal.currency !== currency
      ? `The demand run valued time in ${demand.appraisal.currency}, the tables show ${currency}: run the demand model again after changing the currency.`
      : null;

  return (
    <section aria-labelledby="appraisal-title" className="mt-10">
      <h2 id="appraisal-title" className="text-xl font-semibold tracking-tight">
        Appraisal
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        Is the project worth it? Every cost and benefit from the tables above, year by year, discounted to
        today. Ranges are the 10th to 90th percentile of {result?.draws ?? draws ?? 200} random draws.
      </p>
      {!costs && (
        <p role="status" className="mt-4 text-sm text-slate-500">
          Waiting for the cost tables to price the project…
        </p>
      )}
      {costs && !lines.length && (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          No lines with costs or ridership yet.
        </p>
      )}
      {result && total && (
        <>
          <TablePart id="appraisal.results">
            {[...result.notes, ...(currencyNote ? [currencyNote] : [])].map((n) => (
              <p key={n} className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {n}
              </p>
            ))}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                title="Economic net present value"
                value={money(total.enpv[1])}
                sub={`${money(total.enpv[0])} – ${money(total.enpv[2])}; above 0 in ${Math.round(total.positive * 100)} % of draws`}
              />
              <Tile
                title="Benefit-cost ratio"
                value={ratio(total.bcr[1])}
                sub={`${ratio(total.bcr[0])} – ${ratio(total.bcr[2])}`}
              />
              <Tile
                title="Economic rate of return"
                value={total.errShare >= 0.5 ? pct(total.err[1]) : "–"}
                sub={
                  total.errShare >= 0.5
                    ? `${pct(total.err[0])} – ${pct(total.err[2])}`
                    : "no rate brings the ENPV to 0 in most draws"
                }
              />
              <Tile
                title="Financial net present value"
                value={money(total.fnpv[1])}
                sub={`FIRR ${total.firrShare >= 0.5 ? pct(total.firr[1]) : "–"}; fares less the operator's costs`}
              />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              These four are the middle of the {result.draws} draws (the 50th percentile), with the 10th to
              90th percentile below each. The tables below use the medium case, every input at its medium
              value: ENPV {money(total.central.enpv)}, benefit-cost ratio {ratio(total.central.bcr)}, FNPV{" "}
              {money(total.central.fnpv)}.
            </p>
            <Breakdown p={total.central} row={total} money={money} />
            <Rows rows={result.rows} money={money} />
            <CashFlow a={result} base={total.central} money={money} />
          </TablePart>
          <TablePart id="appraisal.uncertainty">
            <section className={card} aria-labelledby="appraisal-draws">
              <h3 id="appraisal-draws" className="caps m-0">
                How sure is the result
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                ENPV of each of the {result.draws} draws. It is above 0 in {Math.round(total.positive * 100)}{" "}
                % of them.
              </p>
              <DrawsChart draws={total.enpvDraws} p={total.enpv} money={money} />
            </section>
            <Tornado a={result} base={total.central.enpv} money={money} perIntl={perIntl} />
            <SwitchingAndTests a={result} money={money} />
          </TablePart>
          {mcaResult && (
            <TablePart id="appraisal.mca">
              <Mca
                result={mcaResult}
                doc={doc}
                onDoc={onDoc}
                prefs={prefs}
                editable={editable}
                setValue={setValue}
                money={money}
              />
            </TablePart>
          )}
        </>
      )}
      <TablePart id="appraisal.settings">
        <Settings
          prefs={prefs}
          perIntl={perIntl}
          currency={currency}
          income={income}
          editable={editable}
          setValue={setValue}
        />
      </TablePart>
    </section>
  );
}

function Range({ t, f }: { t: Triple; f: (v: number) => string }) {
  return (
    <>
      <span className="font-semibold">{f(t[1])}</span>
      <span className="block text-xs text-slate-500">
        {f(t[0])} – {f(t[2])}
      </span>
    </>
  );
}

function rowName(r: AppraisalRow): string {
  return r.scope === "total" ? "All lines" : r.scope === "mode" ? `All ${modeLabel(r.name)} lines` : r.name;
}

function Rows({ rows, money }: { rows: AppraisalRow[]; money: (v: number) => string }) {
  const rate = (t: Triple, share: number) => (share >= 0.5 ? <Range t={t} f={pct} /> : "–");
  return (
    <section className={card} aria-labelledby="appraisal-lines">
      <h3 id="appraisal-lines" className="caps m-0">
        Per line
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Medium, with low – high below. A mode and the total count every line of it and the shared items no
        line runs on yet, on the longest construction and appraisal period of their modes. A rate of return
        shows when most draws have one.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Line</th>
              <th className={`${th} text-right`}>Years</th>
              <th className={`${th} text-right`}>ENPV</th>
              <th className={`${th} text-right`}>Benefit-cost ratio</th>
              <th className={`${th} text-right`}>ERR</th>
              <th className={`${th} text-right`}>FNPV</th>
              <th className={`${th} text-right`}>FIRR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-slate-100 ${r.scope === "line" ? "" : "bg-slate-50 font-medium"}`}
              >
                <td className={td}>
                  <span className="inline-flex items-center gap-2">
                    {r.scope === "line" && (
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-full"
                        style={{ background: r.color }}
                      />
                    )}
                    {rowName(r)}
                  </span>
                </td>
                <td className={num}>
                  {r.timeline.build} + {r.timeline.period}
                  <span className="block text-xs text-slate-500">building + running</span>
                </td>
                <td className={num}>
                  <Range t={r.enpv} f={money} />
                </td>
                <td className={num}>
                  <Range t={r.bcr} f={ratio} />
                </td>
                <td className={num}>{rate(r.err, r.errShare)}</td>
                <td className={num}>
                  <Range t={r.fnpv} f={money} />
                </td>
                <td className={num}>{rate(r.firr, r.firrShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Breakdown({ p, row, money }: { p: Present; row: AppraisalRow; money: (v: number) => string }) {
  const items: [string, number][] = [
    ["Users' benefit: time, comfort and money saved (demand run)", p.user],
    ["Fare revenue", p.fares],
    ["Car-km saved: climate, air, noise, accidents and congestion", p.external],
    ["GDP growth from agglomeration", p.gdp],
  ];
  const costs: [string, number][] = [
    ["Construction and renewals, less residual value", p.capital],
    ["Operating cost", p.operating],
  ];
  const line = ([label, v]: [string, number], bold = false) => (
    <tr key={label} className={`border-b border-slate-100 ${bold ? "bg-slate-50 font-medium" : ""}`}>
      <td className={td}>{label}</td>
      <td className={num}>{money(v)}</td>
    </tr>
  );
  return (
    <section className={card} aria-labelledby="appraisal-present">
      <h3 id="appraisal-present" className="caps m-0">
        Benefits against costs, all lines
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        Medium case, discounted over {row.timeline.build} years of building and {row.timeline.period} of
        operation. Fares count as a benefit because the users' benefit is net of the fares they pay.
      </p>
      <BenefitCostChart p={p} money={money} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-700">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <tbody>
              {items.map((x) => line(x))}
              {line(["Benefits", p.benefits], true)}
              {costs.map((x) => line(x))}
              {line(["Costs", p.costs], true)}
              {line(["Economic net present value", p.enpv], true)}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function CashFlow({ a, base, money }: { a: Appraisal; base: Present; money: (v: number) => string }) {
  const keep = new Set(shownYears(a));
  return (
    <section className={card} aria-labelledby="appraisal-years">
      <h3 id="appraisal-years" className="caps m-0">
        Year by year, all lines
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        Medium case, in today's prices. Construction years first; assets are bought again at the end of their
        life and their remaining value comes back in the last year.
      </p>
      <CashFlowChart years={a.years} rate={base.rate} cf={base.cf} money={money} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-700">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>Year</th>
                <th className={`${th} text-right`}>Construction</th>
                <th className={`${th} text-right`}>Renewals</th>
                <th className={`${th} text-right`}>Residual value</th>
                <th className={`${th} text-right`}>Operating</th>
                <th className={`${th} text-right`}>Users' benefit</th>
                <th className={`${th} text-right`}>Fares</th>
                <th className={`${th} text-right`}>Car-km saved</th>
                <th className={`${th} text-right`}>GDP growth</th>
              </tr>
            </thead>
            <tbody>
              {a.years
                .filter((y) => keep.has(y.year))
                .map((y) => (
                  <tr key={y.year} className="border-b border-slate-100">
                    <td className={td}>
                      {y.year}
                      <span className="block text-xs text-slate-500">
                        {y.op === 0 ? "building" : `operation year ${y.op}`}
                      </span>
                    </td>
                    {[
                      y.construction,
                      y.renewals,
                      y.residual,
                      y.operating,
                      y.user,
                      y.fares,
                      y.external,
                      y.gdp,
                    ].map((v, i) => (
                      <td key={i} className={num}>
                        {v ? money(v) : "–"}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Tornado({
  a,
  base,
  money,
  perIntl,
}: {
  a: Appraisal;
  base: number;
  money: (v: number) => string;
  perIntl: number;
}) {
  const { show, hide, bubble } = useTip();
  const bars = a.tornado.slice(0, 12);
  const lo = Math.min(base, ...bars.map((b) => Math.min(b.low, b.high)));
  const hi = Math.max(base, ...bars.map((b) => Math.max(b.low, b.high)));
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;
  const valueText = (name: string, v: number, unit: string) =>
    !unit
      ? name.startsWith("input.") || name === "ridership"
        ? ""
        : sig(v)
      : unit.startsWith("US$")
        ? `${sig(v * perIntl)} per car-km`
        : unit.startsWith("share")
          ? pct(v)
          : `${sig(v)} ${unit}`;
  return (
    <section className={card} aria-labelledby="appraisal-tornado">
      <h3 id="appraisal-tornado" className="caps m-0">
        What the ENPV depends on
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Each value at its low and at its high, the others at their medium; the line marks the medium case (
        {money(base)}). The largest swings first.
      </p>
      {bars.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No value changes the result.</p>
      ) : (
        <figure className="m-0 mt-3" aria-label="Tornado chart of the economic net present value">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-slate-700">
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: LOW }}
                aria-hidden="true"
              />
              Value at its low
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: HIGH }}
                aria-hidden="true"
              />
              Value at its high
            </li>
          </ul>
          <div data-chart className="relative mt-3 flex flex-col gap-2" onMouseLeave={hide}>
            {bars.map((b) => {
              const seg = (v: number, color: string, which: string, val: number) => {
                const left = Math.min(x(v), x(base));
                const width = Math.max(0.4, Math.abs(x(v) - x(base)));
                const vt = valueText(b.name, val, b.unit);
                const body = (
                  <>
                    <b className="font-semibold">{b.label}</b>
                    <br />
                    {which}
                    {vt ? ` (${vt})` : ""}: ENPV {money(v)}
                  </>
                );
                return (
                  <span
                    tabIndex={0}
                    role="img"
                    aria-label={`${b.label}, ${which}${vt ? ` ${vt}` : ""}: ENPV ${money(v)}`}
                    className="absolute top-0 h-full rounded focus:outline-2 focus:outline-offset-1 focus:outline-slate-900"
                    style={{ left: `${left}%`, width: `${width}%`, background: color }}
                    onMouseMove={(e) => show(e, body)}
                    onFocus={(e) => show(e, body)}
                    onBlur={hide}
                  />
                );
              };
              return (
                <div key={b.name} className="flex flex-col gap-0.5">
                  <span className="text-xs text-slate-700">{b.label}</span>
                  <div className="relative h-4">
                    {seg(b.low, LOW, "at its low", b.values[0])}
                    {seg(b.high, HIGH, "at its high", b.values[1])}
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 h-5 w-[2px] bg-slate-900"
                      style={{ left: `calc(${x(base)}% - 1px)` }}
                    />
                  </div>
                </div>
              );
            })}
            {bubble}
          </div>
          <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500">
            <span>{money(lo)}</span>
            <span>{money(hi)}</span>
          </div>
        </figure>
      )}
      {bars.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-700">Show as a table</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={th}>Value</th>
                  <th className={`${th} text-right`}>ENPV at its low</th>
                  <th className={`${th} text-right`}>ENPV at its high</th>
                </tr>
              </thead>
              <tbody>
                {a.tornado.map((b) => (
                  <tr key={b.name} className="border-b border-slate-100">
                    <td className={td}>{b.label}</td>
                    <td className={num}>{money(b.low)}</td>
                    <td className={num}>{money(b.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function SwitchingAndTests({ a, money }: { a: Appraisal; money: (v: number) => string }) {
  return (
    <section className={card} aria-labelledby="appraisal-switching">
      <h3 id="appraisal-switching" className="caps m-0">
        Switching values and standard tests
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        A switching value is how far one item can change, the others at their medium, before the ENPV reaches
        0 (and the benefit-cost ratio 1).
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Item</th>
              <th className={`${th} text-right`}>Present value</th>
              <th className={`${th} text-right`}>ENPV reaches 0 when it changes by</th>
            </tr>
          </thead>
          <tbody>
            {a.switching.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className={td}>{s.label}</td>
                <td className={num}>{money(s.value)}</td>
                <td className={num}>
                  {s.impossible
                    ? "none: the ENPV stays below 0 even at zero"
                    : s.change === null
                      ? "–"
                      : `${s.change >= 0 ? "+" : "−"}${Math.abs(s.change * 100).toFixed(1)} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="caps pb-1 text-left text-slate-700">
            Standard tests (09-planning-models §3.4)
          </caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Test</th>
              <th className={`${th} text-right`}>ENPV</th>
              <th className={`${th} text-right`}>Benefit-cost ratio</th>
              <th className={`${th} text-right`}>ERR</th>
              <th className={`${th} text-right`}>FNPV</th>
            </tr>
          </thead>
          <tbody>
            {a.tests.map((t) => (
              <tr
                key={t.id}
                className={`border-b border-slate-100 ${t.id === "base" ? "bg-slate-50 font-medium" : ""}`}
              >
                <td className={td}>{t.label}</td>
                <td className={num}>{money(t.result.enpv)}</td>
                <td className={num}>{ratio(t.result.bcr)}</td>
                <td className={num}>{pct(t.result.err)}</td>
                <td className={num}>{money(t.result.fnpv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Mca({
  result,
  doc,
  onDoc,
  prefs,
  editable,
  setValue,
  money,
}: {
  result: ReturnType<typeof mca>;
  doc: AppraisalDoc | null;
  onDoc?: (doc: AppraisalDoc) => void;
  prefs: Record<string, number> | undefined;
  editable: boolean;
  setValue: (id: string, v: number | null) => void;
  money: (v: number) => string;
}) {
  const own = doc?.criteria ?? [];
  const setOwn = (criteria: OwnCriterion[]) => onDoc?.({ ...(doc ?? {}), criteria });
  const patch = (id: string, p: Partial<OwnCriterion>) =>
    setOwn(own.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const fmt = (id: string, v: number | null) => {
    if (v === null) return "–";
    if (id === "enpv" || id === "construction_cost") return money(v);
    return sig(v);
  };
  const sorted = [...result.lines].sort((a, b) => a.rank - b.rank);
  return (
    <section className={card} aria-labelledby="appraisal-mca">
      <h3 id="appraisal-mca" className="caps m-0">
        Multi-criteria analysis of the lines
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Weighted sum: each criterion scores 0 for the worst line and 100 for the best (lower is better for
        costs), weights are shares of all weights. Access gains are per resident near the line's stations
        (benefit tables). Add your own criteria and score each line by hand.
      </p>
      <div className="mt-3 max-w-2xl">
        <RankingChart lines={result.lines} />
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="caps pb-1 text-left text-slate-700">Criteria and weights</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Criterion</th>
              <th className={th}>Better when</th>
              <th className={`${th} text-right`}>Weight</th>
              <th className={`${th} text-right`}>Share</th>
              {editable && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {result.criteria.map((c) => {
              const ownC = c.own ? own.find((o) => `own:${o.id}` === c.id) : undefined;
              const key = `appraisal.mca.weight.${c.id}`;
              return (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className={td}>
                    {ownC && editable ? (
                      <input
                        key={`${c.id}:${ownC.name}`}
                        className="input w-56"
                        aria-label="Criterion name"
                        defaultValue={ownC.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== ownC.name) patch(ownC.id, { name: v });
                        }}
                      />
                    ) : (
                      c.label
                    )}
                  </td>
                  <td className={td}>
                    {ownC && editable ? (
                      <select
                        className="input min-h-10"
                        aria-label={`${c.label}: better when`}
                        value={ownC.higher ? "higher" : "lower"}
                        onChange={(e) => patch(ownC.id, { higher: e.target.value === "higher" })}
                      >
                        <option value="higher">higher</option>
                        <option value="lower">lower</option>
                      </select>
                    ) : c.higher ? (
                      "higher"
                    ) : (
                      "lower"
                    )}
                  </td>
                  <td className={num}>
                    {editable ? (
                      <input
                        key={`${c.id}:${c.weight}`}
                        type="number"
                        min={0}
                        step="any"
                        className="input w-20 text-right"
                        aria-label={`${c.label}: weight`}
                        defaultValue={c.own || prefs?.[key] !== undefined ? c.weight : ""}
                        placeholder={sig(c.weight)}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const n = Number(v);
                          if (ownC) {
                            if (v !== "" && Number.isFinite(n) && n >= 0 && n !== ownC.weight)
                              patch(ownC.id, { weight: n });
                          } else if (v === "") {
                            if (prefs?.[key] !== undefined) setValue(key, null);
                          } else if (Number.isFinite(n) && n >= 0 && n !== prefs?.[key]) setValue(key, n);
                        }}
                      />
                    ) : (
                      sig(c.weight)
                    )}
                  </td>
                  <td className={num}>{pct(c.share)}</td>
                  {editable && (
                    <td className={td}>
                      {ownC && onDoc && (
                        <button
                          type="button"
                          className="btn-ghost text-sm"
                          onClick={() => setOwn(own.filter((o) => o.id !== ownC.id))}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {onDoc && (
        <button
          type="button"
          className="btn-ghost mt-2 text-sm"
          onClick={() =>
            setOwn([
              ...own,
              { id: newId(), name: `Criterion ${own.length + 1}`, weight: 1, higher: true, scores: {} },
            ])
          }
        >
          Add a criterion
        </button>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: `${20 + result.criteria.length * 8}rem` }}>
          <caption className="caps pb-1 text-left text-slate-700">Scores and ranking</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Rank</th>
              <th className={th}>Line</th>
              {result.criteria.map((c) => (
                <th key={c.id} className={`${th} text-right`}>
                  {c.label}
                </th>
              ))}
              <th className={`${th} text-right`}>Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className={td}>{l.rank}</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-full"
                      style={{ background: l.color }}
                    />
                    {l.name}
                  </span>
                </td>
                {result.criteria.map((c) => {
                  const ownC = c.own ? own.find((o) => `own:${o.id}` === c.id) : undefined;
                  const s = l.scores[c.id];
                  return (
                    <td key={c.id} className={num}>
                      {ownC && onDoc ? (
                        <input
                          key={`${c.id}:${l.id}:${ownC.scores[l.id] ?? ""}`}
                          type="number"
                          step="any"
                          className="input w-20 text-right"
                          aria-label={`${c.label}: ${l.name}`}
                          defaultValue={ownC.scores[l.id] ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const n = Number(v);
                            const scores = { ...ownC.scores };
                            if (v === "") delete scores[l.id];
                            else if (Number.isFinite(n)) scores[l.id] = n;
                            else return;
                            if (scores[l.id] !== ownC.scores[l.id]) patch(ownC.id, { scores });
                          }}
                        />
                      ) : (
                        fmt(c.id, l.raw[c.id] ?? null)
                      )}
                      <span className="block text-xs text-slate-500">
                        {s === null ? "no value" : `${Math.round(s ?? 0)} points`}
                      </span>
                    </td>
                  );
                })}
                <td className={`${num} font-semibold`}>{l.total.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** How the settings name the income group each social rate applies to. */
const GROUP_NAME: Record<string, string> = {
  "appraisal.discount.social_high": "this project uses the high-income rate",
  "appraisal.discount.social_upper_middle":
    "this project uses the upper-middle-income rate, also used when the country's group is not known yet",
  "appraisal.discount.social_lower": "this project uses the rate for lower-middle and low-income countries",
};

/** Modes with their own library value for a key, for the per-mode rows. */
function modesOf(key: string): string[] {
  return Object.keys(PARAMS[key]?.values ?? {}).filter((m) => m !== "*");
}

function Settings({
  prefs,
  perIntl,
  currency,
  income,
  editable,
  setValue,
}: {
  prefs: Record<string, number> | undefined;
  perIntl: number;
  currency: string | null;
  income: string | null;
  editable: boolean;
  setValue: (id: string, v: number | null) => void;
}) {
  const used = socialRateKey(income);
  return (
    <section className={card} aria-labelledby="appraisal-settings">
      <h3 id="appraisal-settings" className="caps m-0">
        Appraisal settings
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Setting a value replaces the medium; low and high move with it. Values marked “your choice” stay fixed
        in the Monte Carlo run. The social discount rate follows the World Bank's income group of the
        project's country: {GROUP_NAME[used]}. These values are set here only. Sources and reasoning are in
        assumptions/DEFAULTS.md.
      </p>
      {appraisalSettingGroups(income).map((g) => (
        <div key={g.title} className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="caps pb-1 text-left text-slate-700">{g.title}</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>Value</th>
                <th className={`${th} text-right`}>Library low – medium – high</th>
                <th className={`${th} text-right`}>This project</th>
              </tr>
            </thead>
            <tbody>
              {g.keys.flatMap((k) =>
                ["*", ...modesOf(k)].map((m) => (
                  <SettingRow
                    key={`${k}|${m}`}
                    k={k}
                    mode={m}
                    note={
                      k.startsWith("appraisal.discount.social")
                        ? k === used
                          ? "applies to this project's country"
                          : "not used for this country"
                        : null
                    }
                    prefs={prefs}
                    perIntl={perIntl}
                    currency={currency}
                    editable={editable}
                    setValue={setValue}
                  />
                )),
              )}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function SettingRow({
  k,
  mode,
  note,
  prefs,
  perIntl,
  currency,
  editable,
  setValue,
}: {
  k: string;
  mode: string;
  note: string | null;
  prefs: Record<string, number> | undefined;
  perIntl: number;
  currency: string | null;
  editable: boolean;
  setValue: (id: string, v: number | null) => void;
}) {
  const p = PARAMS[k]!;
  const money = p.unit.startsWith("US$");
  const share = p.unit.startsWith("share");
  const k1 = money ? perIntl : 1;
  const lib = libraryValue(k, mode).map((v) => v * k1) as Triple;
  const usedV = paramValue(k, mode, prefs)[1] * k1;
  const id = mode === "*" ? k : `${k}.${mode}`;
  const mine = prefs?.[id];
  const shown = mine === undefined ? undefined : Number((mine * k1).toPrecision(6));
  const f = (v: number) =>
    money
      ? new Intl.NumberFormat("en", {
          style: currency ? "currency" : undefined,
          currency: currency ?? undefined,
          maximumSignificantDigits: 3,
        }).format(v)
      : share
        ? pct(v)
        : sig(v);
  const unit = money ? `${currency ?? "local currency"} per car-km` : p.unit;
  const modeName = mode === "*" ? "" : ` (${modeLabel(mode)})`;
  return (
    <tr className="border-b border-slate-100">
      <td className={td}>
        {p.label}
        {modeName}
        <span className="block text-xs text-slate-500">
          {unit}
          {POLICY.has(k) ? " · your choice" : ""}
          {note ? ` · ${note}` : ""}
        </span>
      </td>
      <td className={num}>
        {f(lib[0])} – {f(lib[1])} – {f(lib[2])}
      </td>
      <td className={num}>
        {editable ? (
          <input
            key={`${id}:${shown ?? ""}:${k1}`}
            type="number"
            step="any"
            className="input w-28 text-right"
            aria-label={`${p.label}${modeName}`}
            defaultValue={shown ?? ""}
            placeholder={money ? sig(usedV) : sig(usedV)}
            onBlur={(e) => {
              const v = e.target.value.trim();
              const n = Number(v);
              if (v === "") {
                if (mine !== undefined) setValue(id, null);
              } else if (Number.isFinite(n) && n !== shown) setValue(id, n / k1);
            }}
          />
        ) : (
          f(usedV)
        )}
      </td>
    </tr>
  );
}

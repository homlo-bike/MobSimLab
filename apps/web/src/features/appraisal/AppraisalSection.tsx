import { useMemo } from "react";
import { hasMessage, type Translate, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { paramLabel, paramUnit } from "../../i18n/params";
import type { Estimate as BenefitEstimate } from "../benefits/model";
import type { Triple } from "../benefits/params";
import { useTip } from "../costs/charts";
import { card, num, td, th, Tile } from "../costs/CostTables";
import { useModeLabel } from "../schematic/common";
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
  type TornadoBar,
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
  const { t } = useI18n();
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
      ? t("apr.currencyNote", { run: demand.appraisal.currency, tables: currency })
      : null;

  return (
    <section aria-labelledby="appraisal-title" className="mt-10">
      <h2 id="appraisal-title" className="text-xl font-semibold tracking-tight">
        {t("apr.title")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        {t("apr.intro", { draws: result?.draws ?? draws ?? 200 })}
      </p>
      {!costs && (
        <p role="status" className="mt-4 text-sm text-slate-500">
          {t("apr.waiting")}
        </p>
      )}
      {costs && !lines.length && (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          {t("apr.noLines")}
        </p>
      )}
      {result && total && (
        <>
          <TablePart id="appraisal.results">
            {[...result.notes.map((n) => t(n.key, n.vars)), ...(currencyNote ? [currencyNote] : [])].map(
              (n) => (
                <p key={n} className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {n}
                </p>
              ),
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                title={t("apr.tile.enpv")}
                value={money(total.enpv[1])}
                sub={t("apr.tile.enpvSub", {
                  low: money(total.enpv[0]),
                  high: money(total.enpv[2]),
                  pct: Math.round(total.positive * 100),
                })}
              />
              <Tile
                title={t("apr.tile.bcr")}
                value={ratio(total.bcr[1])}
                sub={`${ratio(total.bcr[0])} – ${ratio(total.bcr[2])}`}
              />
              <Tile
                title={t("apr.tile.err")}
                value={total.errShare >= 0.5 ? pct(total.err[1]) : "–"}
                sub={
                  total.errShare >= 0.5
                    ? `${pct(total.err[0])} – ${pct(total.err[2])}`
                    : t("apr.tile.errNone")
                }
              />
              <Tile
                title={t("apr.tile.fnpv")}
                value={money(total.fnpv[1])}
                sub={t("apr.tile.fnpvSub", { firr: total.firrShare >= 0.5 ? pct(total.firr[1]) : "–" })}
              />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {t("apr.tilesNote", {
                draws: result.draws,
                enpv: money(total.central.enpv),
                bcr: ratio(total.central.bcr),
                fnpv: money(total.central.fnpv),
              })}
            </p>
            <Breakdown p={total.central} row={total} money={money} />
            <Rows rows={result.rows} money={money} />
            <CashFlow a={result} base={total.central} money={money} />
          </TablePart>
          <TablePart id="appraisal.uncertainty">
            <section className={card} aria-labelledby="appraisal-draws">
              <h3 id="appraisal-draws" className="caps m-0">
                {t("apr.howSure")}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {t("apr.howSureNote", { draws: result.draws, pct: Math.round(total.positive * 100) })}
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

function Range({ v: t, f }: { v: Triple; f: (v: number) => string }) {
  return (
    <>
      <span className="font-semibold">{f(t[1])}</span>
      <span className="block text-xs text-slate-500">
        {f(t[0])} – {f(t[2])}
      </span>
    </>
  );
}

function rowName(t: Translate, modeLabel: (m: string) => string, r: AppraisalRow): string {
  return r.scope === "total"
    ? t("fare.allLines")
    : r.scope === "mode"
      ? t("fare.allModeLines", { mode: modeLabel(r.name) })
      : r.name;
}

function Rows({ rows, money }: { rows: AppraisalRow[]; money: (v: number) => string }) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const rate = (v: Triple, share: number) => (share >= 0.5 ? <Range v={v} f={pct} /> : "–");
  return (
    <section className={card} aria-labelledby="appraisal-lines">
      <h3 id="appraisal-lines" className="caps m-0">
        {t("apr.perLine")}{" "}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("apr.perLineNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("apr.col.line")}</th>
              <th className={`${th} text-right`}>{t("apr.col.years")}</th>
              <th className={`${th} text-right`}>{t("apr.col.enpv")}</th>
              <th className={`${th} text-right`}>{t("apr.col.bcr")}</th>
              <th className={`${th} text-right`}>{t("apr.col.err")}</th>
              <th className={`${th} text-right`}>{t("apr.col.fnpv")}</th>
              <th className={`${th} text-right`}>{t("apr.col.firr")}</th>
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
                    {rowName(t, modeLabel, r)}
                  </span>
                </td>
                <td className={num}>
                  {r.timeline.build} + {r.timeline.period}
                  <span className="block text-xs text-slate-500">{t("apr.buildRun")}</span>
                </td>
                <td className={num}>
                  <Range v={r.enpv} f={money} />
                </td>
                <td className={num}>
                  <Range v={r.bcr} f={ratio} />
                </td>
                <td className={num}>{rate(r.err, r.errShare)}</td>
                <td className={num}>
                  <Range v={r.fnpv} f={money} />
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
  const { t } = useI18n();
  const items: [string, number][] = [
    [t("apr.bd.user"), p.user],
    [t("apr.item.fares"), p.fares],
    [t("apr.bd.external"), p.external],
    [t("apr.sw.gdp"), p.gdp],
  ];
  const costs: [string, number][] = [
    [t("apr.bd.capital"), p.capital],
    [t("apr.item.operating"), p.operating],
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
        {t("apr.bd.title")}
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        {t("apr.bd.note", { build: row.timeline.build, period: row.timeline.period })}
      </p>
      <BenefitCostChart p={p} money={money} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-700">{t("apr.asTable")}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <tbody>
              {items.map((x) => line(x))}
              {line([t("apr.benefits"), p.benefits], true)}
              {costs.map((x) => line(x))}
              {line([t("apr.costs"), p.costs], true)}
              {line([t("apr.tile.enpv"), p.enpv], true)}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function CashFlow({ a, base, money }: { a: Appraisal; base: Present; money: (v: number) => string }) {
  const { t } = useI18n();
  const keep = new Set(shownYears(a));
  return (
    <section className={card} aria-labelledby="appraisal-years">
      <h3 id="appraisal-years" className="caps m-0">
        {t("fare.byYear")}
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">{t("apr.cashNote")}</p>
      <CashFlowChart years={a.years} rate={base.rate} cf={base.cf} money={money} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-700">{t("apr.asTable")}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t("apr.col.year")}</th>
                <th className={`${th} text-right`}>{t("apr.col.construction")}</th>
                <th className={`${th} text-right`}>{t("apr.col.renewals")}</th>
                <th className={`${th} text-right`}>{t("apr.col.residual")}</th>
                <th className={`${th} text-right`}>{t("apr.col.operating")}</th>
                <th className={`${th} text-right`}>{t("apr.col.user")}</th>
                <th className={`${th} text-right`}>{t("apr.col.fares")}</th>
                <th className={`${th} text-right`}>{t("apr.col.external")}</th>
                <th className={`${th} text-right`}>{t("apr.col.gdp")}</th>
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
                        {y.op === 0 ? t("apr.building") : t("apr.opYear", { n: y.op })}
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
  const { t, language } = useI18n();
  const { show, hide, bubble } = useTip();
  const label = (b: TornadoBar) =>
    hasMessage(`apr.in.${b.name}`)
      ? t(`apr.in.${b.name}` as MessageKey)
      : paramLabel(language, b.name, b.label);
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
        ? t("apr.perCarKm", { v: sig(v * perIntl) })
        : unit.startsWith("share")
          ? pct(v)
          : `${sig(v)} ${paramUnit(language, unit)}`;
  return (
    <section className={card} aria-labelledby="appraisal-tornado">
      <h3 id="appraisal-tornado" className="caps m-0">
        {t("apr.tornado")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("apr.tornadoNote", { base: money(base) })}</p>
      {bars.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{t("apr.noSwing")}</p>
      ) : (
        <figure className="m-0 mt-3" aria-label={t("apr.tornadoChart")}>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-slate-700">
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: LOW }}
                aria-hidden="true"
              />
              {t("apr.atLowLegend")}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: HIGH }}
                aria-hidden="true"
              />
              {t("apr.atHighLegend")}
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
                    <b className="font-semibold">{label(b)}</b>
                    <br />
                    {t("apr.tornadoTip", { which: vt ? `${which} (${vt})` : which, enpv: money(v) })}
                  </>
                );
                return (
                  <span
                    tabIndex={0}
                    role="img"
                    aria-label={`${label(b)}, ${t("apr.tornadoTip", { which: vt ? `${which} ${vt}` : which, enpv: money(v) })}`}
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
                  <span className="text-xs text-slate-700">{label(b)}</span>
                  <div className="relative h-4">
                    {seg(b.low, LOW, t("apr.atLow"), b.values[0])}
                    {seg(b.high, HIGH, t("apr.atHigh"), b.values[1])}
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
          <summary className="cursor-pointer text-slate-700">{t("apr.asTable")}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={th}>{t("apr.col.value")}</th>
                  <th className={`${th} text-right`}>{t("apr.col.atLow")}</th>
                  <th className={`${th} text-right`}>{t("apr.col.atHigh")}</th>
                </tr>
              </thead>
              <tbody>
                {a.tornado.map((b) => (
                  <tr key={b.name} className="border-b border-slate-100">
                    <td className={td}>{label(b)}</td>
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
  const { t } = useI18n();
  return (
    <section className={card} aria-labelledby="appraisal-switching">
      <h3 id="appraisal-switching" className="caps m-0">
        {t("apr.switching")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("apr.switchingNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("apr.col.item")}</th>
              <th className={`${th} text-right`}>{t("apr.col.present")}</th>
              <th className={`${th} text-right`}>{t("apr.col.switch")}</th>
            </tr>
          </thead>
          <tbody>
            {a.switching.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className={td}>{t(`apr.sw.${s.id}`)}</td>
                <td className={num}>{money(s.value)}</td>
                <td className={num}>
                  {s.impossible
                    ? t("apr.switchNone")
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
          <caption className="caps pb-1 text-left text-slate-700">{t("apr.tests")}</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("apr.col.test")}</th>
              <th className={`${th} text-right`}>{t("apr.col.enpv")}</th>
              <th className={`${th} text-right`}>{t("apr.col.bcr")}</th>
              <th className={`${th} text-right`}>{t("apr.col.err")}</th>
              <th className={`${th} text-right`}>{t("apr.col.fnpv")}</th>
            </tr>
          </thead>
          <tbody>
            {a.tests.map((x) => (
              <tr
                key={x.id}
                className={`border-b border-slate-100 ${x.id === "base" ? "bg-slate-50 font-medium" : ""}`}
              >
                <td className={td}>
                  {hasMessage(`apr.test.${x.id}`) ? t(`apr.test.${x.id}` as MessageKey) : x.label}
                </td>
                <td className={num}>{money(x.result.enpv)}</td>
                <td className={num}>{ratio(x.result.bcr)}</td>
                <td className={num}>{pct(x.result.err)}</td>
                <td className={num}>{money(x.result.fnpv)}</td>
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
  const { t } = useI18n();
  const own = doc?.criteria ?? [];
  const label = (c: { id: string; label: string; own: boolean }) =>
    c.own ? c.label : hasMessage(`apr.crit.${c.id}`) ? t(`apr.crit.${c.id}` as MessageKey) : c.label;
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
        {t("apr.mca")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("apr.mcaNote")}</p>
      <div className="mt-3 max-w-2xl">
        <RankingChart lines={result.lines} />
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="caps pb-1 text-left text-slate-700">{t("apr.criteria")}</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("apr.col.criterion")}</th>
              <th className={th}>{t("apr.col.betterWhen")}</th>
              <th className={`${th} text-right`}>{t("apr.col.weight")}</th>
              <th className={`${th} text-right`}>{t("apr.col.share")}</th>
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
                        aria-label={t("apr.critName")}
                        defaultValue={ownC.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== ownC.name) patch(ownC.id, { name: v });
                        }}
                      />
                    ) : (
                      label(c)
                    )}
                  </td>
                  <td className={td}>
                    {ownC && editable ? (
                      <select
                        className="input min-h-10"
                        aria-label={t("apr.betterWhenOf", { name: label(c) })}
                        value={ownC.higher ? "higher" : "lower"}
                        onChange={(e) => patch(ownC.id, { higher: e.target.value === "higher" })}
                      >
                        <option value="higher">{t("apr.higher")}</option>
                        <option value="lower">{t("apr.lower")}</option>
                      </select>
                    ) : (
                      t(c.higher ? "apr.higher" : "apr.lower")
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
                        aria-label={t("apr.weightOf", { name: label(c) })}
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
                          {t("dem.remove")}
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
              {
                id: newId(),
                name: t("apr.critDefault", { n: own.length + 1 }),
                weight: 1,
                higher: true,
                scores: {},
              },
            ])
          }
        >
          {t("apr.addCrit")}
        </button>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: `${20 + result.criteria.length * 8}rem` }}>
          <caption className="caps pb-1 text-left text-slate-700">{t("apr.scores")}</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("apr.col.rank")}</th>
              <th className={th}>{t("apr.col.line")}</th>
              {result.criteria.map((c) => (
                <th key={c.id} className={`${th} text-right`}>
                  {label(c)}
                </th>
              ))}
              <th className={`${th} text-right`}>{t("apr.col.score")}</th>
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
                          aria-label={`${label(c)}: ${l.name}`}
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
                        {s === null ? t("apr.noValue") : t("apr.points", { n: Math.round(s ?? 0) })}
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
const GROUP_NAME: Record<string, MessageKey> = {
  "appraisal.discount.social_high": "apr.rate.high",
  "appraisal.discount.social_upper_middle": "apr.rate.upperMiddle",
  "appraisal.discount.social_lower": "apr.rate.lower",
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
  const { t } = useI18n();
  const used = socialRateKey(income);
  return (
    <section className={card} aria-labelledby="appraisal-settings">
      <h3 id="appraisal-settings" className="caps m-0">
        {t("apr.settings")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("apr.settingsNote", { group: t(GROUP_NAME[used]!) })}</p>
      {appraisalSettingGroups(income).map((g) => (
        <div key={g.title} className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="caps pb-1 text-left text-slate-700">{t(g.title)}</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t("apr.col.value")}</th>
                <th className={`${th} text-right`}>{t("apr.col.library")}</th>
                <th className={`${th} text-right`}>{t("apr.col.project")}</th>
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
                          ? t("apr.rateApplies")
                          : t("apr.rateNotUsed")
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
  const { t, language } = useI18n();
  const modeLabel = useModeLabel();
  const p = PARAMS[k]!;
  const label = paramLabel(language, k, p.label);
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
  const unit = money
    ? t("apr.perCarKmUnit", { currency: currency ?? t("fare.localCurrency") })
    : paramUnit(language, p.unit);
  const modeName = mode === "*" ? "" : ` (${modeLabel(mode)})`;
  return (
    <tr className="border-b border-slate-100">
      <td className={td}>
        {label}
        {modeName}
        <span className="block text-xs text-slate-500">
          {unit}
          {POLICY.has(k) ? t("fare.yourChoice") : ""}
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
            aria-label={`${label}${modeName}`}
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

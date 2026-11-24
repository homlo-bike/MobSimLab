import { type ReactNode, useEffect, useMemo, useState } from "react";
import { loadRailEngine, nextTask } from "../railways/engine";
import { TablePart } from "../tables/sections";
import { hashText } from "../../projects/inputKey";
import { type ResultsApi, useLiveResult } from "../../projects/results";
import { hasMessage, tNow, type Translate, type TranslatePlural, useI18n, withNodes } from "../../i18n/i18n";
import { tablesEn } from "../../i18n/tables/en";
import { useModeLabel } from "../schematic/common";
import { RAIL_MODES } from "../railways/modes";
import { engineLines } from "../railways/serviceLines";
import type { LineReport, Network, RailEngineLoader, RailView } from "../railways/types";
import { MODES as STREET_MODES } from "../street-lines/modes";
import type { StreetLinesDoc } from "../street-lines/saved";
import { type PreferencesDoc, withPref } from "../../workspace/preferences";
import {
  type CountryEconomy,
  type EconomyApi,
  economyApi,
  PRICE_PREFS,
  type Prices,
  pricesFrom,
  type WbCountry,
  countryName,
} from "./economy";
import { convertTo, type ProjectCurrency } from "./currency";
import { BarList, CompositionChart, InlineBar, totalsOf } from "./charts";
import {
  CATEGORY_LABEL,
  type Category,
  CONSTRUCTION,
  type CostItem,
  type Estimate,
  estimate,
  isConstruction,
  OPERATING,
  perLine,
  sum,
} from "./model";
import { libraryValue, outsideLibraryRange, PARAMS, paramValue, prefId, type Triple } from "./params";
import { SPARE_PREF } from "../../workspace/editedElsewhere";
import type { SavedPluginLine } from "../../kits/saved";
import { activePlugins } from "../../plugins/registry";
import { ferryLines } from "../tables/ferries";
import { ropewayLines } from "../tables/ropeways";
import { engineErrorText } from "../../i18n/engine";

/** Cost tables settings (drawing kind `costs`): the country the planner chose for prices. */
export interface CostsDoc {
  country?: string | null;
}

interface Props {
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  /** The plugin tools' lines by line key (the cable cars and ferries are priced). */
  pluginLines?: Readonly<Record<string, SavedPluginLine>>;
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
  costs: CostsDoc | null;
  onCosts?: (doc: CostsDoc) => void;
  /** The project's currency (Project preferences); null keeps the country's own currency. */
  currency?: ProjectCurrency | null;
  /**
   * Told the estimate, the prices (in the currency shown), the country code and the factor from the country's
   * currency to the one shown whenever they change (the benefit tables use them).
   */
  onEstimate?: (
    e: Estimate,
    prices: Prices,
    country: string | null,
    rate: number,
    income: string | null,
  ) => void;
  /** The project's saved results: the railway quantities the tables price, built again when the railway changes. */
  results?: ResultsApi | null;
  /** The planner may replace the saved results (Owners and Editors). */
  canSave?: boolean;
  /** Tests inject these. */
  loadRail?: RailEngineLoader;
  api?: EconomyApi;
}

const DEFAULT_API = economyApi();
const BASE_YEAR = libraryValue("cost.price_base_year", "*")[1];

/** Purpose: a mode's name in the language on screen, for code outside a component (see `useModeLabel`). */
export function modeLabel(mode: string): string {
  const key =
    RAIL_MODES.find((m) => m.id === mode)?.label ?? STREET_MODES[mode as keyof typeof STREET_MODES]?.label;
  return key ? tNow(key) : mode.replace(/_/g, " ");
}

/** Purpose: money in a short form, such as "€1.2 bn" or "1.2 bn local currency". */
export function fmtMoney(v: number, currency: string | null): string {
  const opts: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: v >= 1e3 ? 1 : 0 };
  if (!currency) return `${new Intl.NumberFormat("en", opts).format(v)} LCU`;
  return new Intl.NumberFormat("en", { ...opts, style: "currency", currency }).format(v);
}

/** Purpose: a cost parameter's name in the language; parameters added to the library later stay in English. */
function paramLabel(t: Translate, key: string, label: string): string {
  const k = `cost.p.${key}`;
  return hasMessage(k) ? t(k) : label;
}

/** English unit of each `cost.pu.*` message, with the price base year filled in, back to its key. */
const UNIT_KEYS = new Map(
  Object.entries(tablesEn)
    .filter(([k]) => k.startsWith("cost.pu."))
    .map(([k, v]) => [v.replace("{year}", String(BASE_YEAR)), k as keyof typeof tablesEn] as const),
);

/** Purpose: a cost parameter's unit in the language; units not in the messages stay in English. */
function paramUnit(t: Translate, unit: string): string {
  const k = UNIT_KEYS.get(unit);
  return k ? t(k, { year: BASE_YEAR }) : unit;
}

/** Purpose: a count with the language's plural form, the count in the tables' number format. */
function count(tn: TranslatePlural, key: "cost.groups" | "cost.items", n: number): string {
  return tn(key, n, { count: String(n) });
}

/** Purpose: a quantity with sensible decimals. */
export function fmtQty(q: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: q < 10 ? 2 : q < 1000 ? 1 : 0 }).format(q);
}

/**
 * The construction and operating cost tables of the Tables tab (ADR-0039): per mode, per line and in total,
 * by construction type, in the project's currency at today's prices, with low, medium and high estimates.
 * Every unit cost and the price conversion can be changed for the project.
 * Side effects: builds the railway design with the rail engine; asks the API for the country of the project
 * and its World Bank price levels.
 */
export function CostTables({
  railway,
  streetLines,
  pluginLines,
  preferences,
  onPreferences,
  costs,
  onCosts,
  currency = null,
  onEstimate,
  loadRail = loadRailEngine,
  api = DEFAULT_API,
  results = null,
  canSave = false,
}: Props) {
  const { t, language } = useI18n();
  const modeLabel = useModeLabel();
  const prefs = preferences?.values;
  const [placeCode, setPlaceCode] = useState<string | null>(null);
  const [econ, setEcon] = useState<CountryEconomy | null>(null);
  const [econError, setEconError] = useState<string | null>(null);
  const [countries, setCountries] = useState<WbCountry[]>([]);

  // The railway as the engine builds it, and its service lines as published: saved with the project, and
  // built again when the railway changes.
  const railJson = JSON.stringify(railway);
  const railInputs = useMemo(
    () => (railway && railway.tracks.length ? hashText(railJson) : null),
    // The railway's JSON stands for the railway.
    [railJson],
  );
  const built = useLiveResult<{ view: RailView; reports: Record<string, LineReport> }>(
    results,
    "cost-quantities",
    railInputs,
    canSave,
    async () => {
      const engine = await loadRail();
      try {
        // Building and publishing are a second or more each on a large railway: the page answers in between.
        await nextTask();
        const view = engine.build(railway!, null);
        const reports: Record<string, LineReport> = {};
        const lines = engineLines(railway!);
        if (lines.length)
          try {
            await nextTask();
            for (const r of engine.publishLines(lines, "weekday").lines) reports[r.id] = r;
          } catch {
            // Lines that cannot be published are listed in the notes.
          }
        return { view, reports };
      } finally {
        engine.dispose();
      }
    },
  );
  const rail = built.value;
  const railError = built.error;

  // Where the project is: the railway's origin, else the first street line's first point.
  const place = railway?.origin ?? streetLines?.lines[0]?.points[0]?.lonlat ?? null;
  const placeKey = place ? `${place[0].toFixed(2)},${place[1].toFixed(2)}` : null;
  useEffect(() => {
    if (costs?.country || !place) return;
    let live = true;
    api
      .countryAt(place)
      .then((c) => live && setPlaceCode(c.iso3 ?? c.iso2))
      .catch((e: unknown) => live && setEconError(engineErrorText(e)));
    return () => {
      live = false;
    };
  }, [placeKey, costs?.country, api]);
  const code = costs?.country ?? placeCode;
  useEffect(() => {
    if (!code) return;
    let live = true;
    setEconError(null);
    api
      .indicators(code, BASE_YEAR)
      .then((e) => live && setEcon(e))
      .catch((e: unknown) => {
        if (!live) return;
        setEcon(null);
        setEconError(engineErrorText(e));
      });
    return () => {
      live = false;
    };
  }, [code, api]);
  useEffect(() => {
    let live = true;
    api
      .countries()
      .then((c) => live && setCountries(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  // The country's prices, then the same in the project's currency (Project preferences).
  const local = useMemo(() => pricesFrom(econ, prefs), [econ, prefs]);
  const conv = convertTo(currency, local.currency, local.fx);
  const prices = useMemo(
    () =>
      conv.rate === 1 && conv.currency === local.currency
        ? local
        : { ...local, currency: conv.currency, ppp: local.ppp * conv.rate, fx: local.fx * conv.rate },
    [local, conv.currency, conv.rate],
  );
  // The cable car plugin may be turned off for the project: its lines then leave the tables.
  const plugins = activePlugins();
  const ropeways = useMemo(
    () => ropewayLines(pluginLines, undefined, plugins, prefs),
    [pluginLines, plugins, prefs],
  );
  const ferries = useMemo(
    () => ferryLines(pluginLines, undefined, plugins, prefs),
    [pluginLines, plugins, prefs],
  );
  const est = useMemo(
    () =>
      estimate({
        railway,
        view: rail?.view ?? null,
        reports: rail?.reports ?? {},
        streetLines: streetLines?.lines ?? [],
        prefs,
        prices,
        ropeways,
        ferries,
        t,
      }),
    [railway, rail, streetLines, prefs, prices, ropeways, ferries, t],
  );
  // The appraisal waits for the country's figures and the railway's publication, so it never shows interim
  // numbers (another currency, a shorter timeline) that change a moment later.
  const settling =
    (!econError && ((!!place && !code) || (!!code && !econ))) ||
    (!!railway?.tracks.length && !rail && !railError);
  useEffect(() => {
    if (settling) return;
    onEstimate?.(est, prices, code ?? null, conv.rate, econ?.country.income ?? null);
  }, [settling, est, prices, code, onEstimate, conv.rate, econ?.country.income]);
  const money = (v: number) => fmtMoney(v, prices.currency);
  const range = (t: Triple) => `${money(t[0])} – ${money(t[2])}`;
  const editable = !!onPreferences;
  const setPref = (id: string, value: number | null) => onPreferences?.(withPref(preferences, id, value));

  const construction = sum(est.items.filter((x) => isConstruction(x.category)).map((x) => x.amount));
  const operating = sum(est.items.filter((x) => !isConstruction(x.category)).map((x) => x.amount));
  const empty = !est.items.length;

  return (
    <div>
      <section aria-labelledby="cost-title" className="mt-6">
        <h2 id="cost-title" className="text-xl font-semibold tracking-tight">
          {t("cost.title")}
        </h2>
        <p className="mt-1 max-w-3xl text-slate-600">
          {t("cost.intro", {
            country: econ ? countryName(econ.country, language) : t("cost.projectCountry"),
          })}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">
            {conv.currency !== local.currency
              ? t("cost.pricesConverted", {
                  year: prices.year ?? BASE_YEAR,
                  currency: prices.currency ?? t("cost.localCurrency"),
                  rate: sig(conv.rate),
                  from: local.currency ?? t("cost.localCurrencyUnit"),
                })
              : t("cost.pricesIn", {
                  year: prices.year ?? BASE_YEAR,
                  currency: prices.currency ?? t("cost.localCurrency"),
                })}
          </span>
        </div>
        {railError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {t("tbl.railwayUnreadable", { error: railError })}
          </p>
        )}
        {empty ? (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
            {t("cost.nothing")}
          </p>
        ) : (
          <>
            <TablePart id="costs.overview">
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Tile
                  title={t("tbl.construction")}
                  value={money(construction[1])}
                  sub={t("cost.lowToHigh", { range: range(construction) })}
                />
                <Tile
                  title={t("cost.operatingTile")}
                  value={money(operating[1])}
                  sub={t("cost.lowToHigh", { range: range(operating) })}
                />
              </div>
              <section className={card} aria-labelledby="cost-where">
                <h3 id="cost-where" className="caps m-0">
                  {t("cost.where")}
                </h3>
                <div className="mt-3 grid gap-6 md:grid-cols-2">
                  <CompositionChart est={est} money={money} labelOf={modeLabel} />
                  <BarList
                    label={t("cost.byType")}
                    money={money}
                    rows={CONSTRUCTION.map((c) => ({
                      id: c,
                      label: t(CATEGORY_LABEL[c]),
                      value: sum(est.items.filter((x) => x.category === c).map((x) => x.amount)),
                    }))}
                  />
                </div>
              </section>
              <ByMode est={est} money={money} range={range} />
              <ByLine est={est} money={money} range={range} />
              {est.notes.length > 0 && (
                <ul className="mt-4 list-disc pl-5 text-sm text-slate-600">
                  {est.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </TablePart>
            <TablePart id="costs.construction">
              <Breakdown
                id="cost-construction-by-infrastructure-type"
                title={t("cost.constructionByType")}
                cats={CONSTRUCTION}
                est={est}
                money={money}
              />
            </TablePart>
            <TablePart id="costs.operating">
              <Breakdown
                id="cost-operating-cost-a-year"
                title={t("cost.operatingYear")}
                cats={OPERATING}
                est={est}
                money={money}
                chart={
                  <BarList
                    label={t("cost.operatingByKind")}
                    money={money}
                    rows={OPERATING.map((c) => ({
                      id: c,
                      label: t(CATEGORY_LABEL[c]),
                      value: sum(est.items.filter((x) => x.category === c).map((x) => x.amount)),
                    }))}
                  />
                }
              />
            </TablePart>
          </>
        )}
        <TablePart id="costs.prices">
          <PricesSection
            econ={econ}
            error={econError}
            prices={local}
            countries={countries}
            code={code}
            chosen={!!costs?.country}
            editable={editable && !!onCosts}
            onCountry={(c) => onCosts?.({ ...(costs ?? {}), country: c })}
            prefs={prefs}
            setPref={setPref}
          />
          {!empty && <UnitCosts est={est} prefs={prefs} editable={editable} setPref={setPref} />}
        </TablePart>
      </section>
    </div>
  );
}

export function Tile({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="caps m-0">{title}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

export const card = "mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6";
export const th = "px-2 py-1.5 text-left font-medium text-slate-600";
export const td = "px-2 py-1.5 align-top";
export const num = "px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap";

/** Sort state of a table: a column and a direction. */
export type Sort<K extends string> = { key: K; dir: 1 | -1 } | null;

/** Purpose: a column header that sorts the table: first click largest (or A–Z) first, then reverse, then off. */
export function SortHeader<K extends string>({
  label,
  k,
  sort,
  setSort,
  right = false,
}: {
  label: string;
  k: K;
  sort: Sort<K>;
  setSort: (s: Sort<K>) => void;
  right?: boolean;
}) {
  const on = sort?.key === k;
  const next: Sort<K> = !on ? { key: k, dir: -1 } : sort.dir === -1 ? { key: k, dir: 1 } : null;
  return (
    <th
      className={`${th} ${right ? "text-right" : ""}`}
      aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 font-medium hover:text-slate-900 ${on ? "text-slate-900" : ""}`}
        onClick={() => setSort(next)}
      >
        {label}
        <span aria-hidden="true" className={`text-[10px] ${on ? "" : "text-slate-300"}`}>
          {on ? (sort.dir === -1 ? "▼" : "▲") : "▼"}
        </span>
      </button>
    </th>
  );
}

/** Purpose: rows ordered by a sort; text compares A–Z, numbers by size. */
export function sorted<T, K extends string>(
  rows: T[],
  sort: Sort<K>,
  value: (r: T, k: K) => number | string,
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    // The first click (dir −1) puts numbers largest first and text A–Z.
    return typeof x === "number" ? c * sort.dir : -c * sort.dir;
  });
}

function ByMode({
  est,
  money,
  range,
}: {
  est: Estimate;
  money: (v: number) => string;
  range: (t: Triple) => string;
}) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const [sort, setSort] = useState<Sort<"mode" | "c" | "o">>(null);
  const base = est.modes.map((m) => ({ mode: m, ...totalsOf(est, (_, mode) => mode === m) }));
  const rows = sorted(base, sort, (r, k) =>
    k === "mode" ? modeLabel(r.mode) : k === "c" ? r.construction[1] : r.operating[1],
  );
  const c = sum(base.map((r) => r.construction));
  const o = sum(base.map((r) => r.operating));
  const maxC = Math.max(...base.map((r) => r.construction[1]));
  const maxO = Math.max(...base.map((r) => r.operating[1]));
  return (
    <section className={card} aria-labelledby="cost-by-mode">
      <h3 id="cost-by-mode" className="caps m-0">
        {t("tbl.perMode")}
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <SortHeader label={t("tbl.mode")} k="mode" sort={sort} setSort={setSort} />
              <SortHeader label={t("tbl.construction")} k="c" sort={sort} setSort={setSort} right />
              <SortHeader label={t("tbl.operatingYear")} k="o" sort={sort} setSort={setSort} right />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mode} className="border-b border-slate-100">
                <td className={td}>{modeLabel(r.mode)}</td>
                <td className={num}>
                  {money(r.construction[1])}
                  <span className="block text-xs text-slate-500">{range(r.construction)}</span>
                  {base.length > 1 && <InlineBar value={r.construction[1]} max={maxC} />}
                </td>
                <td className={num}>
                  {money(r.operating[1])}
                  <span className="block text-xs text-slate-500">{range(r.operating)}</span>
                  {base.length > 1 && <InlineBar value={r.operating[1]} max={maxO} />}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>{t("tbl.total")}</td>
              <td className={num}>
                {money(c[1])}
                <span className="block text-xs font-normal text-slate-500">{range(c)}</span>
              </td>
              <td className={num}>
                {money(o[1])}
                <span className="block text-xs font-normal text-slate-500">{range(o)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

type LineKey = "name" | "mode" | "km" | "fleet" | "c" | "o";

function ByLine({
  est,
  money,
  range,
}: {
  est: Estimate;
  money: (v: number) => string;
  range: (t: Triple) => string;
}) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const [sort, setSort] = useState<Sort<LineKey>>(null);
  const totals = perLine(est);
  const unassigned = [...totals.entries()].filter(([id]) => id.startsWith(":"));
  if (!est.lines.length && !unassigned.length) return null;
  const zero: Triple = [0, 0, 0];
  const base = [
    ...est.lines.map((l) => ({
      id: l.id,
      name: l.name,
      mode: l.mode,
      color: l.color as string | null,
      km: l.lengthKm as number | null,
      fleet: l.fleet,
      c: totals.get(l.id)?.construction ?? null,
      o: totals.get(l.id)?.operating ?? null,
    })),
    ...unassigned.map(([id, x]) => ({
      id,
      name: t("cost.unassigned"),
      mode: id.slice(1),
      color: null,
      km: null,
      fleet: 0,
      c: x.construction,
      o: x.operating,
    })),
  ];
  const rows = sorted(base, sort, (r, k) =>
    k === "name"
      ? r.name
      : k === "mode"
        ? modeLabel(r.mode)
        : k === "km"
          ? (r.km ?? 0)
          : k === "fleet"
            ? r.fleet
            : ((k === "c" ? r.c : r.o) ?? zero)[1],
  );
  const maxC = Math.max(...base.map((r) => r.c?.[1] ?? 0));
  const maxO = Math.max(...base.map((r) => r.o?.[1] ?? 0));
  const cell = (t: Triple | null, max: number) =>
    t ? (
      <>
        {money(t[1])}
        <span className="block text-xs text-slate-500">{range(t)}</span>
        {base.length > 1 && <InlineBar value={t[1]} max={max} />}
      </>
    ) : (
      "–"
    );
  return (
    <section className={card} aria-labelledby="cost-by-line">
      <h3 id="cost-by-line" className="caps m-0">
        {t("tbl.perLine")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("cost.perLineNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <SortHeader label={t("tbl.line")} k="name" sort={sort} setSort={setSort} />
              <SortHeader label={t("tbl.mode")} k="mode" sort={sort} setSort={setSort} />
              <SortHeader label={t("tbl.length")} k="km" sort={sort} setSort={setSort} right />
              <SortHeader label={t("tbl.fleet")} k="fleet" sort={sort} setSort={setSort} right />
              <SortHeader label={t("tbl.construction")} k="c" sort={sort} setSort={setSort} right />
              <SortHeader label={t("tbl.operatingYear")} k="o" sort={sort} setSort={setSort} right />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-slate-100 ${r.color ? "" : "text-slate-600"}`}>
                <td className={td}>
                  {r.color && (
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: r.color }}
                      aria-hidden="true"
                    />
                  )}
                  {r.name}
                </td>
                <td className={td}>{modeLabel(r.mode)}</td>
                <td className={num}>{r.km === null ? "" : t("tbl.u.km", { v: fmtQty(r.km) })}</td>
                <td className={num}>{r.color ? r.fleet || "–" : ""}</td>
                <td className={num}>{cell(r.c, maxC)}</td>
                <td className={num}>{cell(r.o, maxO)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Purpose: a small chevron that turns when its group opens. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Breakdown({
  id,
  title,
  cats,
  est,
  money,
  chart,
}: {
  /** Element id of the heading (the same in every language). */
  id: string;
  title: string;
  cats: Category[];
  est: Estimate;
  money: (v: number) => string;
  chart?: ReactNode;
}) {
  const { t, tn } = useI18n();
  const modeLabel = useModeLabel();
  // Modes start open, item lists closed; "largest first" orders groups and items by the medium estimate.
  const [closedModes, setClosedModes] = useState<Set<string>>(new Set());
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [largest, setLargest] = useState(false);
  const modes = est.modes.filter((m) => est.items.some((x) => x.mode === m && cats.includes(x.category)));
  if (!modes.length) return null;
  const all = est.items.filter((x) => cats.includes(x.category));
  const total = sum(all.map((x) => x.amount));
  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };
  const catKeys = modes.flatMap((m) =>
    cats.filter((c) => all.some((x) => x.mode === m && x.category === c)).map((c) => `${m}|${c}`),
  );
  const allOpen = closedModes.size === 0 && catKeys.every((k) => openCats.has(k));
  const orderedModes = largest
    ? [...modes].sort(
        (a, b) =>
          sum(all.filter((x) => x.mode === b).map((x) => x.amount))[1] -
          sum(all.filter((x) => x.mode === a).map((x) => x.amount))[1],
      )
    : modes;
  return (
    <section className={card} aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="caps m-0">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label={t("cost.order", { title })}>
            <button type="button" aria-pressed={!largest} onClick={() => setLargest(false)}>
              {t("cost.usualOrder")}
            </button>
            <button type="button" aria-pressed={largest} onClick={() => setLargest(true)}>
              {t("cost.largestFirst")}
            </button>
          </div>
          <button
            type="button"
            className="btn min-h-9 text-sm"
            onClick={() => {
              if (allOpen) {
                setClosedModes(new Set());
                setOpenCats(new Set());
              } else {
                setClosedModes(new Set());
                setOpenCats(new Set(catKeys));
              }
            }}
          >
            {allOpen ? t("cost.collapseAll") : t("cost.expandAll")}
          </button>
        </div>
      </div>
      {chart && <div className="mt-4">{chart}</div>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("cost.item")}</th>
              <th className={`${th} text-right`}>{t("tbl.quantity")}</th>
              <th className={`${th} text-right`}>{t("cost.unitCost")}</th>
              <th className={`${th} text-right`}>{t("cost.low")}</th>
              <th className={`${th} text-right`}>{t("cost.medium")}</th>
              <th className={`${th} text-right`}>{t("cost.high")}</th>
            </tr>
          </thead>
          {orderedModes.map((m) => {
            const xs = all.filter((x) => x.mode === m);
            const sub = sum(xs.map((x) => x.amount));
            const open = !closedModes.has(m);
            const groups = cats
              .map((c) => ({ c, ys: xs.filter((x) => x.category === c) }))
              .filter((g) => g.ys.length)
              .map((g) => ({ ...g, s: sum(g.ys.map((x) => x.amount)) }));
            if (largest) groups.sort((a, b) => b.s[1] - a.s[1]);
            return (
              <tbody key={m}>
                <tr className="bg-slate-50">
                  <th colSpan={3} className={`${th} text-slate-900`}>
                    <button
                      type="button"
                      aria-expanded={open}
                      className="flex items-center gap-1.5 font-semibold"
                      onClick={() => toggle(closedModes, m, setClosedModes)}
                    >
                      <Chevron open={open} />
                      {modeLabel(m)}
                      <span className="font-normal text-slate-500">
                        · {count(tn, "cost.groups", groups.length)}
                      </span>
                    </button>
                  </th>
                  <td className={`${num} font-semibold`}>{money(sub[0])}</td>
                  <td className={`${num} font-semibold`}>{money(sub[1])}</td>
                  <td className={`${num} font-semibold`}>{money(sub[2])}</td>
                </tr>
                {open &&
                  groups.flatMap(({ c, ys, s }) => {
                    const key = `${m}|${c}`;
                    const catOpen = openCats.has(key);
                    const items = largest ? [...ys].sort((a, b) => b.amount[1] - a.amount[1]) : ys;
                    return [
                      <tr key={c} className="border-b border-slate-100">
                        <td className={td} colSpan={3}>
                          <button
                            type="button"
                            aria-expanded={catOpen}
                            className="flex items-center gap-1.5 pl-2 text-left font-medium"
                            onClick={() => toggle(openCats, key, setOpenCats)}
                          >
                            <Chevron open={catOpen} />
                            {t(CATEGORY_LABEL[c])}
                            <span className="font-normal text-slate-500">
                              · {count(tn, "cost.items", ys.length)}
                            </span>
                          </button>
                        </td>
                        <td className={num}>{money(s[0])}</td>
                        <td className={`${num} font-medium`}>{money(s[1])}</td>
                        <td className={num}>{money(s[2])}</td>
                      </tr>,
                      ...(catOpen
                        ? items.map((x, i) => <ItemRow key={`${c}-${i}`} x={x} money={money} est={est} />)
                        : []),
                    ];
                  })}
              </tbody>
            );
          })}
          <tfoot>
            <tr className="border-t border-slate-300 font-semibold">
              <td className={td}>{t("tbl.total")}</td>
              <td className={num} />
              <td className={num} />
              <td className={num}>{money(total[0])}</td>
              <td className={num}>{money(total[1])}</td>
              <td className={num}>{money(total[2])}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function ItemRow({ x, money, est }: { x: CostItem; money: (v: number) => string; est: Estimate }) {
  const line = x.line ? est.lines.find((l) => l.id === x.line)?.name : null;
  return (
    <tr className="border-b border-slate-100 text-slate-600">
      <td className={`${td} pl-10`}>
        {x.label}
        {line && <span className="text-slate-400"> · {line}</span>}
      </td>
      <td className={num}>{x.unit ? `${fmtQty(x.quantity)} ${x.unit}` : ""}</td>
      <td className={num}>{x.unit ? money(x.rate[1]) : ""}</td>
      <td className={num}>{money(x.amount[0])}</td>
      <td className={num}>{money(x.amount[1])}</td>
      <td className={num}>{money(x.amount[2])}</td>
    </tr>
  );
}

/** Purpose: a number field that commits on blur or Enter; empty returns to the default. */
export function NumberField({
  label,
  value,
  placeholder,
  editable,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  placeholder: string;
  editable: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    setText(null);
    if (raw.trim() === "") return onCommit(null);
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) onCommit(n);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      readOnly={!editable}
      value={text ?? (value === undefined ? "" : String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
      }}
      className={`w-24 rounded border border-slate-300 px-1.5 py-1 text-right ${editable ? "" : "bg-slate-100"}`}
    />
  );
}

const sig = (v: number) => String(Number(v.toPrecision(4)));

function PricesSection({
  econ,
  error,
  prices,
  countries,
  code,
  chosen,
  editable,
  onCountry,
  prefs,
  setPref,
}: {
  econ: CountryEconomy | null;
  error: string | null;
  prices: Prices;
  countries: WbCountry[];
  code: string | null;
  chosen: boolean;
  editable: boolean;
  onCountry: (iso3: string | null) => void;
  prefs: Record<string, number> | undefined;
  setPref: (id: string, v: number | null) => void;
}) {
  const own = (id: string) => (typeof prefs?.[id] === "number" ? prefs[id] : undefined);
  const iso3 = econ?.country.iso3 ?? code ?? "";
  const { t, language } = useI18n();
  const cur = prices.currency ?? t("cost.localCurrency");
  return (
    <section className={card} aria-labelledby="cost-prices">
      <h3 id="cost-prices" className="caps m-0">
        {t("cost.prices")}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{t("cost.pricesIntro", { year: BASE_YEAR })}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="cost-country" className="text-slate-600">
          {t("cost.country")}
        </label>
        <select
          id="cost-country"
          value={iso3}
          disabled={!editable}
          onChange={(e) => onCountry(e.target.value || null)}
          className="max-w-full rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{t("cost.fromLocation")}</option>
          {econ && !countries.some((c) => c.iso3 === econ.country.iso3) && (
            <option value={econ.country.iso3}>{countryName(econ.country, language)}</option>
          )}
          {countries
            .map((c) => ({ iso3: c.iso3, name: countryName(c, language) }))
            .sort((a, b) => a.name.localeCompare(b.name, language))
            .map((c) => (
              <option key={c.iso3} value={c.iso3}>
                {c.name}
              </option>
            ))}
        </select>
        {!chosen && econ && <span className="text-xs text-slate-500">{t("cost.foundAtLocation")}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          {t("cost.wbError", { error, year: BASE_YEAR })}
        </p>
      )}
      {!econ && !error && !code && (
        <p className="mt-2 text-sm text-slate-600">{t("cost.noPlace", { year: BASE_YEAR })}</p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("cost.value")}</th>
              <th className={`${th} text-right`}>{t("cost.worldBank")}</th>
              <th className={`${th} text-right`}>{t("tbl.thisProject")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className={td}>{t("cost.pppRow", { currency: cur })}</td>
              <td className={num}>{econ?.ppp ? `${sig(econ.ppp.value)} (${econ.ppp.year})` : "–"}</td>
              <td className={num}>
                <NumberField
                  label={t("cost.pppLabel")}
                  value={own(PRICE_PREFS.ppp)}
                  placeholder={sig(prices.ppp)}
                  editable={editable}
                  onCommit={(v) => setPref(PRICE_PREFS.ppp, v || null)}
                />
              </td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className={td}>{t("cost.fxRow", { currency: cur })}</td>
              <td className={num}>{econ?.fx ? `${sig(econ.fx.value)} (${econ.fx.year})` : "–"}</td>
              <td className={num}>
                <NumberField
                  label={t("cost.fxLabel")}
                  value={own(PRICE_PREFS.fx)}
                  placeholder={sig(prices.fx)}
                  editable={editable}
                  onCommit={(v) => setPref(PRICE_PREFS.fx, v || null)}
                />
              </td>
            </tr>
            <tr>
              <td className={td}>
                {econ?.usDeflator.latest
                  ? t("cost.riseRowTo", { year: BASE_YEAR, latest: econ.usDeflator.latest.year })
                  : t("cost.riseRow", { year: BASE_YEAR })}
              </td>
              <td className={num}>
                {econ?.usDeflator.base && econ.usDeflator.latest
                  ? sig(econ.usDeflator.latest.value / econ.usDeflator.base.value)
                  : "–"}
              </td>
              <td className={num}>
                <NumberField
                  label={t("cost.riseLabel")}
                  value={own(PRICE_PREFS.escalation)}
                  placeholder={sig(prices.escalation)}
                  editable={editable}
                  onCommit={(v) => setPref(PRICE_PREFS.escalation, v || null)}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {withNodes(t("cost.source"), {
          link: (
            <a href="https://data.worldbank.org/" target="_blank" rel="noreferrer">
              {t("cost.wdi")}
            </a>
          ),
        })}
      </p>
    </section>
  );
}

/** The unit costs the estimate uses, editable per mode. */
/** Purpose: a plugin parameter's values with the project's own central value, low and high in proportion. */
function scaled(lib: Triple, own: number | undefined): Triple {
  if (own === undefined) return lib;
  return lib[1] !== 0 ? (lib.map((v) => (v * own) / lib[1]) as Triple) : [own, own, own];
}

function UnitCosts({
  est,
  prefs,
  editable,
  setPref,
}: {
  est: Estimate;
  prefs: Record<string, number> | undefined;
  editable: boolean;
  setPref: (id: string, v: number | null) => void;
}) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const used = new Map<string, { key: string; mode: string; library?: CostItem["library"] }>();
  for (const x of est.items)
    if (x.param) {
      const shared = x.param.endsWith("_share");
      const mode = shared ? "*" : x.mode;
      used.set(`${x.param}|${mode}`, { key: x.param, mode, library: x.library });
    }
  used.set("cost.days_per_year|*", { key: "cost.days_per_year", mode: "*" });
  // The spare vehicles of each mode are set in Tables → Timetables only.
  used.delete(`${SPARE_PREF}|*`);
  for (const m of est.modes) used.delete(`${SPARE_PREF}|${m}`);
  const rows = [...used.values()].sort(
    (a, b) => a.key.localeCompare(b.key) || modeLabel(a.mode).localeCompare(modeLabel(b.mode)),
  );
  return (
    <section className={card} aria-labelledby="cost-units">
      <h3 id="cost-units" className="caps m-0">
        {t("cost.unitsUsed")}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{t("cost.unitsIntro", { year: BASE_YEAR })}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("cost.unitCost")}</th>
              <th className={th}>{t("tbl.mode")}</th>
              <th className={`${th} text-right`}>{t("cost.library")}</th>
              <th className={`${th} text-right`}>{t("tbl.thisProject")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, mode, library }) => {
              // A plugin's parameter (cable cars) brings its own name, unit and values.
              const p = PARAMS[key] ?? library;
              if (!p) return null;
              const lib = PARAMS[key] ? libraryValue(key, mode) : library!.values;
              const id = prefId(key, mode);
              const ownV = prefs?.[id];
              const now = PARAMS[key] ? paramValue(key, mode, prefs) : scaled(lib, ownV);
              const label = paramLabel(t, key, p.label);
              return (
                <tr key={`${key}|${mode}`} className="border-b border-slate-100">
                  <td className={td}>
                    {label}
                    <span className="block text-xs text-slate-500">{paramUnit(t, p.unit)}</span>
                  </td>
                  <td className={td}>{mode === "*" ? t("tbl.all") : modeLabel(mode)}</td>
                  <td className={num}>
                    {lib.map(sig).join(" – ")}
                    {ownV !== undefined && (
                      <span className="block text-xs text-blue-700">
                        {t("cost.now", { values: now.map(sig).join(" – ") })}
                      </span>
                    )}
                  </td>
                  <td className={num}>
                    <NumberField
                      label={`${label}, ${mode === "*" ? t("tbl.allModes") : modeLabel(mode)}`}
                      value={ownV}
                      placeholder={sig(lib[1])}
                      editable={editable}
                      onCommit={(v) => setPref(id, v)}
                    />
                    {outsideLibraryRange(ownV, lib) && (
                      <span role="note" className="mt-1 block text-xs font-medium text-amber-800">
                        ⚠ {t("cost.outsideRange", { low: sig(lib[0]), high: sig(lib[2]) })}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("cost.unitsSource")}</p>
    </section>
  );
}

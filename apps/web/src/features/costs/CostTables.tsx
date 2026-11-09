import { useEffect, useMemo, useState } from "react";
import { loadRailEngine } from "../railways/engine";
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
} from "./economy";
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
import { libraryValue, PARAMS, paramValue, prefId, type Triple } from "./params";

/** Cost tables settings (drawing kind `costs`): the country the planner chose for prices. */
export interface CostsDoc {
  country?: string | null;
}

interface Props {
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
  costs: CostsDoc | null;
  onCosts?: (doc: CostsDoc) => void;
  /** Tests inject these. */
  loadRail?: RailEngineLoader;
  api?: EconomyApi;
}

const DEFAULT_API = economyApi();
const BASE_YEAR = libraryValue("cost.price_base_year", "*")[1];

/** Purpose: a mode's name for the tables. */
export function modeLabel(mode: string): string {
  return (
    RAIL_MODES.find((m) => m.id === mode)?.label ??
    STREET_MODES[mode as keyof typeof STREET_MODES]?.label ??
    mode.replace(/_/g, " ")
  );
}

/** Purpose: money in a short form, such as "€1.2 bn" or "1.2 bn local currency". */
export function fmtMoney(v: number, currency: string | null): string {
  const opts: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: v >= 1e3 ? 1 : 0 };
  if (!currency) return `${new Intl.NumberFormat("en", opts).format(v)} LCU`;
  return new Intl.NumberFormat("en", { ...opts, style: "currency", currency }).format(v);
}

/** Purpose: a quantity with sensible decimals. */
function fmtQty(q: number): string {
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
  preferences,
  onPreferences,
  costs,
  onCosts,
  loadRail = loadRailEngine,
  api = DEFAULT_API,
}: Props) {
  const prefs = preferences?.values;
  const [rail, setRail] = useState<{ view: RailView; reports: Record<string, LineReport> } | null>(null);
  const [railError, setRailError] = useState<string | null>(null);
  const [placeCode, setPlaceCode] = useState<string | null>(null);
  const [econ, setEcon] = useState<CountryEconomy | null>(null);
  const [econError, setEconError] = useState<string | null>(null);
  const [countries, setCountries] = useState<WbCountry[]>([]);
  const [usd, setUsd] = useState(false);

  // The railway as the engine builds it, and its service lines as published.
  const railJson = JSON.stringify(railway);
  useEffect(() => {
    let live = true;
    setRailError(null);
    if (!railway || !railway.tracks.length) {
      setRail(null);
      return;
    }
    (async () => {
      const engine = await loadRail();
      try {
        const view = engine.build(railway, null);
        const reports: Record<string, LineReport> = {};
        const lines = engineLines(railway);
        if (lines.length)
          try {
            for (const r of engine.publishLines(lines, "weekday").lines) reports[r.id] = r;
          } catch {
            // Lines that cannot be published are listed in the notes.
          }
        if (live) setRail({ view, reports });
      } finally {
        engine.dispose();
      }
    })().catch((e: unknown) => live && setRailError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [railJson, loadRail]);

  // Where the project is: the railway's origin, else the first street line's first point.
  const place = railway?.origin ?? streetLines?.lines[0]?.points[0]?.lonlat ?? null;
  const placeKey = place ? `${place[0].toFixed(2)},${place[1].toFixed(2)}` : null;
  useEffect(() => {
    if (costs?.country || !place) return;
    let live = true;
    api
      .countryAt(place)
      .then((c) => live && setPlaceCode(c.iso3 ?? c.iso2))
      .catch((e: unknown) => live && setEconError(e instanceof Error ? e.message : String(e)));
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
        setEconError(e instanceof Error ? e.message : String(e));
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

  const prices = useMemo(() => pricesFrom(econ, prefs), [econ, prefs]);
  const est = useMemo(
    () =>
      estimate({
        railway,
        view: rail?.view ?? null,
        reports: rail?.reports ?? {},
        streetLines: streetLines?.lines ?? [],
        prefs,
        prices,
      }),
    [railway, rail, streetLines, prefs, prices],
  );
  const shownCurrency = usd ? "USD" : prices.currency;
  const k = usd ? 1 / prices.fx : 1;
  const money = (v: number) => fmtMoney(v * k, shownCurrency);
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
          Construction and operating costs
        </h2>
        <p className="mt-1 max-w-3xl text-slate-600">
          Educated estimates to put the project in perspective: quantities from the railway design and the
          street lines, unit costs from the assumption library (low, medium, high), converted to{" "}
          {econ ? econ.country.name : "the project's country"} and today's prices with World Bank data. Change
          any unit cost or the conversion below.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="seg" role="tablist" aria-label="Currency">
            <button type="button" role="tab" aria-selected={!usd} onClick={() => setUsd(false)}>
              {prices.currency ?? "Local currency"}
            </button>
            <button type="button" role="tab" aria-selected={usd} onClick={() => setUsd(true)}>
              US$
            </button>
          </div>
          <span className="text-xs text-slate-500">
            {prices.year ? `${prices.year} prices` : `${BASE_YEAR} prices`}
            {usd && prices.currency !== "USD" ? " at the market exchange rate" : ""}
          </span>
        </div>
        {railError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            The railway design could not be read: {railError}
          </p>
        )}
        {empty ? (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
            Nothing to cost yet. Draw a railway or a street line in the Create tab.
          </p>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Tile
                title="Construction"
                value={money(construction[1])}
                sub={`low to high ${range(construction)}`}
              />
              <Tile
                title="Operating, a year"
                value={money(operating[1])}
                sub={`low to high ${range(operating)}`}
              />
            </div>
            <ByMode est={est} money={money} range={range} />
            <ByLine est={est} money={money} range={range} />
            <Breakdown
              title="Construction by infrastructure type"
              cats={CONSTRUCTION}
              est={est}
              money={money}
            />
            <Breakdown title="Operating cost a year" cats={OPERATING} est={est} money={money} />
            {est.notes.length > 0 && (
              <ul className="mt-4 list-disc pl-5 text-sm text-slate-600">
                {est.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <PricesSection
          econ={econ}
          error={econError}
          prices={prices}
          countries={countries}
          code={code}
          chosen={!!costs?.country}
          editable={editable && !!onCosts}
          onCountry={(c) => onCosts?.({ ...(costs ?? {}), country: c })}
          prefs={prefs}
          setPref={setPref}
        />
        {!empty && <UnitCosts est={est} prefs={prefs} editable={editable} setPref={setPref} />}
      </section>
    </div>
  );
}

function Tile({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="caps m-0">{title}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

const card = "mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6";
const th = "px-2 py-1.5 text-left font-medium text-slate-600";
const td = "px-2 py-1.5 align-top";
const num = "px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap";

function ByMode({
  est,
  money,
  range,
}: {
  est: Estimate;
  money: (v: number) => string;
  range: (t: Triple) => string;
}) {
  const rows = est.modes.map((m) => {
    const xs = est.items.filter((x) => x.mode === m);
    return {
      mode: m,
      c: sum(xs.filter((x) => isConstruction(x.category)).map((x) => x.amount)),
      o: sum(xs.filter((x) => !isConstruction(x.category)).map((x) => x.amount)),
    };
  });
  const c = sum(rows.map((r) => r.c));
  const o = sum(rows.map((r) => r.o));
  return (
    <section className={card} aria-labelledby="cost-by-mode">
      <h3 id="cost-by-mode" className="caps m-0">
        Per mode
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Mode</th>
              <th className={`${th} text-right`}>Construction</th>
              <th className={`${th} text-right`}>Operating a year</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mode} className="border-b border-slate-100">
                <td className={td}>{modeLabel(r.mode)}</td>
                <td className={num}>
                  {money(r.c[1])}
                  <span className="block text-xs text-slate-500">{range(r.c)}</span>
                </td>
                <td className={num}>
                  {money(r.o[1])}
                  <span className="block text-xs text-slate-500">{range(r.o)}</span>
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>Total</td>
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

function ByLine({
  est,
  money,
  range,
}: {
  est: Estimate;
  money: (v: number) => string;
  range: (t: Triple) => string;
}) {
  const totals = perLine(est);
  const unassigned = [...totals.entries()].filter(([id]) => id.startsWith(":"));
  if (!est.lines.length && !unassigned.length) return null;
  return (
    <section className={card} aria-labelledby="cost-by-line">
      <h3 id="cost-by-line" className="caps m-0">
        Per line
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Rail lines that share track split its cost by their train-km. Construction includes the line's
        vehicles and depot places; operating covers the service, upkeep and overheads.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Line</th>
              <th className={th}>Mode</th>
              <th className={`${th} text-right`}>Length</th>
              <th className={`${th} text-right`}>Fleet</th>
              <th className={`${th} text-right`}>Construction</th>
              <th className={`${th} text-right`}>Operating a year</th>
            </tr>
          </thead>
          <tbody>
            {est.lines.map((l) => {
              const t = totals.get(l.id);
              return (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className={td}>
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: l.color }}
                      aria-hidden="true"
                    />
                    {l.name}
                  </td>
                  <td className={td}>{modeLabel(l.mode)}</td>
                  <td className={num}>{fmtQty(l.lengthKm)} km</td>
                  <td className={num}>{l.fleet || "–"}</td>
                  <td className={num}>
                    {t ? money(t.construction[1]) : "–"}
                    {t && <span className="block text-xs text-slate-500">{range(t.construction)}</span>}
                  </td>
                  <td className={num}>
                    {t ? money(t.operating[1]) : "–"}
                    {t && <span className="block text-xs text-slate-500">{range(t.operating)}</span>}
                  </td>
                </tr>
              );
            })}
            {unassigned.map(([id, t]) => (
              <tr key={id} className="border-b border-slate-100 text-slate-600">
                <td className={td}>Not used by a line yet</td>
                <td className={td}>{modeLabel(id.slice(1))}</td>
                <td className={num} />
                <td className={num} />
                <td className={num}>
                  {money(t.construction[1])}
                  <span className="block text-xs text-slate-500">{range(t.construction)}</span>
                </td>
                <td className={num}>
                  {money(t.operating[1])}
                  <span className="block text-xs text-slate-500">{range(t.operating)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Breakdown({
  title,
  cats,
  est,
  money,
}: {
  title: string;
  cats: Category[];
  est: Estimate;
  money: (v: number) => string;
}) {
  const id = `cost-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const modes = est.modes.filter((m) => est.items.some((x) => x.mode === m && cats.includes(x.category)));
  if (!modes.length) return null;
  const all = est.items.filter((x) => cats.includes(x.category));
  const total = sum(all.map((x) => x.amount));
  return (
    <section className={card} aria-labelledby={id}>
      <h3 id={id} className="caps m-0">
        {title}
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Item</th>
              <th className={`${th} text-right`}>Quantity</th>
              <th className={`${th} text-right`}>Unit cost</th>
              <th className={`${th} text-right`}>Low</th>
              <th className={`${th} text-right`}>Medium</th>
              <th className={`${th} text-right`}>High</th>
            </tr>
          </thead>
          {modes.map((m) => {
            const xs = all.filter((x) => x.mode === m);
            const sub = sum(xs.map((x) => x.amount));
            return (
              <tbody key={m}>
                <tr className="bg-slate-50">
                  <th colSpan={6} className={`${th} text-slate-900`}>
                    {modeLabel(m)}
                  </th>
                </tr>
                {cats.flatMap((c) => {
                  const ys = xs.filter((x) => x.category === c);
                  if (!ys.length) return [];
                  const s = sum(ys.map((x) => x.amount));
                  return [
                    <tr key={c} className="border-b border-slate-100">
                      <td className={`${td} font-medium`}>{CATEGORY_LABEL[c]}</td>
                      <td className={num} />
                      <td className={num} />
                      <td className={num}>{money(s[0])}</td>
                      <td className={`${num} font-medium`}>{money(s[1])}</td>
                      <td className={num}>{money(s[2])}</td>
                    </tr>,
                    ...ys.map((x, i) => <ItemRow key={`${c}-${i}`} x={x} money={money} est={est} />),
                  ];
                })}
                <tr className="border-b border-slate-300 font-semibold">
                  <td className={td}>{modeLabel(m)} total</td>
                  <td className={num} />
                  <td className={num} />
                  <td className={num}>{money(sub[0])}</td>
                  <td className={num}>{money(sub[1])}</td>
                  <td className={num}>{money(sub[2])}</td>
                </tr>
              </tbody>
            );
          })}
          <tfoot>
            <tr className="font-semibold">
              <td className={td}>Total</td>
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
      <td className={`${td} pl-5`}>
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
function NumberField({
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
  const cur = prices.currency ?? "local currency";
  return (
    <section className={card} aria-labelledby="cost-prices">
      <h3 id="cost-prices" className="caps m-0">
        Country and prices
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Unit costs are in {BASE_YEAR} international dollars (purchasing power parity), as the Transit Costs
        Project reports them; vehicles are in {BASE_YEAR} US dollars. They are scaled to today with the US GDP
        deflator and converted with the country's PPP factor, or its exchange rate for vehicles.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="cost-country" className="text-slate-600">
          Country
        </label>
        <select
          id="cost-country"
          value={iso3}
          disabled={!editable}
          onChange={(e) => onCountry(e.target.value || null)}
          className="max-w-full rounded border border-slate-300 px-2 py-1"
        >
          <option value="">From the project's location</option>
          {econ && !countries.some((c) => c.iso3 === econ.country.iso3) && (
            <option value={econ.country.iso3}>{econ.country.name}</option>
          )}
          {countries.map((c) => (
            <option key={c.iso3} value={c.iso3}>
              {c.name}
            </option>
          ))}
        </select>
        {!chosen && econ && <span className="text-xs text-slate-500">found at the project's location</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          World Bank data could not be loaded ({error}). The tables use {BASE_YEAR} international dollars
          until it loads or you enter the values below.
        </p>
      )}
      {!econ && !error && !code && (
        <p className="mt-2 text-sm text-slate-600">
          Draw something on the map or choose a country to convert the costs; until then they are in{" "}
          {BASE_YEAR} international dollars.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Value</th>
              <th className={`${th} text-right`}>World Bank</th>
              <th className={`${th} text-right`}>This project</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className={td}>{cur} per international $ (PPP, construction and operation)</td>
              <td className={num}>{econ?.ppp ? `${sig(econ.ppp.value)} (${econ.ppp.year})` : "–"}</td>
              <td className={num}>
                <NumberField
                  label="PPP conversion factor"
                  value={own(PRICE_PREFS.ppp)}
                  placeholder={sig(prices.ppp)}
                  editable={editable}
                  onCommit={(v) => setPref(PRICE_PREFS.ppp, v || null)}
                />
              </td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className={td}>{cur} per US$ (exchange rate, vehicles)</td>
              <td className={num}>{econ?.fx ? `${sig(econ.fx.value)} (${econ.fx.year})` : "–"}</td>
              <td className={num}>
                <NumberField
                  label="Exchange rate"
                  value={own(PRICE_PREFS.fx)}
                  placeholder={sig(prices.fx)}
                  editable={editable}
                  onCommit={(v) => setPref(PRICE_PREFS.fx, v || null)}
                />
              </td>
            </tr>
            <tr>
              <td className={td}>
                Price rise since {BASE_YEAR} (factor, US GDP deflator
                {econ?.usDeflator.latest ? ` to ${econ.usDeflator.latest.year}` : ""})
              </td>
              <td className={num}>
                {econ?.usDeflator.base && econ.usDeflator.latest
                  ? sig(econ.usDeflator.latest.value / econ.usDeflator.base.value)
                  : "–"}
              </td>
              <td className={num}>
                <NumberField
                  label="Price rise factor"
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
        Source:{" "}
        <a href="https://data.worldbank.org/" target="_blank" rel="noreferrer">
          World Bank World Development Indicators
        </a>{" "}
        (PA.NUS.PPP, PA.NUS.FCRF, NY.GDP.DEFL.ZS), CC BY 4.0. Leave a field empty to use the World Bank's
        value.
      </p>
    </section>
  );
}

/** The unit costs the estimate uses, editable per mode. */
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
  const used = new Map<string, { key: string; mode: string }>();
  for (const x of est.items)
    if (x.param) {
      const shared = x.param.endsWith("_share");
      const mode = shared ? "*" : x.mode;
      used.set(`${x.param}|${mode}`, { key: x.param, mode });
    }
  used.set("cost.days_per_year|*", { key: "cost.days_per_year", mode: "*" });
  for (const m of est.modes) {
    used.set(`mode.spare_share|${m}`, { key: "mode.spare_share", mode: m });
    if (!RAIL_MODES.some((r) => r.id === m))
      used.set(`cost.service_hours_per_day|${m}`, { key: "cost.service_hours_per_day", mode: m });
  }
  const rows = [...used.values()].sort(
    (a, b) => a.key.localeCompare(b.key) || modeLabel(a.mode).localeCompare(modeLabel(b.mode)),
  );
  return (
    <section className={card} aria-labelledby="cost-units">
      <h3 id="cost-units" className="caps m-0">
        Unit costs used
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        The assumption library's low, medium and high values, in the units shown ({BASE_YEAR} prices before
        conversion). Enter a medium value to change it for this project; low and high move with it. Leave the
        field empty to return to the library's value.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Unit cost</th>
              <th className={th}>Mode</th>
              <th className={`${th} text-right`}>Library (low – medium – high)</th>
              <th className={`${th} text-right`}>This project</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, mode }) => {
              const p = PARAMS[key];
              if (!p) return null;
              const lib = libraryValue(key, mode);
              const id = prefId(key, mode);
              const ownV = prefs?.[id];
              const now = paramValue(key, mode, prefs);
              return (
                <tr key={`${key}|${mode}`} className="border-b border-slate-100">
                  <td className={td}>
                    {p.label}
                    <span className="block text-xs text-slate-500">{p.unit}</span>
                  </td>
                  <td className={td}>{mode === "*" ? "All" : modeLabel(mode)}</td>
                  <td className={num}>
                    {lib.map(sig).join(" – ")}
                    {ownV !== undefined && (
                      <span className="block text-xs text-blue-700">now {now.map(sig).join(" – ")}</span>
                    )}
                  </td>
                  <td className={num}>
                    <NumberField
                      label={`${p.label}, ${mode === "*" ? "all modes" : modeLabel(mode)}`}
                      value={ownV}
                      placeholder={sig(lib[1])}
                      editable={editable}
                      onCommit={(v) => setPref(id, v)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Sources and reasoning for every value: assumptions/parameters/costs.yaml in the MobSimLab repository.
      </p>
    </section>
  );
}

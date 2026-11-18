import { useEffect, useMemo } from "react";
import type { Estimate as BenefitEstimate } from "../benefits/model";
import { card, fmtMoney, modeLabel, num, td, th, Tile } from "../costs/CostTables";
import type { PluginLineInput } from "../journey-planner/network";
import type { Network } from "../railways/types";
import { EMPTY_SCHEMATIC, type SchematicDoc } from "../schematic/common";
import { defaultOrigin, layout } from "../schematic/layout";
import { schematicNetwork } from "../schematic/lines";
import type { StreetLinesDoc } from "../street-lines/saved";
import type { Triple } from "../benefits/params";
import { TablePart } from "../tables/sections";
import {
  FARE_PARAMS,
  type FareEstimate,
  fareEstimate,
  type FareInput,
  type FaresDoc,
  type FareStructure,
  fareValue,
  GROUPS,
  libraryValue,
  lineTrips,
  MONEY,
  POLICY,
  STRUCTURE_KEYS,
  STRUCTURE_LABEL,
  STRUCTURES,
  YEARS,
} from "./model";

interface Props {
  /** The benefit tables' estimate: boardings a year per line, and per station for spreading trips. */
  benefits: BenefitEstimate | null;
  railway: Network | null;
  streetLines: StreetLinesDoc | null;
  pluginLines: readonly PluginLineInput[];
  /** The Schematic tab's edits: station positions and the tariff zones. */
  schematic: SchematicDoc | null;
  /** The project's preference values: how near stops must be to be one station (library's when absent). */
  prefs?: Record<string, number>;
  /** The planner's own weekday boardings by station or stop name (benefit tables). */
  boardings: Record<string, number> | undefined;
  /**
   * From the cost tables: the currency money is shown in, and its units per 2023 international dollar
   * (PPP factor × price escalation). Null until the cost tables have priced the project.
   */
  prices: { currency: string | null; perIntl: number } | null;
  doc: FaresDoc | null;
  onDoc?: (doc: FaresDoc) => void;
  draws?: number;
  /** Called with the model's input whenever it changes (null until it can price the lines), for the appraisal. */
  onInput?: (input: FareInput | null) => void;
}

const compact = (v: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: v >= 1e3 ? 1 : 0 }).format(v);
const sig = (v: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(v);

/** Purpose: a fare with cents (or the currency's minor unit). */
export function fmtFare(v: number, currency: string | null): string {
  if (!currency) return `${v.toFixed(2)} LCU`;
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}

/** Purpose: the years the year-by-year table shows. */
const SHOWN_YEARS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30];

/**
 * The fare revenue table of the Tables tab (ADR-0044): boardings a year from the ridership estimate, the
 * fare structure the project chose (flat, zonal with the Schematic tab's tariff zones, or distance-based),
 * tickets and passes, discount groups, the fare's effect on ridership, yearly changes, fare evasion and the
 * cost of collecting fares, per line, per mode and in total, and year by year. Every value can be changed.
 * Side effects: none beyond `onDoc`.
 */
export function FareTables({
  benefits,
  railway,
  streetLines,
  pluginLines,
  schematic,
  prefs,
  boardings,
  prices,
  doc,
  onDoc,
  draws,
  onInput,
}: Props) {
  const structure: FareStructure = doc?.structure ?? "flat";
  const own = doc?.values;
  const sd = schematic ?? EMPTY_SCHEMATIC;
  const pluginJson = JSON.stringify(pluginLines);
  const net = useMemo(
    () => schematicNetwork(railway, streetLines, JSON.parse(pluginJson) as PluginLineInput[], prefs),
    [railway, streetLines, pluginJson, prefs],
  );
  const [ox, oy] = sd.origin ?? defaultOrigin(net);
  const straighten = sd.straighten !== false;
  const zones = (sd.areas ?? []).filter((a) => a.kind === "zone" && a.points.length >= 3);
  // The network map's layout places the stations in the tariff zones; it takes seconds on a network with
  // hundreds of stops (bug 21), so it runs only when there are zones.
  const hasZones = zones.length > 0;
  const pos = useMemo(
    () => (hasZones ? layout(net, [ox, oy], sd.pins, straighten).pos : []),
    [hasZones, net, ox, oy, sd.pins, straighten],
  );
  const trips = useMemo(
    () => lineTrips(net, pos, sd.areas ?? [], benefits?.stations ?? {}, boardings),
    [net, pos, sd.areas, benefits, boardings],
  );
  const input: FareInput | null = useMemo(() => {
    if (!benefits || !prices) return null;
    const lines = benefits.rows
      .filter((r) => r.scope === "line" && r.mode)
      .map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode!,
        color: r.color,
        annual: r.values.ridership_annual,
      }));
    return { structure, own, perIntl: prices.perIntl, lines, trips };
  }, [benefits, prices, structure, own, trips]);
  useEffect(() => {
    onInput?.(input && input.lines.length ? input : null);
  }, [input, onInput]);
  const est: FareEstimate | null = useMemo(
    () => (input && input.lines.length ? fareEstimate(input, YEARS, draws) : null),
    [input, draws],
  );

  const currency = prices?.currency ?? null;
  const money = (v: number) => fmtMoney(v, currency);
  const fare = (v: number) => fmtFare(v, currency);
  const editable = !!onDoc;
  const setDoc = (patch: Partial<FaresDoc>) => onDoc?.({ ...(doc ?? {}), ...patch });
  const setValue = (key: string, v: number | null) => {
    const values = { ...(own ?? {}) };
    if (v === null) delete values[key];
    else values[key] = v;
    setDoc({ values });
  };
  const total = est?.rows.find((r) => r.id === "total") ?? null;

  const status = !benefits
    ? "Waiting for the ridership estimate in the benefit tables above…"
    : !prices
      ? "Waiting for the cost tables to find the project's country and currency…"
      : null;

  return (
    <section aria-labelledby="fare-title" className="mt-10">
      <h2 id="fare-title" className="text-xl font-semibold tracking-tight">
        Fare revenue
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        Fares a year: the boardings of the ridership estimate times the average fare riders pay, after passes,
        discounts and the fare's effect on ridership, less fare evasion and the cost of collecting fares.
        Default fares follow the price level of the project's country (World Bank PPP factor). Low, medium and
        high are the 10th, 50th and 90th percentile over the ranges of the values that describe how people
        travel; the fares, pass price and discounts you set stay fixed.
      </p>
      <TablePart id="fares.settings">
        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Fare structure</span>
          <select
            className="input min-h-10"
            value={structure}
            disabled={!editable}
            onChange={(e) => setDoc({ structure: e.target.value as FareStructure })}
          >
            {STRUCTURES.map((s) => (
              <option key={s} value={s}>
                {STRUCTURE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {structure === "zonal" && (
          <p className={`mt-2 text-sm ${zones.length ? "text-slate-600" : "text-amber-700"}`}>
            {zones.length
              ? `${zones.length} tariff ${zones.length === 1 ? "zone" : "zones"} from the Schematic network map. A stop outside every zone counts as a zone of its own.`
              : "No tariff zones yet: draw them on the Schematic tab's network map. Until then every trip is in one zone."}
          </p>
        )}
      </TablePart>
      {status && (
        <p role="status" className="mt-4 text-sm text-slate-500">
          {status}
        </p>
      )}
      <TablePart id="fares.revenue">
        {benefits && prices && !est && (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
            No lines with a ridership estimate yet.
          </p>
        )}
        {est && total && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                title="Fare revenue, first year"
                value={money(total.net[1])}
                sub={`${money(total.net[0])} – ${money(total.net[2])}, after collection costs`}
              />
              <Tile
                title="Boardings a year"
                value={compact(total.riders[1])}
                sub={`after the fare's effect; ${compact(total.estimate[1])} in the ridership estimate`}
              />
              <Tile
                title="Average fare paid"
                value={fare(total.paid[1])}
                sub={`per boarding; single fare ${fare(total.single[1])}`}
              />
              <Tile
                title={`Fare revenue over ${YEARS} years`}
                value={money(est.years.reduce((s, y) => s + y.net[1], 0))}
                sub="medium, undiscounted, in today's prices"
              />
            </div>
            <PerLine est={est} structure={structure} money={money} fare={fare} />
            <ByYear est={est} money={money} />
          </>
        )}
      </TablePart>
      <TablePart id="fares.settings">
        <Settings
          structure={structure}
          own={own}
          perIntl={prices?.perIntl ?? 1}
          currency={currency}
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

function PerLine({
  est,
  structure,
  money,
  fare,
}: {
  est: FareEstimate;
  structure: FareStructure;
  money: (v: number) => string;
  fare: (v: number) => string;
}) {
  return (
    <section className={card} aria-labelledby="fare-lines">
      <h3 id="fare-lines" className="caps m-0">
        First year per line
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        A line's trips are spread between its stops by the boardings at both ends; trip length is along the
        line. Medium, with low – high below.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Line</th>
              <th className={`${th} text-right`}>Boardings a year</th>
              <th className={`${th} text-right`}>Average trip</th>
              <th className={`${th} text-right`}>Single fare</th>
              <th className={`${th} text-right`}>Paid per boarding</th>
              <th className={`${th} text-right`}>Fares paid</th>
              <th className={`${th} text-right`}>Collection cost</th>
              <th className={`${th} text-right`}>Fare revenue</th>
            </tr>
          </thead>
          <tbody>
            {est.rows.map((r) => (
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
                    {r.scope === "total"
                      ? "All lines"
                      : r.scope === "mode"
                        ? `All ${modeLabel(r.name)} lines`
                        : r.name}
                  </span>
                </td>
                <td className={num}>
                  <Range t={r.riders} f={compact} />
                </td>
                <td className={num}>
                  {r.avgKm === null ? "–" : `${sig(r.avgKm)} km`}
                  {structure === "zonal" && r.avgZones !== null && (
                    <span className="block text-xs text-slate-500">{sig(r.avgZones)} zones</span>
                  )}
                </td>
                <td className={num}>{fare(r.single[1])}</td>
                <td className={num}>
                  <Range t={r.paid} f={fare} />
                </td>
                <td className={num}>
                  <Range t={r.gross} f={money} />
                </td>
                <td className={num}>
                  <Range t={r.collection} f={money} />
                </td>
                <td className={num}>
                  <Range t={r.net} f={money} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ByYear({ est, money }: { est: FareEstimate; money: (v: number) => string }) {
  const years = est.years.filter((y) => SHOWN_YEARS.includes(y.year));
  return (
    <section className={card} aria-labelledby="fare-years">
      <h3 id="fare-years" className="caps m-0">
        Year by year, all lines
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Years after opening, in today's prices: ridership grows each year, fares change by the yearly change
        above inflation and ridership answers the change through the fare elasticity.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Year</th>
              <th className={`${th} text-right`}>Boardings</th>
              <th className={`${th} text-right`}>Fares paid</th>
              <th className={`${th} text-right`}>Collection cost</th>
              <th className={`${th} text-right`}>Fare revenue</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year} className="border-b border-slate-100">
                <td className={td}>{y.year}</td>
                <td className={num}>
                  <Range t={y.riders} f={compact} />
                </td>
                <td className={num}>
                  <Range t={y.gross} f={money} />
                </td>
                <td className={num}>
                  <Range t={y.collection} f={money} />
                </td>
                <td className={num}>
                  <Range t={y.net} f={money} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The settings, in the order a planner thinks about them. */
function settingGroups(structure: FareStructure): { title: string; keys: string[] }[] {
  return [
    { title: `Fares: ${STRUCTURE_LABEL[structure].toLowerCase()}`, keys: STRUCTURE_KEYS[structure] },
    {
      title: "Tickets and passes",
      keys: ["fare.pass.trip_share", "fare.pass.price_in_fares", "fare.pass.trips_per_month"],
    },
    {
      title: "Discount groups",
      keys: GROUPS.flatMap((g) => [`fare.concession.${g}.share`, `fare.concession.${g}.discount`]),
    },
    {
      title: "Ridership and later years",
      keys: ["fare.elasticity", "fare.ridership_growth", "fare.real_increase"],
    },
    { title: "Losses", keys: ["fare.evasion_share", "fare.collection_cost_share"] },
  ];
}

function Settings({
  structure,
  own,
  perIntl,
  currency,
  editable,
  setValue,
}: {
  structure: FareStructure;
  own: Record<string, number> | undefined;
  perIntl: number;
  currency: string | null;
  editable: boolean;
  setValue: (key: string, v: number | null) => void;
}) {
  return (
    <section className={card} aria-labelledby="fare-settings">
      <h3 id="fare-settings" className="caps m-0">
        Fare settings
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Setting a value replaces the medium; low and high move with it. Fares are in{" "}
        {currency ?? "local currency"}; the library's are converted from 2023 international dollars. Values
        marked “your choice” stay fixed in the low – high range. Sources and reasoning are in
        assumptions/DEFAULTS.md.
      </p>
      {settingGroups(structure).map((g) => (
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
              {g.keys.map((k) => (
                <SettingRow
                  key={k}
                  k={k}
                  own={own}
                  perIntl={perIntl}
                  currency={currency}
                  editable={editable}
                  setValue={setValue}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function SettingRow({
  k,
  own,
  perIntl,
  currency,
  editable,
  setValue,
}: {
  k: string;
  own: Record<string, number> | undefined;
  perIntl: number;
  currency: string | null;
  editable: boolean;
  setValue: (key: string, v: number | null) => void;
}) {
  const p = FARE_PARAMS[k]!;
  const money = MONEY.has(k);
  // Money is kept in 2023 international dollars and shown in the project's currency.
  const k1 = money ? perIntl : 1;
  const lib = libraryValue(k).map((v) => v * k1) as Triple;
  const used = fareValue(k, own)[1] * k1;
  const mine = own?.[k];
  const shown = mine === undefined ? undefined : Number((mine * k1).toPrecision(6));
  const f = (v: number) => (money ? fmtFare(v, currency) : sig(v));
  const unit = money
    ? p.unit.replace(/US\$/, currency ?? "local currency").replace(/ \(2023, PPP\)/, "")
    : p.unit;
  return (
    <tr className="border-b border-slate-100">
      <td className={td}>
        {p.label}
        <span className="block text-xs text-slate-500">
          {unit}
          {POLICY.has(k) ? " · your choice" : ""}
        </span>
      </td>
      <td className={num}>
        {f(lib[0])} – {f(lib[1])} – {f(lib[2])}
      </td>
      <td className={num}>
        {editable ? (
          <input
            key={`${k}:${shown ?? ""}:${k1}`}
            type="number"
            step="any"
            className="input w-28 text-right"
            aria-label={p.label}
            defaultValue={shown ?? ""}
            placeholder={money ? used.toFixed(2) : sig(used)}
            onBlur={(e) => {
              const v = e.target.value.trim();
              const n = Number(v);
              if (v === "") {
                if (mine !== undefined) setValue(k, null);
              } else if (Number.isFinite(n) && n !== shown) setValue(k, n / k1);
            }}
          />
        ) : (
          f(used)
        )}
      </td>
    </tr>
  );
}

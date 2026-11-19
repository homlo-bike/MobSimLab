import { useEffect, useMemo } from "react";
import { type Translate, useI18n } from "../../i18n/i18n";
import { paramLabel, paramUnit } from "../../i18n/params";
import type { Estimate as BenefitEstimate } from "../benefits/model";
import { card, fmtMoney, num, td, th, Tile } from "../costs/CostTables";
import type { PluginLineInput } from "../journey-planner/network";
import type { Network } from "../railways/types";
import { EMPTY_SCHEMATIC, type SchematicDoc, useModeLabel } from "../schematic/common";
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
  const { t, tn } = useI18n();
  const modeLabel = useModeLabel();
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

  const status = !benefits ? t("fare.waitBenefits") : !prices ? t("fare.waitCosts") : null;

  return (
    <section aria-labelledby="fare-title" className="mt-10">
      <h2 id="fare-title" className="text-xl font-semibold tracking-tight">
        {t("fare.title")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("fare.intro")}</p>
      <TablePart id="fares.settings">
        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("fare.structure")}</span>
          <select
            className="input min-h-10"
            value={structure}
            disabled={!editable}
            onChange={(e) => setDoc({ structure: e.target.value as FareStructure })}
          >
            {STRUCTURES.map((s) => (
              <option key={s} value={s}>
                {t(STRUCTURE_LABEL[s])}
              </option>
            ))}
          </select>
        </label>
        {structure === "zonal" && (
          <p className={`mt-2 text-sm ${zones.length ? "text-slate-600" : "text-amber-700"}`}>
            {zones.length ? tn("fare.zonesFromMap", zones.length) : t("fare.noZones")}
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
            {t("fare.noLines")}
          </p>
        )}
        {est && total && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile
                title={t("fare.tile.firstYear")}
                value={money(total.net[1])}
                sub={t("fare.tile.firstYearSub", { low: money(total.net[0]), high: money(total.net[2]) })}
              />
              <Tile
                title={t("fare.tile.boardings")}
                value={compact(total.riders[1])}
                sub={t("fare.tile.boardingsSub", { estimate: compact(total.estimate[1]) })}
              />
              <Tile
                title={t("fare.tile.avgFare")}
                value={fare(total.paid[1])}
                sub={t("fare.tile.avgFareSub", { fare: fare(total.single[1]) })}
              />
              <Tile
                title={t("fare.tile.overYears", { years: YEARS })}
                value={money(est.years.reduce((s, y) => s + y.net[1], 0))}
                sub={t("fare.tile.overYearsSub")}
              />
            </div>
            <PerLine t={t} modeLabel={modeLabel} est={est} structure={structure} money={money} fare={fare} />
            <ByYear t={t} est={est} money={money} />
          </>
        )}
      </TablePart>
      <TablePart id="fares.settings">
        <Settings
          t={t}
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

function PerLine({
  t,
  modeLabel,
  est,
  structure,
  money,
  fare,
}: {
  t: Translate;
  modeLabel: (mode: string) => string;
  est: FareEstimate;
  structure: FareStructure;
  money: (v: number) => string;
  fare: (v: number) => string;
}) {
  return (
    <section className={card} aria-labelledby="fare-lines">
      <h3 id="fare-lines" className="caps m-0">
        {t("fare.perLine")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("fare.perLineNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("fare.col.line")}</th>
              <th className={`${th} text-right`}>{t("fare.col.boardingsYear")}</th>
              <th className={`${th} text-right`}>{t("fare.col.avgTrip")}</th>
              <th className={`${th} text-right`}>{t("fare.col.single")}</th>
              <th className={`${th} text-right`}>{t("fare.col.paidPerBoarding")}</th>
              <th className={`${th} text-right`}>{t("fare.col.paid")}</th>
              <th className={`${th} text-right`}>{t("fare.col.collection")}</th>
              <th className={`${th} text-right`}>{t("fare.col.revenue")}</th>
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
                      ? t("fare.allLines")
                      : r.scope === "mode"
                        ? t("fare.allModeLines", { mode: modeLabel(r.name) })
                        : r.name}
                  </span>
                </td>
                <td className={num}>
                  <Range v={r.riders} f={compact} />
                </td>
                <td className={num}>
                  {r.avgKm === null ? "–" : t("fare.km", { v: sig(r.avgKm) })}
                  {structure === "zonal" && r.avgZones !== null && (
                    <span className="block text-xs text-slate-500">
                      {t("fare.zones", { v: sig(r.avgZones) })}
                    </span>
                  )}
                </td>
                <td className={num}>{fare(r.single[1])}</td>
                <td className={num}>
                  <Range v={r.paid} f={fare} />
                </td>
                <td className={num}>
                  <Range v={r.gross} f={money} />
                </td>
                <td className={num}>
                  <Range v={r.collection} f={money} />
                </td>
                <td className={num}>
                  <Range v={r.net} f={money} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ByYear({ t, est, money }: { t: Translate; est: FareEstimate; money: (v: number) => string }) {
  const years = est.years.filter((y) => SHOWN_YEARS.includes(y.year));
  return (
    <section className={card} aria-labelledby="fare-years">
      <h3 id="fare-years" className="caps m-0">
        {t("fare.byYear")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("fare.byYearNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("fare.col.year")}</th>
              <th className={`${th} text-right`}>{t("fare.col.boardings")}</th>
              <th className={`${th} text-right`}>{t("fare.col.paid")}</th>
              <th className={`${th} text-right`}>{t("fare.col.collection")}</th>
              <th className={`${th} text-right`}>{t("fare.col.revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year} className="border-b border-slate-100">
                <td className={td}>{y.year}</td>
                <td className={num}>
                  <Range v={y.riders} f={compact} />
                </td>
                <td className={num}>
                  <Range v={y.gross} f={money} />
                </td>
                <td className={num}>
                  <Range v={y.collection} f={money} />
                </td>
                <td className={num}>
                  <Range v={y.net} f={money} />
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
function settingGroups(t: Translate, structure: FareStructure): { title: string; keys: string[] }[] {
  return [
    { title: t(STRUCTURE_LABEL[structure]), keys: STRUCTURE_KEYS[structure] },
    {
      title: t("fare.group.tickets"),
      keys: ["fare.pass.trip_share", "fare.pass.price_in_fares", "fare.pass.trips_per_month"],
    },
    {
      title: t("fare.group.discounts"),
      keys: GROUPS.flatMap((g) => [`fare.concession.${g}.share`, `fare.concession.${g}.discount`]),
    },
    {
      title: t("fare.group.ridership"),
      keys: ["fare.elasticity", "fare.ridership_growth", "fare.real_increase"],
    },
    { title: t("fare.group.losses"), keys: ["fare.evasion_share", "fare.collection_cost_share"] },
  ];
}

function Settings({
  t,
  structure,
  own,
  perIntl,
  currency,
  editable,
  setValue,
}: {
  t: Translate;
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
        {t("fare.settings")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {t("fare.settingsNote", { currency: currency ?? t("fare.localCurrency") })}
      </p>
      {settingGroups(t, structure).map((g) => (
        <div key={g.title} className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="caps pb-1 text-left text-slate-700">{g.title}</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t("fare.col.value")}</th>
                <th className={`${th} text-right`}>{t("fare.col.library")}</th>
                <th className={`${th} text-right`}>{t("fare.col.project")}</th>
              </tr>
            </thead>
            <tbody>
              {g.keys.map((k) => (
                <SettingRow
                  t={t}
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
  t,
  k,
  own,
  perIntl,
  currency,
  editable,
  setValue,
}: {
  t: Translate;
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
  const { language } = useI18n();
  const label = paramLabel(language, k, p.label);
  const unit = paramUnit(language, money ? p.unit.replace(/ \(2023, PPP\)/, "") : p.unit).replace(
    /US\$/,
    currency ?? t("fare.localCurrency"),
  );
  return (
    <tr className="border-b border-slate-100">
      <td className={td}>
        {label}
        <span className="block text-xs text-slate-500">
          {unit}
          {POLICY.has(k) ? t("fare.yourChoice") : ""}
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
            aria-label={label}
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

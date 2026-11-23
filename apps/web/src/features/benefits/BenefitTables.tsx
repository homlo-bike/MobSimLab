import { useEffect, useMemo, useRef, useState } from "react";
import { inputKey } from "../../projects/inputKey";
import { type ResultsApi, useSavedResult } from "../../projects/results";
import { SavedResultNotice } from "../../projects/SavedResultNotice";
import { type MessageKey } from "../../i18n/messages";
import { useI18n } from "../../i18n/i18n";
import { paramLabel, paramUnit } from "../../i18n/params";
import { fmtMoney } from "../costs/CostTables";
import { useModeLabel } from "../schematic/common";
import type { Estimate as CostEstimate } from "../costs/model";
import { loadWasmReach } from "../journey-planner/engine";
import type { ReachLoader, Timetable } from "../journey-planner/types";
import { type PreferencesDoc, sameNameStationM, withPref } from "../../workspace/preferences";
import { formulaProblem } from "./formula";
import {
  type BenefitsDoc,
  FORMULA_BY_ID,
  type FormulaDef,
  type FormulaId,
  FORMULAS,
  formulaText,
} from "./formulas";
import {
  type BenefitIndicators,
  type BenefitsApi,
  benefitsApi,
  catchmentTiles,
  countryFigures,
  loadTiles,
  MAX_TILES,
  type PopulationAnswer,
} from "./data";
import {
  ACCESS_KINDS,
  type AccessKind,
  type BuildingIn,
  catchment,
  catchments,
  estimate,
  type Estimate,
  type Metric,
  type PlaceIn,
  type Prepared,
  type Zone,
  prepare,
  prepareValues,
  type Row,
  type ZoneAccess,
} from "./model";
import { type DemandRidership, withDemandRidership } from "../demand/ridership";
import { networkOf } from "./network";
import { libraryValue, PARAMS, paramModes, paramValue, prefId, type Triple } from "./params";
import type { Region } from "./regions";
import { accessByScenario, spendingFrom } from "./run";
import { TablePart } from "../tables/sections";
import { RIDER_SHARE_PREFS } from "../../workspace/editedElsewhere";
import { engineErrorText } from "../../i18n/engine";

interface Props {
  /** The published network: street lines (`street:<i>`), rail lines (`rail:<id>`) and plugin lines. */
  timetable: Timetable | null;
  regions: Region[];
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
  doc: BenefitsDoc | null;
  onDoc?: (doc: BenefitsDoc) => void;
  /**
   * From the cost tables: the estimate, the currency it is in, the country code and the factor from the
   * country's currency to that one (the World Bank's figures are in the country's currency).
   */
  costs: { estimate: CostEstimate; currency: string | null; country: string | null; rate?: number } | null;
  /** Called with each new estimate, and with null while there is none (the service table shows its riders). */
  onEstimate?: (e: Estimate | null) => void;
  /** The demand model run the planner picked for ridership; null for the formula estimate. */
  ridership?: DemandRidership | null;
  /** The project's saved results: the travel times with and without each line show on opening. */
  results?: ResultsApi | null;
  /** The planner may replace the saved travel times (Owners and Editors). */
  canSave?: boolean;
  /** Tests inject these. */
  api?: BenefitsApi;
  loadReach?: ReachLoader;
  draws?: number;
}

const DEFAULT_API = benefitsApi();

const KIND_LABEL: Record<AccessKind, MessageKey> = {
  jobs: "ben.kind.jobs",
  school: "ben.kind.school",
  university: "ben.kind.university",
  hospital: "ben.kind.hospital",
  clinic: "ben.kind.clinic",
};
const KIND_GROUP: Record<AccessKind, MessageKey> = {
  jobs: "ben.per.resident",
  school: "ben.per.child",
  university: "ben.per.student",
  hospital: "ben.per.resident",
  clinic: "ben.per.resident",
};

/** Money metrics in the appraisal, and those shown for context only (adding them would double count). */
const IN_APPRAISAL: Metric[] = ["gdp"];
const CONTEXT: Metric[] = [
  "earnings",
  "land_value",
  "property_tax",
  "construction_gdp",
  "construction_jobs",
  "operation_gdp",
  "operation_jobs",
];
const COUNTS = new Set<Metric>([
  "ridership_daily",
  "ridership_annual",
  "construction_jobs",
  "operation_jobs",
]);

/** The message of each formula unit and of what a formula is worked out for. */
const UNIT_KEY: Record<string, MessageKey> = {
  "boardings / weekday": "ben.u.boardingsWeekday",
  "boardings / year": "ben.u.boardingsYear",
  "currency / year": "ben.u.currencyYear",
  "currency (one-off)": "ben.u.currencyOnce",
  "currency (during construction)": "ben.u.currencyBuild",
  "job-years": "ben.u.jobYears",
  jobs: "ben.u.jobs",
};
const PER_KEY: Record<string, MessageKey> = {
  station: "ben.per.station",
  line: "ben.per.line",
  building: "ben.per.building",
};

function fmtCount(v: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: v >= 1e3 ? 1 : 0 }).format(
    v,
  );
}

const card = "mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6";
const th = "px-2 py-1.5 text-left font-medium text-slate-600";
const td = "px-2 py-1.5 align-top";
const num = "px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap";

/**
 * The economic and social benefit tables of the Tables tab (ADR-0040): access for people, ridership, GDP
 * growth, resident earnings, land value uplift, property tax and the stimulated economy, per line, per mode
 * and in total, as low, medium and high estimates. Formulas and parameters can be changed for the project;
 * regions drawn in the GIS tab take priority over the sourced data.
 * Side effects: asks the API for World Bank figures, WorldPop population and OpenStreetMap buildings and
 * places; compiles the network with the journey planner.
 */
export function BenefitTables({
  timetable,
  regions,
  preferences,
  onPreferences,
  doc,
  onDoc,
  costs,
  onEstimate,
  ridership = null,
  results = null,
  canSave = false,
  api = DEFAULT_API,
  loadReach = loadWasmReach,
  draws,
}: Props) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const prefs = preferences?.values;
  const [ind, setInd] = useState<BenefitIndicators | null>(null);
  const [indError, setIndError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<{
    buildings: BuildingIn[];
    places: PlaceIn[];
    failed: number;
    capped: number;
  } | null>(null);
  const [pop, setPop] = useState<PopulationAnswer | null>(null);
  const [popError, setPopError] = useState<string | null>(null);
  const [acc, setAcc] = useState<Map<string, ZoneAccess[]> | null>(null);
  const [accError, setAccError] = useState<string | null>(null);
  const [scope, setScope] = useState("total");

  const sameNameM = sameNameStationM(prefs);
  // Only the values the zones and reach depend on; a unit cost or fare edit must not prepare them again.
  const prepKey = JSON.stringify(prepareValues(prefs));
  const prepPrefs = useMemo(() => JSON.parse(prepKey) as Record<string, number>, [prepKey]);
  const net = useMemo(() => (timetable ? networkOf(timetable, sameNameM) : null), [timetable, sameNameM]);
  // Catchment circles: the key changes only when stations or catchment sizes change.
  const areas = useMemo(() => (timetable ? catchments(timetable, prepPrefs) : []), [timetable, prepPrefs]);
  const areasKey = JSON.stringify(areas);

  const code = costs?.country ?? null;
  useEffect(() => {
    if (!code) return;
    let live = true;
    setIndError(null);
    api
      .indicators(code)
      .then((v) => live && setInd(v))
      .catch((e: unknown) => {
        if (!live) return;
        setInd(null);
        setIndError(engineErrorText(e));
      });
    return () => {
      live = false;
    };
  }, [code, api]);

  useEffect(() => {
    let live = true;
    setTiles(null);
    setPop(null);
    setPopError(null);
    if (!net || !net.stations.length) return;
    const st = net.stations.map((s) => ({ at: s.at, radius: catchment(s.modes, prefs) }));
    const all = catchmentTiles(st);
    loadTiles(api, all.slice(0, MAX_TILES))
      .then((r) => live && setTiles({ ...r, capped: Math.max(0, all.length - MAX_TILES) }))
      .catch(() => live && setTiles({ buildings: [], places: [], failed: all.length, capped: 0 }));
    api
      .population(areas)
      .then((r) => live && setPop(r))
      .catch((e: unknown) => live && setPopError(engineErrorText(e)));
    return () => {
      live = false;
    };
  }, [areasKey, api]);

  const rate = costs?.rate ?? 1;
  const country = useMemo(() => countryFigures(ind, rate), [ind, rate]);
  const prepared = useMemo(() => {
    if (!timetable || !net?.stations.length || !tiles || (!pop && !popError)) return null;
    return prepare({
      timetable,
      buildings: tiles.buildings,
      places: tiles.places,
      worldpop: pop?.populations ?? {},
      country,
      regions,
      prefs: prepPrefs,
    });
  }, [timetable, net, tiles, pop, popError, country, regions, prepPrefs]);

  // The travel times with and without each line (the journey planner step) are saved with the project: they
  // show again on opening while the zones and the timetable are the same. Out of date, they still show until
  // the planner recalculates them, as long as they cover the same zones.
  const accInputs = useMemo(
    () =>
      prepared && timetable
        ? inputKey({
            zones: prepared.zones,
            net: prepared.net,
            walk: prepared.walk,
            timetable,
            prefs: prepPrefs,
          })
        : null,
    [prepared, timetable, prepPrefs],
  );
  const keptAcc = useSavedResult<Map<string, ZoneAccess[]>>(results, "benefit-access", accInputs, canSave);
  const [recalc, setRecalc] = useState(0);
  const lastRecalc = useRef(0);
  useEffect(() => {
    let live = true;
    setAccError(null);
    if (!prepared || !timetable || !keptAcc.loaded) {
      setAcc(null);
      return;
    }
    const forced = recalc !== lastRecalc.current;
    lastRecalc.current = recalc;
    const s = keptAcc.saved;
    const fits =
      s instanceof Object &&
      s.value instanceof Map &&
      [...s.value.values()].every((zones) => zones.length === prepared.zones.length);
    if (!forced && s && fits) {
      setAcc(s.value);
      return;
    }
    setAcc(null);
    const keyNow = accInputs!;
    accessByScenario(prepared, timetable, loadReach, prepPrefs)
      .then((a) => {
        if (!live) return;
        setAcc(a);
        keptAcc.save(a, keyNow);
      })
      .catch((e: unknown) => live && setAccError(engineErrorText(e)));
    return () => {
      live = false;
    };
    // A saved result read later, or saved by this effect, does not start it again.
  }, [prepared, timetable, loadReach, keptAcc.loaded, recalc]);

  const spending = useMemo(() => spendingFrom(costs?.estimate ?? null), [costs?.estimate]);
  const formulaEst: Estimate | null = useMemo(() => {
    if (!prepared || !acc) return null;
    return estimate({ prepared, access: acc, spending, country, prefs, doc, draws });
  }, [prepared, acc, spending, country, prefs, doc, draws]);
  const est = useMemo(
    () => (formulaEst && ridership ? withDemandRidership(formulaEst, ridership, prefs) : formulaEst),
    [formulaEst, ridership, prefs],
  );
  useEffect(() => {
    onEstimate?.(est);
  }, [est, onEstimate]);

  const currency = costs?.currency ?? null;
  const money = (v: number) => fmtMoney(v, currency);
  const value = (m: Metric, v: number) => (COUNTS.has(m) ? fmtCount(v) : money(v));
  const editable = !!onPreferences;
  const setPref = (id: string, v: number | null) => onPreferences?.(withPref(preferences, id, v));
  const row = est?.rows.find((r) => r.id === scope) ?? est?.rows.find((r) => r.id === "total") ?? null;

  const status = !net?.stations.length
    ? null
    : !tiles || (!pop && !popError)
      ? t("ben.loadingPlaces")
      : !acc && !accError
        ? t("ben.workingTimes")
        : null;

  return (
    <section aria-labelledby="benefit-title" className="mt-10">
      <h2 id="benefit-title" className="text-xl font-semibold tracking-tight">
        {t("ben.title")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("ben.intro")}</p>
      {!net?.stations.length ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          {t("ben.noStations")}
        </p>
      ) : (
        <>
          {status && (
            <p role="status" className="mt-4 text-sm text-slate-500">
              {status}
            </p>
          )}
          {acc && keptAcc.saved?.value === acc && keptAcc.state && (
            <div className="mt-3">
              <SavedResultNotice
                state={keptAcc.state}
                computedAt={keptAcc.saved.computedAt}
                onRecalculate={() => setRecalc((n) => n + 1)}
                error={keptAcc.error}
              />
            </div>
          )}
          {accError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {t("ben.timesFailed", { error: accError })}
            </p>
          )}
          <TablePart id="benefits.summary">
            <Sources ind={ind} indError={indError} pop={pop} popError={popError} tiles={tiles} est={est} />
          </TablePart>
          {est && row && (
            <>
              <TablePart id={["benefits.summary", "benefits.access"]}>
                <label className="mt-5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t("ben.show")}</span>
                  <select
                    className="input min-h-10"
                    value={row.id}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    {est.rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.scope === "total"
                          ? t("ben.allLines")
                          : r.scope === "mode"
                            ? t("ben.allModeLines", { mode: modeLabel(r.name) })
                            : r.name}
                      </option>
                    ))}
                  </select>
                </label>
              </TablePart>
              <TablePart id="benefits.summary">
                <MetricTable
                  id="ridership"
                  title={t("ben.m.ridership")}
                  metrics={["ridership_daily", "ridership_annual"]}
                  row={row}
                  value={value}
                />
                <MetricTable
                  id="in-the-appraisal"
                  title={t("ben.m.appraisal")}
                  note={t("ben.m.appraisalNote")}
                  metrics={IN_APPRAISAL}
                  row={row}
                  value={value}
                />
                <MetricTable
                  id="wider-context-not-added-to-the-appraisal"
                  title={t("ben.m.context")}
                  note={t("ben.m.contextNote")}
                  metrics={CONTEXT}
                  row={row}
                  value={value}
                />
              </TablePart>
              <TablePart id="benefits.access">
                <AccessTable row={row} />
                {prepared && <PerStation prepared={prepared} row={row} />}
              </TablePart>
              <TablePart id="benefits.lines">
                <PerLine est={est} money={money} />
              </TablePart>
            </>
          )}
          {est && est.notes.length > 0 && (
            <TablePart id="benefits.summary">
              <ul className="mt-4 list-disc pl-5 text-sm text-slate-600">
                {est.notes.map((n) => (
                  <li key={n.key}>{t(n.key, n.vars)}</li>
                ))}
              </ul>
            </TablePart>
          )}
        </>
      )}
      <TablePart id="benefits.settings">
        <Formulas doc={doc} onDoc={onDoc} />
        <Parameters prefs={prefs} editable={editable} setPref={setPref} />
      </TablePart>
    </section>
  );
}

function Sources({
  ind,
  indError,
  pop,
  popError,
  tiles,
  est,
}: {
  ind: BenefitIndicators | null;
  indError: string | null;
  pop: PopulationAnswer | null;
  popError: string | null;
  tiles: { buildings: BuildingIn[]; places: PlaceIn[]; failed: number; capped: number } | null;
  est: Estimate | null;
}) {
  const { t } = useI18n();
  const items: string[] = [];
  const na = t("ben.src.notAvailable");
  if (ind)
    items.push(
      t("ben.src.worldBank", {
        iso3: ind.iso3,
        gdp: ind.gdpPerCapita
          ? t("ben.src.gdp", {
              value: Math.round(ind.gdpPerCapita.value).toLocaleString("en"),
              year: ind.gdpPerCapita.year,
            })
          : na,
        employment: ind.employmentRatio
          ? t("ben.src.employment", {
              value: ind.employmentRatio.value.toFixed(0),
              year: ind.employmentRatio.year,
            })
          : na,
        licence: ind.source.licence,
      }),
    );
  else if (indError) items.push(t("ben.src.worldBankFailed", { error: indError }));
  else items.push(t("ben.src.worldBankWaiting"));
  if (pop) {
    const vars = { source: pop.source.name || "WorldPop", year: pop.year ?? "", licence: pop.source.licence };
    items.push(
      pop.failed
        ? t("ben.src.populationPart", {
            ...vars,
            count: pop.failed,
            reasons: pop.reasons.length ? ` (${pop.reasons.join("; ")})` : "",
          })
        : t("ben.src.population", vars),
    );
  } else if (popError) items.push(t("ben.src.populationFailed", { error: popError }));
  if (tiles)
    items.push(
      t("ben.src.osm", {
        buildings: tiles.buildings.length.toLocaleString("en"),
        places: tiles.places.length.toLocaleString("en"),
        failed: tiles.failed ? t("ben.src.tilesFailed", { count: tiles.failed }) : "",
        capped: tiles.capped ? t("ben.src.tilesCapped", { count: tiles.capped }) : "",
      }),
    );
  return (
    <details className="mt-4 text-sm text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">{t("ben.src.title")}</summary>
      <ul className="mt-2 list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
        {est && <li>{t("ben.src.draws", { draws: est.draws })}</li>}
      </ul>
    </details>
  );
}

function MetricTable({
  id: name,
  title,
  note,
  metrics,
  row,
  value,
}: {
  id: string;
  title: string;
  note?: string;
  metrics: Metric[];
  row: Row;
  value: (m: Metric, v: number) => string;
}) {
  const { t } = useI18n();
  const id = `benefit-${name}`;
  return (
    <section className={card} aria-labelledby={id}>
      <h3 id={id} className="caps m-0">
        {title}
      </h3>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("ben.col.estimate")}</th>
              <th className={`${th} text-right`}>{t("ben.col.low")}</th>
              <th className={`${th} text-right`}>{t("ben.col.medium")}</th>
              <th className={`${th} text-right`}>{t("ben.col.high")}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const d = FORMULA_BY_ID[m];
              const v = row.values[m];
              return (
                <tr key={m} className="border-b border-slate-100">
                  <td className={td}>
                    {t(`ben.f.${m}`)}
                    <span className="block text-xs text-slate-500">{t(UNIT_KEY[d.unit]!)}</span>
                  </td>
                  <td className={num}>{value(m, v[0])}</td>
                  <td className={`${num} font-semibold`}>{value(m, v[1])}</td>
                  <td className={num}>{value(m, v[2])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccessTable({ row }: { row: Row }) {
  const { t } = useI18n();
  const a = row.access;
  return (
    <section className={card} aria-labelledby="benefit-access">
      <h3 id="benefit-access" className="caps m-0">
        {t("ben.access")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {t(row.scope === "total" ? "ben.accessNoteAll" : "ben.accessNoteOne", {
          people: fmtCount(a.pop),
          jobs: fmtCount(a.jobsNear),
        })}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("ben.col.reachable")}</th>
              <th className={`${th} text-right`}>{t("ben.col.before")}</th>
              <th className={`${th} text-right`}>{t("ben.col.with")}</th>
              <th className={`${th} text-right`}>{t("ben.col.gaining")}</th>
            </tr>
          </thead>
          <tbody>
            {ACCESS_KINDS.map((k) => (
              <tr key={k} className="border-b border-slate-100">
                <td className={td}>
                  {t(KIND_LABEL[k])}
                  <span className="block text-xs text-slate-500">{t(KIND_GROUP[k])}</span>
                </td>
                <td className={num}>{fmtCount(a.before[k])}</td>
                <td className={`${num} font-semibold`}>{fmtCount(a.after[k])}</td>
                <td className={num}>{fmtCount(a.gaining[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Purpose: the stations of a scope (one line, all lines of a mode, or all lines), most people first, with
 * the people and jobs within walking distance of each. Each 50 m cell counts once, for its nearest station.
 */
export function stationRows(prepared: Prepared, row: Pick<Row, "id" | "scope" | "mode">) {
  const lines = new Map(prepared.net.lines.map((l) => [l.id, l]));
  const inScope = (z: Zone) =>
    row.scope === "total" ||
    (row.scope === "line"
      ? z.lines.includes(row.id)
      : z.lines.some((id) => lines.get(id)?.mode === row.mode));
  return prepared.zones
    .filter(inScope)
    .map((z) => ({
      id: z.id,
      name: z.name,
      lines: z.lines.flatMap((id) => {
        const l = lines.get(id);
        return l ? [{ id, name: l.name, color: l.color }] : [];
      }),
      radius: z.radius,
      pop: z.pop,
      jobs: z.jobs,
    }))
    .sort((a, b) => b.pop - a.pop || b.jobs - a.jobs || a.name.localeCompare(b.name));
}

function PerStation({ prepared, row }: { prepared: Prepared; row: Row }) {
  const { t } = useI18n();
  const rows = stationRows(prepared, row);
  if (!rows.length) return null;
  return (
    <section className={card} aria-labelledby="benefit-per-station">
      <h3 id="benefit-per-station" className="caps m-0">
        {t("ben.perStation")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("ben.perStationNote")}</p>
      <div className="mt-2 max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200">
              <th className={th}>{t("ben.col.station")}</th>
              <th className={th}>{t("ben.col.lines")}</th>
              <th className={`${th} text-right`}>{t("ben.col.walk")}</th>
              <th className={`${th} text-right`}>{t("ben.col.people")}</th>
              <th className={`${th} text-right`}>{t("ben.col.jobs")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className={td}>{r.name}</td>
                <td className={td}>
                  {r.lines.map((l) => (
                    <span key={l.id} className="mr-2 inline-flex items-center gap-1 whitespace-nowrap">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: l.color }}
                        aria-hidden="true"
                      />
                      {l.name}
                    </span>
                  ))}
                </td>
                <td className={num}>{t("ben.m", { v: Math.round(r.radius) })}</td>
                <td className={`${num} font-semibold`}>{fmtCount(r.pop)}</td>
                <td className={num}>{fmtCount(r.jobs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PerLine({ est, money }: { est: Estimate; money: (v: number) => string }) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const cols: [Metric, MessageKey][] = [
    ["ridership_annual", "ben.col.boardingsYear"],
    ["gdp", "ben.col.gdpYear"],
    ["land_value", "ben.col.landValue"],
    ["construction_jobs", "ben.col.jobYears"],
  ];
  return (
    <section className={card} aria-labelledby="benefit-per-line">
      <h3 id="benefit-per-line" className="caps m-0">
        {t("ben.perLine")}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{t("ben.perLineNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("ben.col.line")}</th>
              {cols.map(([m, l]) => (
                <th key={m} className={`${th} text-right`}>
                  {t(l)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {est.rows.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-slate-100 ${r.scope === "total" ? "font-semibold" : ""}`}
              >
                <td className={td}>
                  {r.scope === "line" && (
                    <span
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: r.color }}
                      aria-hidden="true"
                    />
                  )}
                  {r.scope === "total"
                    ? t("ben.allLines")
                    : r.scope === "mode"
                      ? t("ben.modeAll", { mode: modeLabel(r.name) })
                      : r.name}
                </td>
                {cols.map(([m]) => (
                  <td key={m} className={num}>
                    {COUNTS.has(m) ? fmtCount(r.values[m][1]) : money(r.values[m][1])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Formulas({ doc, onDoc }: { doc: BenefitsDoc | null; onDoc?: (d: BenefitsDoc) => void }) {
  const { t } = useI18n();
  return (
    <details className={card}>
      <summary className="cursor-pointer">
        <span className="caps">{t("ben.formulas")}</span>
        <span className="ml-2 text-sm text-slate-500">{t("ben.formulasHint")}</span>
      </summary>
      <p className="mt-2 text-xs text-slate-500">{t("ben.formulasNote")}</p>
      {FORMULAS.map((f) => (
        <FormulaEditor key={f.id} def={f} doc={doc} onDoc={onDoc} />
      ))}
    </details>
  );
}

function FormulaEditor({
  def,
  doc,
  onDoc,
}: {
  def: FormulaDef;
  doc: BenefitsDoc | null;
  onDoc?: (d: BenefitsDoc) => void;
}) {
  const { t } = useI18n();
  const saved = doc?.formulas?.[def.id];
  const [text, setText] = useState(saved ?? def.default);
  useEffect(() => setText(saved ?? def.default), [saved, def.default]);
  const problem = formulaProblem(
    text,
    def.vars.map((v) => v.name),
  );
  const save = (next: string | null) => {
    const formulas = { ...(doc?.formulas ?? {}) } as Partial<Record<FormulaId, string>>;
    if (next === null || next.trim() === def.default) delete formulas[def.id];
    else formulas[def.id] = next.trim();
    onDoc?.({ ...(doc ?? {}), formulas });
  };
  const id = `formula-${def.id}`;
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <label htmlFor={id} className="font-medium">
        {t(`ben.f.${def.id}`)}
      </label>
      <p className="text-xs text-slate-500">
        {t("ben.workedOut", { per: t(PER_KEY[def.per]!), unit: t(UNIT_KEY[def.unit]!) })}
        {saved ? t("ben.changed") : ""}
      </p>
      <textarea
        id={id}
        className="input mt-1 w-full font-mono text-sm"
        rows={2}
        value={text}
        readOnly={!onDoc}
        aria-invalid={!!problem}
        aria-describedby={`${id}-vars`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !problem && onDoc && text.trim() !== (saved ?? def.default) && save(text)}
      />
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {t("ben.formulaProblem", { problem })}
        </p>
      )}
      {onDoc && saved && (
        <button type="button" className="btn mt-1 min-h-9 text-sm" onClick={() => save(null)}>
          {t("ben.reset")}
        </button>
      )}
      <ul id={`${id}-vars`} className="mt-1 grid gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
        {def.vars.map((v) => (
          <li key={v.name}>
            <code className="font-mono text-slate-800">{v.name}</code>:{" "}
            {t(`ben.fv.${def.id}.${v.name}` as MessageKey)}
            {v.param ? t("ben.isParam") : ""}
          </li>
        ))}
      </ul>
      {!problem && saved && formulaText(doc, def.id) !== saved && (
        <p className="text-xs text-amber-700">{t("ben.savedUnreadable")}</p>
      )}
    </div>
  );
}

function Parameters({
  prefs,
  editable,
  setPref,
}: {
  prefs: Record<string, number> | undefined;
  editable: boolean;
  setPref: (id: string, v: number | null) => void;
}) {
  const { t } = useI18n();
  // Riders by day type are set in Simulator → Calendar run only.
  const keys = Object.keys(PARAMS).filter((k) => !(RIDER_SHARE_PREFS as readonly string[]).includes(k));
  return (
    <details className={card}>
      <summary className="cursor-pointer">
        <span className="caps">{t("ben.params")}</span>
        <span className="ml-2 text-sm text-slate-500">{t("ben.paramsHint")}</span>
      </summary>
      <p className="mt-2 text-xs text-slate-500">{t("ben.paramsNote")}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("ben.col.parameter")}</th>
              <th className={th}>{t("ben.col.appliesTo")}</th>
              <th className={`${th} text-right`}>{t("ben.col.library")}</th>
              <th className={`${th} text-right`}>{t("ben.col.project")}</th>
            </tr>
          </thead>
          <tbody>
            {keys.flatMap((k) =>
              ["*", ...paramModes(k)].map((m) => (
                <ParamRow
                  key={`${k}|${m}`}
                  k={k}
                  mode={m}
                  prefs={prefs}
                  editable={editable}
                  setPref={setPref}
                />
              )),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ParamRow({
  k,
  mode,
  prefs,
  editable,
  setPref,
}: {
  k: string;
  mode: string;
  prefs: Record<string, number> | undefined;
  editable: boolean;
  setPref: (id: string, v: number | null) => void;
}) {
  const { t, language } = useI18n();
  const modeLabel = useModeLabel();
  const p = PARAMS[k]!;
  const label = paramLabel(language, k, p.label);
  const lib = libraryValue(k, mode);
  const id = prefId(k, mode);
  const own = prefs?.[id];
  const used: Triple = paramValue(k, mode, prefs);
  const f = (v: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(v);
  return (
    <tr className="border-b border-slate-100">
      <td className={td}>
        {mode === "*" ? label : ""}
        {mode === "*" && <span className="block text-xs text-slate-500">{paramUnit(language, p.unit)}</span>}
      </td>
      <td className={td}>
        {mode === "*" ? t(paramModes(k).length ? "ben.otherModes" : "ben.all") : modeLabel(mode)}
      </td>
      <td className={num}>
        {f(lib[0])} – {f(lib[1])} – {f(lib[2])}
      </td>
      <td className={num}>
        {editable ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="number"
              step="any"
              className="input w-24 text-right"
              aria-label={`${label}${mode === "*" ? "" : `, ${modeLabel(mode)}`}`}
              defaultValue={own ?? ""}
              placeholder={f(used[1])}
              onBlur={(e) => {
                const v = e.target.value.trim();
                const n = Number(v);
                if (v === "") {
                  if (own !== undefined) setPref(id, null);
                } else if (Number.isFinite(n) && n !== own) setPref(id, n);
              }}
            />
          </span>
        ) : (
          f(used[1])
        )}
      </td>
    </tr>
  );
}

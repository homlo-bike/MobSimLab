import { useEffect, useMemo, useState } from "react";
import { fmtMoney, modeLabel } from "../costs/CostTables";
import type { Estimate as CostEstimate } from "../costs/model";
import { loadWasmReach } from "../journey-planner/engine";
import type { ReachLoader, Timetable } from "../journey-planner/types";
import { type PreferencesDoc, withPref } from "../../workspace/preferences";
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
  prepare,
  type Row,
  type ZoneAccess,
} from "./model";
import { networkOf } from "./network";
import { libraryValue, PARAMS, paramModes, paramValue, prefId, type Triple } from "./params";
import type { Region } from "./regions";
import { accessByScenario, spendingFrom } from "./run";

interface Props {
  /** The published network: street lines (`street:<i>`), rail lines (`rail:<id>`) and plugin lines. */
  timetable: Timetable | null;
  regions: Region[];
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
  doc: BenefitsDoc | null;
  onDoc?: (doc: BenefitsDoc) => void;
  /** From the cost tables: the estimate, the currency and the country code. */
  costs: { estimate: CostEstimate; currency: string | null; country: string | null } | null;
  /** Tests inject these. */
  api?: BenefitsApi;
  loadReach?: ReachLoader;
  draws?: number;
}

const DEFAULT_API = benefitsApi();

const KIND_LABEL: Record<AccessKind, string> = {
  jobs: "Jobs",
  school: "Schools",
  university: "Universities and colleges",
  hospital: "Hospitals",
  clinic: "Clinics and doctors",
};
const KIND_GROUP: Record<AccessKind, string> = {
  jobs: "residents",
  school: "children (0–14)",
  university: "people aged 18–24",
  hospital: "residents",
  clinic: "residents",
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
  api = DEFAULT_API,
  loadReach = loadWasmReach,
  draws,
}: Props) {
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

  const net = useMemo(() => (timetable ? networkOf(timetable) : null), [timetable]);
  // Catchment circles: the key changes only when stations or catchment sizes change.
  const areas = useMemo(() => (timetable ? catchments(timetable, prefs) : []), [timetable, prefs]);
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
        setIndError(e instanceof Error ? e.message : String(e));
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
      .catch((e: unknown) => live && setPopError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [areasKey, api]);

  const country = useMemo(() => countryFigures(ind), [ind]);
  const prepared = useMemo(() => {
    if (!timetable || !net?.stations.length || !tiles || (!pop && !popError)) return null;
    return prepare({
      timetable,
      buildings: tiles.buildings,
      places: tiles.places,
      worldpop: pop?.populations ?? {},
      country,
      regions,
      prefs,
    });
  }, [timetable, net, tiles, pop, popError, country, regions, prefs]);

  useEffect(() => {
    let live = true;
    setAcc(null);
    setAccError(null);
    if (!prepared || !timetable) return;
    accessByScenario(prepared, timetable, loadReach, prefs)
      .then((a) => live && setAcc(a))
      .catch((e: unknown) => live && setAccError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [prepared, timetable, loadReach]);

  const spending = useMemo(() => spendingFrom(costs?.estimate ?? null), [costs?.estimate]);
  const est: Estimate | null = useMemo(() => {
    if (!prepared || !acc) return null;
    return estimate({ prepared, access: acc, spending, country, prefs, doc, draws });
  }, [prepared, acc, spending, country, prefs, doc, draws]);

  const currency = costs?.currency ?? null;
  const money = (v: number) => fmtMoney(v, currency);
  const value = (m: Metric, v: number) => (COUNTS.has(m) ? fmtCount(v) : money(v));
  const editable = !!onPreferences;
  const setPref = (id: string, v: number | null) => onPreferences?.(withPref(preferences, id, v));
  const row = est?.rows.find((r) => r.id === scope) ?? est?.rows.find((r) => r.id === "total") ?? null;

  const status = !net?.stations.length
    ? null
    : !tiles || (!pop && !popError)
      ? "Loading population, buildings, schools and health places around the stations…"
      : !acc && !accError
        ? "Working out travel times with and without each line…"
        : null;

  return (
    <section aria-labelledby="benefit-title" className="mt-10">
      <h2 id="benefit-title" className="text-xl font-semibold tracking-tight">
        Economic and social benefits
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        Educated estimates to put the project in perspective: who gains access to jobs, education and
        healthcare, how many people may ride, and what the lines may add to the economy. People and places
        come from WorldPop, OpenStreetMap and the World Bank; regions drawn in the GIS tab take priority. Low,
        medium and high are the 10th, 50th and 90th percentile over the parameter ranges and the cost range.
      </p>
      {!net?.stations.length ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-slate-600">
          No stations yet. Draw a street line, or publish rail service lines in the railway tool.
        </p>
      ) : (
        <>
          {status && (
            <p role="status" className="mt-4 text-sm text-slate-500">
              {status}
            </p>
          )}
          {accError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Travel times could not be worked out: {accError}
            </p>
          )}
          <Sources ind={ind} indError={indError} pop={pop} popError={popError} tiles={tiles} est={est} />
          {est && row && (
            <>
              <label className="mt-5 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Show</span>
                <select className="input min-h-10" value={row.id} onChange={(e) => setScope(e.target.value)}>
                  {est.rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.scope === "total"
                        ? "All lines"
                        : r.scope === "mode"
                          ? `All ${modeLabel(r.name)} lines`
                          : r.name}
                    </option>
                  ))}
                </select>
              </label>
              <MetricTable
                title="Ridership"
                metrics={["ridership_daily", "ridership_annual"]}
                row={row}
                value={value}
              />
              <MetricTable
                title="In the appraisal"
                note="Extra GDP a year once the lines run: the agglomeration effect of UK appraisal guidance (TAG A2.4)."
                metrics={IN_APPRAISAL}
                row={row}
                value={value}
              />
              <MetricTable
                title="Wider context, not added to the appraisal"
                note="Earnings and land values largely capitalise the same time savings, and spending impacts are not net benefits, so adding them to the GDP growth would count benefits twice."
                metrics={CONTEXT}
                row={row}
                value={value}
              />
              <AccessTable row={row} />
              <PerLine est={est} money={money} />
            </>
          )}
          {est && est.notes.length > 0 && (
            <ul className="mt-4 list-disc pl-5 text-sm text-slate-600">
              {est.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <Formulas doc={doc} onDoc={onDoc} />
      <Parameters prefs={prefs} editable={editable} setPref={setPref} />
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
  const items: string[] = [];
  if (ind)
    items.push(
      `World Bank (${ind.iso3}): GDP per person ${ind.gdpPerCapita ? `${Math.round(ind.gdpPerCapita.value).toLocaleString("en")} (${ind.gdpPerCapita.year})` : "not available"}, employment ratio ${ind.employmentRatio ? `${ind.employmentRatio.value.toFixed(0)} % (${ind.employmentRatio.year})` : "not available"}. ${ind.source.licence}.`,
    );
  else if (indError) items.push(`World Bank figures are unavailable: ${indError}`);
  else items.push("World Bank figures: waiting for the project's country (from the cost tables).");
  if (pop)
    items.push(
      `WorldPop ${pop.year ?? ""} population (100 m grid)${pop.failed ? `; ${pop.failed} station areas use homes' floor area instead${pop.reasons.length ? ` (${pop.reasons.join("; ")})` : ""}` : ""}. ${pop.source.licence}.`,
    );
  else if (popError)
    items.push(`WorldPop is unavailable (${popError}); population comes from homes' floor area.`);
  if (tiles)
    items.push(
      `OpenStreetMap: ${tiles.buildings.length.toLocaleString("en")} buildings and ${tiles.places.length.toLocaleString("en")} schools and health places${tiles.failed ? `; ${tiles.failed} tile requests failed` : ""}${tiles.capped ? `; ${tiles.capped} far tiles left out` : ""}. © OpenStreetMap contributors, ODbL.`,
    );
  return (
    <details className="mt-4 text-sm text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">Data sources</summary>
      <ul className="mt-2 list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
        {est && <li>{est.draws} draws over the parameter and cost ranges, seeded so the numbers repeat.</li>}
      </ul>
    </details>
  );
}

function MetricTable({
  title,
  note,
  metrics,
  row,
  value,
}: {
  title: string;
  note?: string;
  metrics: Metric[];
  row: Row;
  value: (m: Metric, v: number) => string;
}) {
  const id = `benefit-${title.replace(/\W+/g, "-").toLowerCase()}`;
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
              <th className={th}>Estimate</th>
              <th className={`${th} text-right`}>Low</th>
              <th className={`${th} text-right`}>Medium</th>
              <th className={`${th} text-right`}>High</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const d = FORMULA_BY_ID[m];
              const t = row.values[m];
              return (
                <tr key={m} className="border-b border-slate-100">
                  <td className={td}>
                    {d.label}
                    <span className="block text-xs text-slate-500">{d.unit}</span>
                  </td>
                  <td className={num}>{value(m, t[0])}</td>
                  <td className={`${num} font-semibold`}>{value(m, t[1])}</td>
                  <td className={num}>{value(m, t[2])}</td>
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
  const a = row.access;
  return (
    <section className={card} aria-labelledby="benefit-access">
      <h3 id="benefit-access" className="caps m-0">
        Access for people
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {fmtCount(a.pop)} people and {fmtCount(a.jobsNear)} jobs within walking distance of the stations.
        Places reachable by public transport and walking at the morning peak, within the time limits in the
        parameters, before and with {row.scope === "total" ? "the lines" : "this"}.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Reachable</th>
              <th className={`${th} text-right`}>Per person before</th>
              <th className={`${th} text-right`}>With the line</th>
              <th className={`${th} text-right`}>People who gain access</th>
            </tr>
          </thead>
          <tbody>
            {ACCESS_KINDS.map((k) => (
              <tr key={k} className="border-b border-slate-100">
                <td className={td}>
                  {KIND_LABEL[k]}
                  <span className="block text-xs text-slate-500">per {KIND_GROUP[k].replace(/s$/, "")}</span>
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

function PerLine({ est, money }: { est: Estimate; money: (v: number) => string }) {
  const cols: [Metric, string][] = [
    ["ridership_annual", "Boardings a year"],
    ["gdp", "GDP growth a year"],
    ["land_value", "Land value uplift"],
    ["construction_jobs", "Job-years building it"],
  ];
  return (
    <section className={card} aria-labelledby="benefit-per-line">
      <h3 id="benefit-per-line" className="caps m-0">
        Per line, per mode and in total (medium)
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        A line's or mode's benefit is the difference with and without it; network effects make the parts add
        up to more or less than the total.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Line</th>
              {cols.map(([m, l]) => (
                <th key={m} className={`${th} text-right`}>
                  {l}
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
                    ? "All lines"
                    : r.scope === "mode"
                      ? `${modeLabel(r.name)} (all)`
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
  return (
    <details className={card}>
      <summary className="cursor-pointer">
        <span className="caps">Formulas</span>
        <span className="ml-2 text-sm text-slate-500">
          change how each value is worked out for this project
        </span>
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        Use the variables listed, numbers, + − * / ^, brackets and ln, log10, exp, sqrt, abs, min and max.
        Variables marked as parameters vary between their low and high values.
      </p>
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
        {def.label}
      </label>
      <p className="text-xs text-slate-500">
        Worked out per {def.per}; result in {def.unit}.{saved ? " Changed for this project." : ""}
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
          {problem}. The default formula is used until this is fixed.
        </p>
      )}
      {onDoc && saved && (
        <button type="button" className="btn mt-1 min-h-9 text-sm" onClick={() => save(null)}>
          Reset to the default
        </button>
      )}
      <ul id={`${id}-vars`} className="mt-1 grid gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
        {def.vars.map((v) => (
          <li key={v.name}>
            <code className="font-mono text-slate-800">{v.name}</code>: {v.label}
            {v.param ? " (parameter)" : ""}
          </li>
        ))}
      </ul>
      {!problem && saved && formulaText(doc, def.id) !== saved && (
        <p className="text-xs text-amber-700">The saved formula could not be read; the default is used.</p>
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
  const keys = Object.keys(PARAMS);
  return (
    <details className={card}>
      <summary className="cursor-pointer">
        <span className="caps">Parameters</span>
        <span className="ml-2 text-sm text-slate-500">
          the values the formulas use, with their sources in the assumption library
        </span>
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        Setting a value replaces the medium; low and high move with it. Sources and reasoning are in
        assumptions/DEFAULTS.md.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Parameter</th>
              <th className={th}>Applies to</th>
              <th className={`${th} text-right`}>Library low – medium – high</th>
              <th className={`${th} text-right`}>This project</th>
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
  const p = PARAMS[k]!;
  const lib = libraryValue(k, mode);
  const id = prefId(k, mode);
  const own = prefs?.[id];
  const used: Triple = paramValue(k, mode, prefs);
  const f = (v: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(v);
  return (
    <tr className="border-b border-slate-100">
      <td className={td}>
        {mode === "*" ? p.label : ""}
        {mode === "*" && <span className="block text-xs text-slate-500">{p.unit}</span>}
      </td>
      <td className={td}>
        {mode === "*" ? (paramModes(k).length ? "Other modes" : "All") : modeLabel(mode)}
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
              aria-label={`${p.label}${mode === "*" ? "" : `, ${modeLabel(mode)}`}`}
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

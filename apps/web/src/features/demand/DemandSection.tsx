import { useEffect, useMemo, useRef, useState } from "react";
import { en } from "../../i18n/en";
import { RAIL_MODES } from "../railways/modes";
import { MODES as STREET_MODES } from "../street-lines/modes";
import { type BenefitIndicators, type BenefitsApi, benefitsApi, countryFigures } from "../benefits/data";
import type { Region } from "../benefits/regions";
import type { Timetable } from "../journey-planner/types";
import type { PreferencesDoc } from "../../workspace/preferences";
import {
  demandTiles,
  MAX_DEMAND_TILES,
  type DemandResult,
  type DemandRun,
  type DemandRunDetail,
  type DemandRunsApi,
  isOpen,
  MODES,
  type Mode,
  PURPOSES,
} from "./api";
import {
  type BundleStreetSetup,
  type Estimated,
  estimateZones,
  makeBundle,
  type StopAccess,
  transitOf,
  type ValueSource,
  withStepFree,
} from "./bundle";
import { centreTile, loadZoneData, MAX_ZONE_TILES, type ZoneData } from "./load";
import { demandValue, demandValues } from "./params";
import { CalibrationResult, ObservedCard, observedForRun } from "./Calibration";
import { TablePart } from "../tables/sections";
import {
  activeZones,
  type DemandDoc,
  type DemandZone,
  hexZones,
  linePoints,
  withZoneValues,
  ZONE_FIELDS,
  type ZoneField,
  type ZoneValues,
  zoneKm2,
  zonesFromGeoJson,
  zonesToGeoJson,
} from "./zones";

interface Props {
  /** The published network: street lines, rail service lines and plugin lines. */
  timetable: Timetable | null;
  regions: Region[];
  preferences: PreferencesDoc | null;
  doc: DemandDoc | null;
  /** Absent for people who may not edit the project. */
  onDoc?: (doc: DemandDoc) => void;
  /** From the cost tables: the currency, the country, its rate to that currency and the PPP factor. */
  costs: { currency: string | null; country: string | null; rate?: number; ppp?: number } | null;
  /** The project's demand runs; null while unknown. */
  runs: DemandRunsApi | null;
  canRun: boolean;
  /** The GIS tab's street setups (lanes, bus lanes, bike lanes), applied to the streets of the run. */
  streetSetups?: readonly BundleStreetSetup[];
  /** The drawn stops and platforms with their recorded step-free access. */
  stopAccess?: readonly StopAccess[];
  /** Saves Project preferences (the calibrated values); absent for people who may not edit the project. */
  onPreferences?: (doc: PreferencesDoc) => void;
  /** Tests inject these. */
  api?: BenefitsApi;
  pollMs?: number;
}

const DEFAULT_API = benefitsApi();
const NO_SETUPS: readonly BundleStreetSetup[] = [];
const NO_ACCESS: readonly StopAccess[] = [];
const card = "mt-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-6";
const th = "px-2 py-1.5 text-left font-medium text-slate-600";
const td = "px-2 py-1.5 align-top";
const num = "px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap";
const PAGE = 25;

const MODE_LABEL: Record<Mode, string> = {
  transit: "Public transport",
  car: "Car",
  walk: "Walking",
  cycle: "Cycling",
};
const PURPOSE_LABEL: Record<string, string> = {
  hbw: "Home–work",
  hbe: "Home–education",
  hbo: "Home–other",
  nhb: "Not from home",
};
const PERIOD_LABEL: Record<string, string> = {
  am: "Morning peak",
  md: "Midday",
  pm: "Evening peak",
  ev: "Evening",
  nt: "Night",
};
const SOURCE_LABEL: Record<ValueSource, string> = {
  own: "your value",
  worldpop: "WorldPop",
  buildings: "OpenStreetMap buildings",
  places: "OpenStreetMap places",
  country: "World Bank share",
  none: "not known",
};
const STEP_LABEL: Record<string, string> = {
  skims: "Travel times",
  feedback: "Trips and car traffic",
  "transit assignment": "Public transport loads",
};

function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(v);
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${fmt((100 * part) / whole, 1)} %` : "–";
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Purpose: a mode's name, as the cost tables give it (the Tables tab is in English for now). */
function modeLabel(mode: string): string {
  const key =
    RAIL_MODES.find((m) => m.id === mode)?.label ?? STREET_MODES[mode as keyof typeof STREET_MODES]?.label;
  return key ? en[key] : mode.replace(/_/g, " ");
}

/** Purpose: a zone's values without one of them. */
function without(v: ZoneValues, key: keyof ZoneValues): ZoneValues {
  const out = { ...v };
  delete out[key];
  return out;
}

/** Purpose: offer a text as a file download. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The demand model in the Tables tab (ADR-0019, 09 §2): the zones of the model area (automatic hexagons, or
 * the planner's own zones uploaded as GeoJSON) with their people, jobs and special generators, a run of the
 * four-step model on the server, and its results: trips by mode, period and purpose, line loads, busiest
 * stops and desire lines. With observed data (mode shares, the mean car trip, counts) the run calibrates
 * itself; without them results are uncalibrated.
 * Side effects: asks the API for World Bank figures, WorldPop population and OpenStreetMap buildings and
 * places; starts, follows and deletes demand runs.
 */
export function DemandSection({
  timetable,
  regions,
  preferences,
  doc,
  onDoc,
  costs,
  runs,
  canRun,
  streetSetups = NO_SETUPS,
  stopAccess = NO_ACCESS,
  onPreferences,
  api = DEFAULT_API,
  pollMs = 3000,
}: Props) {
  const editable = !!onDoc;
  const buffer = demandValue("demand.area_buffer_m", preferences);
  const maxZones = demandValue("demand.zone_max_count", preferences);
  const points = useMemo(() => linePoints(timetable), [timetable]);
  const auto = useMemo(() => hexZones(points, buffer, maxZones), [points, buffer, maxZones]);
  const zones = useMemo(() => activeZones(doc, auto.zones), [doc, auto.zones]);
  const transit = useMemo(
    () => withStepFree(transitOf(timetable, preferences), stopAccess),
    [timetable, preferences, stopAccess],
  );
  const zonesKey = useMemo(
    () => zones.map((z) => `${z.id}:${z.ring.length}:${z.ring[0]?.join(",")}`).join("|"),
    [zones],
  );

  const [ind, setInd] = useState<BenefitIndicators | null>(null);
  const [indError, setIndError] = useState<string | null>(null);
  const [data, setData] = useState<{ key: string; data: ZoneData } | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadNotes, setUploadNotes] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
        setIndError(message(e));
      });
    return () => {
      live = false;
    };
  }, [code, api]);

  const rate = costs?.rate ?? 1;
  const country = useMemo(() => countryFigures(ind, rate), [ind, rate]);
  const current = data?.key === zonesKey ? data.data : null;
  const estimated: Estimated | null = useMemo(() => {
    if (!current) return null;
    return estimateZones({
      zones,
      worldpop: current.worldpop,
      buildings: current.buildings,
      places: current.places,
      covered: (z) => current.loaded.has(centreTile(z)),
      country,
      regions,
      prefs: preferences,
    });
  }, [current, zones, country, regions, preferences]);

  const loadData = async (): Promise<ZoneData | null> => {
    setLoading(0);
    setLoadError(null);
    try {
      const d = await loadZoneData(api, zones, (f) => setLoading(f));
      setData({ key: zonesKey, data: d });
      return d;
    } catch (e) {
      setLoadError(message(e));
      return null;
    } finally {
      setLoading(null);
    }
  };

  // Runs.
  const [saved, setSaved] = useState<DemandRun[]>([]);
  const [viewing, setViewing] = useState<DemandRunDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  useEffect(() => {
    if (!runs) return;
    let live = true;
    void runs.list().then(
      (l) => {
        if (!live) return;
        setSaved(l);
        const last = l.find((r) => r.status === "done") ?? l[0];
        if (last)
          void runs.get(last.id).then(
            (r) => live && setViewing((v) => v ?? r),
            () => undefined,
          );
      },
      (e: unknown) => live && setRunError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [runs]);
  const viewingId = viewing?.id ?? null;
  const viewingOpen = viewing !== null && isOpen(viewing);
  useEffect(() => {
    if (!runs || !viewingId || !viewingOpen) return;
    let live = true;
    const timer = setInterval(() => {
      void runs.get(viewingId).then(
        (r) => live && setViewing((v) => (v?.id === r.id ? r : v)),
        () => undefined,
      );
      void runs.list().then(
        (l) => live && setSaved(l),
        () => undefined,
      );
    }, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [runs, viewingId, viewingOpen, pollMs]);

  const economy = useMemo(() => {
    const gdp = country.gdpPerCapita;
    if (!gdp || !costs?.currency) return null;
    return { currency: costs.currency, gdp_per_capita: gdp, ppp_per_usd: (costs.ppp ?? 1) * rate };
  }, [country.gdpPerCapita, costs?.currency, costs?.ppp, rate]);

  const blocker = !transit.lines.length
    ? "Publish a line first: the model needs stops, running times and headways."
    : !zones.length
      ? "There are no zones."
      : !economy
        ? indError
          ? `World Bank figures are unavailable (${indError}), so values of time cannot be set.`
          : "Waiting for the cost tables' country and the World Bank figures (values of time come from GDP per person)."
        : null;

  const start = async () => {
    if (!runs || blocker || !economy) return;
    setSending(true);
    setRunError(null);
    try {
      let d = current;
      if (!d) d = await loadData();
      if (!d) return;
      const est = estimateZones({
        zones,
        worldpop: d.worldpop,
        buildings: d.buildings,
        places: d.places,
        covered: (z) => d.loaded.has(centreTile(z)),
        country,
        regions,
        prefs: preferences,
      });
      const { bundle, summary } = makeBundle(est.zones, transit, economy, streetSetups);
      // The server loads the streets around the zones; it takes at most MAX_DEMAND_TILES tiles.
      const tiles = demandTiles(bundle.zones.map((z) => z.centroid));
      if (tiles.length > MAX_DEMAND_TILES) {
        setRunError(
          `The zones cover too large an area for one run (${tiles.length} street tiles, at most ${MAX_DEMAND_TILES}). Use a smaller buffer in Project preferences, or fewer zones.`,
        );
        return;
      }
      const r = await runs.start(
        bundle,
        demandValues(preferences),
        summary,
        doc?.gbfsUrl,
        observedForRun(doc?.observed),
      );
      setViewing(r);
      setSaved((l) => [r, ...l.filter((x) => x.id !== r.id)]);
    } catch (e) {
      setRunError(message(e));
    } finally {
      setSending(false);
    }
  };

  const view = async (id: string) => {
    if (!runs) return;
    try {
      setViewing(await runs.get(id));
    } catch (e) {
      setRunError(message(e));
    }
  };

  const cancel = async () => {
    if (!runs || !viewing) return;
    try {
      setViewing(await runs.cancel(viewing.id));
    } catch (e) {
      setRunError(message(e));
    }
  };

  const remove = async (id: string) => {
    if (!runs) return;
    try {
      await runs.remove(id);
      setSaved((l) => l.filter((r) => r.id !== id));
      if (viewing?.id === id) setViewing(null);
    } catch (e) {
      setRunError(message(e));
    }
  };

  // Zones.
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    setUploadError(null);
    setUploadNotes([]);
    try {
      const { zones: own, notes } = zonesFromGeoJson(await f.text());
      onDoc?.({ ...(doc ?? { source: "auto" }), source: "own", zones: own });
      setUploadNotes([`${own.length} zones read from ${f.name}.`, ...notes]);
    } catch (e) {
      setUploadError(message(e));
    }
  };
  // Zone shapes, names and whether they are automatic or the planner's own are set in GIS → Demand zones only;
  // here the zones get their values.
  const setValues = (id: string, values: ZoneValues) => onDoc?.(withZoneValues(doc, id, values));

  const result = viewing?.status === "done" ? viewing.result : null;
  const lineNames = useMemo(
    () => [...new Set(transit.lines.map((l) => l.name || l.id))].sort(),
    [transit.lines],
  );
  const stopNames = useMemo(
    () => [...new Set(transit.stops.map((s) => s.name || s.id))].sort(),
    [transit.stops],
  );
  const zoneName = useMemo(() => new Map(zones.map((z) => [z.id, z.name])), [zones]);

  return (
    <section aria-labelledby="demand-title" className="mt-10">
      <h2 id="demand-title" className="text-xl font-semibold tracking-tight">
        Demand model
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">
        A four-step model of a weekday (trip generation, distribution, mode choice and assignment) over the
        model area: everywhere within {fmt(buffer)} m of the published lines. It runs on the server with
        AequilibraE for the morning peak, midday, evening peak and evening. Every value it uses is in Project
        preferences → Demand model.
      </p>

      <TablePart id="demand.zones">
        <div className={card}>
          <h3 className="caps m-0">Zones</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span
              className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700"
              data-testid="zone-source"
            >
              {doc?.source === "own"
                ? `Your ${fmt(zones.length)} zones`
                : auto.res === null
                  ? "Automatic hexagons"
                  : `${fmt(zones.length)} automatic hexagons (H3 size ${auto.res}, about ${fmt(
                      zones.length ? (zones.reduce((a, z) => a + zoneKm2(z), 0) / zones.length) * 100 : 0,
                    )} ha each)`}
            </span>
            {editable && (
              <>
                <button type="button" className="btn min-h-10" onClick={() => fileInput.current?.click()}>
                  Upload zones (GeoJSON)
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".geojson,.json,application/geo+json,application/json"
                  className="hidden"
                  aria-label="Zones file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
              </>
            )}
            {zones.length > 0 && (
              <button
                type="button"
                className="btn min-h-10"
                onClick={() => download("zones.geojson", zonesToGeoJson(zones), "application/geo+json")}
              >
                Download zones
              </button>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {doc?.source === "own"
              ? "Draw, reshape, rename and delete your zones in the GIS tab (Demand zones), or upload a new file. A GeoJSON property named like a value below (population, workers, jobs, students…) fills that value."
              : `Hexagons cover the model area, at most ${fmt(maxZones)} of them. Make them your own in the GIS tab (Demand zones) to draw, reshape, rename or delete zones.`}
          </p>
          {uploadError && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {uploadError}
            </p>
          )}
          {uploadNotes.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
              {uploadNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {zones.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                className="btn min-h-10"
                disabled={loading !== null}
                onClick={() => void loadData()}
              >
                {current ? "Estimate zone values again" : "Estimate zone values"}
              </button>
              {loading !== null && (
                <span role="status" className="text-slate-500">
                  Loading WorldPop people and OpenStreetMap buildings and places… {fmt(loading * 100)} %
                </span>
              )}
              {loadError && (
                <span role="alert" className="text-red-700">
                  {loadError}
                </span>
              )}
            </div>
          )}
          {current && <DataNotes data={current} estimated={estimated} />}
          {zones.length > 0 && (
            <ZoneTable zones={zones} estimated={estimated} editable={editable} onValues={setValues} />
          )}
        </div>

        <ObservedCard doc={doc} onDoc={onDoc} lineNames={lineNames} stopNames={stopNames} />
      </TablePart>

      <TablePart id="demand.run">
        <div className={card}>
          <h3 className="caps m-0">Run</h3>
          {blocker ? (
            <p className="mt-2 text-sm text-slate-600">{blocker}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              {fmt(zones.length)} zones, {fmt(transit.lines.length)} lines and {fmt(transit.stops.length)}{" "}
              stops. The server adds the OpenStreetMap streets of the zones. A run of a few hundred zones
              takes about a minute.
            </p>
          )}
          <GbfsField doc={doc} onDoc={onDoc} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canRun && runs && (
              <button
                type="button"
                className="btn btn-pri min-h-10"
                disabled={!!blocker || sending || loading !== null}
                onClick={() => void start()}
              >
                {sending ? "Starting…" : "Run the demand model"}
              </button>
            )}
            {viewing && isOpen(viewing) && canRun && (
              <button type="button" className="btn min-h-10" onClick={() => void cancel()}>
                Stop
              </button>
            )}
          </div>
          {runError && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {runError}
            </p>
          )}
          {viewing && <RunStatusLine run={viewing} />}
          {saved.length > 0 && (
            <SavedRuns
              saved={saved}
              viewingId={viewingId}
              onView={view}
              onRemove={canRun ? remove : undefined}
            />
          )}
        </div>
      </TablePart>

      {result && viewing && (
        <TablePart id="demand.results">
          <RidershipChoice runId={viewing.id} doc={doc} onDoc={onDoc} />
          <Results
            result={result}
            zoneName={zoneName}
            fileUrl={runs?.fileUrl(viewing.id, "od.omx") ?? null}
            preferences={preferences}
            onPreferences={onPreferences}
          />
        </TablePart>
      )}
    </section>
  );
}

function DataNotes({ data, estimated }: { data: ZoneData; estimated: Estimated | null }) {
  const notes = [
    data.popYear ? `People: WorldPop ${data.popYear} (CC BY 4.0).` : null,
    ...data.popReasons.map((r) => `WorldPop: ${r}`),
    data.capped
      ? `The model area needs ${data.loaded.size + data.failed + data.capped} tiles of OpenStreetMap buildings; the ${MAX_ZONE_TILES} nearest its centre were loaded.`
      : null,
    data.failed ? `${data.failed} tiles of buildings and places could not be loaded.` : null,
    ...(estimated?.notes ?? []),
  ].filter((n): n is string => !!n);
  if (!notes.length) return null;
  return (
    <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function ZoneTable({
  zones,
  estimated,
  editable,
  onValues,
}: {
  zones: DemandZone[];
  estimated: Estimated | null;
  editable: boolean;
  onValues: (id: string, v: ZoneValues) => void;
}) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? zones.filter((z) => z.name.toLowerCase().includes(q) || z.id.toLowerCase().includes(q))
      : zones;
  }, [zones, query]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const p = Math.min(page, pages - 1);
  const est = useMemo(() => new Map((estimated?.zones ?? []).map((z) => [z.id, z])), [estimated]);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-medium">Find a zone</span>
          <input
            className="input min-h-10"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="text-slate-500">
          {estimated
            ? "Grey values are estimated; type a number to use your own, clear it to go back to the estimate."
            : "Estimate zone values to see the people, jobs and places of each zone, or type your own."}
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Zone</th>
              {ZONE_FIELDS.map((f) => (
                <th key={f.key} className={`${th} text-right`} title={f.unit}>
                  {f.label}
                </th>
              ))}
              <th
                className={th}
                title="Centre zones draw more trips and cost more to park in; left unticked, the job density decides."
              >
                Centre
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(p * PAGE, (p + 1) * PAGE).map((z) => {
              const e = est.get(z.id);
              const src = estimated?.sources[z.id] ?? {};
              return (
                <tr key={z.id} className="border-b border-slate-100">
                  <td className={td}>{z.name} </td>
                  {ZONE_FIELDS.map((f) => (
                    <td key={f.key} className={num}>
                      <ValueCell
                        zone={z}
                        field={f.key}
                        estimate={e ? (e[f.key as keyof typeof e] as number | undefined) : undefined}
                        source={src[f.key]}
                        editable={editable}
                        onValues={onValues}
                      />
                    </td>
                  ))}
                  <td className={td}>
                    <input
                      type="checkbox"
                      aria-label={`Zone ${z.name} is a centre zone`}
                      checked={z.values.cbd === true}
                      disabled={!editable}
                      onChange={(ev) => {
                        const rest = without(z.values, "cbd");
                        onValues(z.id, ev.target.checked ? { ...rest, cbd: true } : rest);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <button type="button" className="btn min-h-9" disabled={p === 0} onClick={() => setPage(p - 1)}>
            Previous
          </button>
          <span>
            Page {p + 1} of {pages} ({fmt(shown.length)} zones)
          </span>
          <button
            type="button"
            className="btn min-h-9"
            disabled={p >= pages - 1}
            onClick={() => setPage(p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ValueCell({
  zone,
  field,
  estimate,
  source,
  editable,
  onValues,
}: {
  zone: DemandZone;
  field: ZoneField;
  estimate: number | undefined;
  source: ValueSource | undefined;
  editable: boolean;
  onValues: (id: string, v: ZoneValues) => void;
}) {
  const own = zone.values[field];
  const hasOwn = typeof own === "number" && Number.isFinite(own);
  const title = hasOwn ? "Your value" : source ? `From ${SOURCE_LABEL[source]}` : undefined;
  if (!editable)
    return <span className={hasOwn ? "font-medium" : "text-slate-500"}>{fmt(hasOwn ? own : estimate)}</span>;
  return (
    <input
      key={`${zone.id}-${field}-${hasOwn ? own : "x"}`}
      inputMode="decimal"
      className={`input min-h-9 w-24 text-right ${hasOwn ? "font-medium" : "text-slate-500"}`}
      aria-label={`${ZONE_FIELDS.find((f) => f.key === field)!.label} in zone ${zone.name}`}
      title={title}
      placeholder={estimate === undefined ? "" : fmt(estimate)}
      defaultValue={hasOwn ? String(own) : ""}
      onBlur={(ev) => {
        const raw = ev.target.value.trim().replace(",", ".");
        const rest = without(zone.values, field);
        if (raw === "") {
          if (hasOwn) onValues(zone.id, rest);
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          ev.target.value = hasOwn ? String(own) : "";
          return;
        }
        if (n !== own) onValues(zone.id, { ...rest, [field]: n });
      }}
    />
  );
}

function RunStatusLine({ run }: { run: DemandRunDetail }) {
  const p = run.progress;
  const text =
    run.status === "queued"
      ? p?.step === "streets" && typeof p.done === "number" && typeof p.of === "number"
        ? `Loading the OpenStreetMap streets of the zones: ${p.done} of ${p.of} tiles…`
        : p?.step === "bikes"
          ? "Loading the bike parkings and shared-bike stations…"
          : "Waiting for the server…"
      : run.status === "running"
        ? `Running: ${STEP_LABEL[String(p?.step ?? "")] ?? "preparing"}${
            p?.period ? `, ${PERIOD_LABEL[String(p.period)]?.toLowerCase() ?? String(p.period)}` : ""
          }${typeof p?.round === "number" ? `, round ${p.round + 1}` : ""}${
            typeof p?.calibration_round === "number" && typeof p.calibration_rounds === "number"
              ? ` (calibration round ${p.calibration_round} of at most ${p.calibration_rounds})`
              : ""
          }…`
        : run.status === "failed"
          ? `The run failed: ${run.error ?? "no reason given"}`
          : run.status === "cancelled"
            ? "The run was stopped."
            : `Run of ${new Date(run.finishedAt ?? run.createdAt).toLocaleString("en")}.`;
  return (
    <p
      role="status"
      className={`mt-3 text-sm ${run.status === "failed" ? "text-red-700" : "text-slate-600"}`}
    >
      {text}
    </p>
  );
}

function SavedRuns({
  saved,
  viewingId,
  onView,
  onRemove,
}: {
  saved: DemandRun[];
  viewingId: string | null;
  onView: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">Saved runs ({saved.length})</summary>
      <ul className="mt-2 flex flex-col gap-1">
        {saved.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`underline ${r.id === viewingId ? "font-semibold" : ""}`}
              onClick={() => onView(r.id)}
            >
              {new Date(r.createdAt).toLocaleString("en")}
            </button>
            <span className="text-slate-500">
              {r.status}, {fmt(r.network.zones)} zones, {fmt(r.network.lines)} lines
              {r.createdBy?.displayName ? `, by ${r.createdBy.displayName}` : ""}
            </span>
            {onRemove && !isOpen(r) && (
              <button type="button" className="text-red-700 underline" onClick={() => onRemove(r.id)}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Results({
  result,
  zoneName,
  fileUrl,
  preferences,
  onPreferences,
}: {
  result: DemandResult;
  zoneName: Map<string, string>;
  fileUrl: string | null;
  preferences: PreferencesDoc | null;
  onPreferences?: (doc: PreferencesDoc) => void;
}) {
  const t = result.totals;
  const periods = Object.keys(t.by_period);
  const lines = result.transit.lines.map((l) => {
    let boardings = 0;
    let peak = 0;
    let maxDay = 0;
    for (const p of l.patterns) {
      boardings += (p.boardings.day ?? []).reduce((a, b) => a + b, 0);
      const hours = result.period_hours.am || 1;
      peak = Math.max(peak, ...(p.load.am ?? [0]).map((x) => x / hours));
      maxDay = Math.max(maxDay, ...(p.load.day ?? [0]));
    }
    return { id: l.id, name: l.name, mode: l.mode, boardings, peak, maxDay };
  });
  const stops = Object.entries(result.transit.stops)
    .sort((a, b) => b[1].boardings + b[1].alightings - (a[1].boardings + a[1].alightings))
    .slice(0, 15);
  const crowded = result.road.links.filter((l) => l[3] >= 0.9).length;
  return (
    <div className={card} aria-label="Demand model results">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="caps m-0">Results</h3>
        {result.uncalibrated && (
          <span
            className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-900"
            title="No observed mode shares or counts were used: the numbers come from library values only. Add observed data above to calibrate."
          >
            Uncalibrated
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {fmt(t.trips)} trips a weekday in {fmt(result.zones_count)} zones;{" "}
        {pct(t.by_mode.transit ?? 0, t.trips)} by public transport. Mean car trip {fmt(t.car_km, 1)} km, walk{" "}
        {fmt(t.walk_min, 1)} min, bike ride {fmt(t.cycle_min, 1)} min.
      </p>

      <h4 className="mt-4 font-medium">Trips by mode and period</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Period</th>
              {MODES.map((m) => (
                <th key={m} className={`${th} text-right`}>
                  {MODE_LABEL[m]}
                </th>
              ))}
              <th className={`${th} text-right`}>Public transport share</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const row = t.by_period[p]!;
              const all = MODES.reduce((a, m) => a + (row[m] ?? 0), 0);
              return (
                <tr key={p} className="border-b border-slate-100">
                  <td className={td}>{PERIOD_LABEL[p] ?? p}</td>
                  {MODES.map((m) => (
                    <td key={m} className={num}>
                      {fmt(row[m])}
                    </td>
                  ))}
                  <td className={num}>{pct(row.transit ?? 0, all)}</td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className={td}>Weekday</td>
              {MODES.map((m) => (
                <td key={m} className={num}>
                  {fmt(t.by_mode[m])}
                </td>
              ))}
              <td className={num}>{pct(t.by_mode.transit ?? 0, t.trips)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 className="mt-4 font-medium">Trips by purpose</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Purpose</th>
              {MODES.map((m) => (
                <th key={m} className={`${th} text-right`}>
                  {MODE_LABEL[m]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PURPOSES.filter((p) => t.by_purpose[p]).map((p) => (
              <tr key={p} className="border-b border-slate-100">
                <td className={td}>{PURPOSE_LABEL[p]}</td>
                {MODES.map((m) => (
                  <td key={m} className={num}>
                    {fmt(t.by_purpose[p]![m])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="mt-4 font-medium">Lines</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>Line</th>
              <th className={th}>Mode</th>
              <th className={`${th} text-right`}>Boardings a weekday</th>
              <th
                className={`${th} text-right`}
                title="Riders an hour on the busiest stretch in the morning peak"
              >
                Peak load an hour
              </th>
              <th className={`${th} text-right`} title="Riders a weekday on the busiest stretch">
                Busiest stretch a day
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className={td}>{l.name}</td>
                <td className={td}>{modeLabel(l.mode)}</td>
                <td className={num}>{fmt(l.boardings)}</td>
                <td className={num}>{fmt(l.peak)}</td>
                <td className={num}>{fmt(l.maxDay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="font-medium">Busiest stops</h4>
          <table className="mt-1 min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>Stop</th>
                <th className={`${th} text-right`}>Boardings</th>
                <th className={`${th} text-right`}>Alightings</th>
              </tr>
            </thead>
            <tbody>
              {stops.map(([id, s]) => (
                <tr key={id} className="border-b border-slate-100">
                  <td className={td}>{s.name}</td>
                  <td className={num}>{fmt(s.boardings)}</td>
                  <td className={num}>{fmt(s.alightings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="font-medium">Strongest public transport desire lines</h4>
          <table className="mt-1 min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={`${th} text-right`}>Riders a weekday</th>
              </tr>
            </thead>
            <tbody>
              {result.desire_lines.slice(0, 15).map((d) => (
                <tr key={`${d.from}-${d.to}`} className="border-b border-slate-100">
                  <td className={td}>{zoneName.get(d.from) ?? d.from}</td>
                  <td className={td}>{zoneName.get(d.to) ?? d.to}</td>
                  <td className={num}>{fmt(d.transit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-600">
        Roads: {fmt(result.road.links.length)} street links carry cars; {fmt(crowded)} reach 90 % of their
        capacity in some period.
      </p>
      {result.calibration && (
        <CalibrationResult c={result.calibration} preferences={preferences} onPreferences={onPreferences} />
      )}
      {result.catchment && <Catchment c={result.catchment} />}
      {result.notes.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        {fileUrl && result.files.includes("od.omx") && (
          <a className="btn min-h-10" href={fileUrl} download="od.omx">
            Download trip tables (OMX)
          </a>
        )}
        <span className="text-slate-500">{result.attribution}</span>
      </div>
    </div>
  );
}

/** The GBFS feed of the project's shared-bike scheme: stations it lists are added to OpenStreetMap's. */
function GbfsField({ doc, onDoc }: { doc: DemandDoc | null; onDoc?: (doc: DemandDoc) => void }) {
  const [error, setError] = useState<string | null>(null);
  const saved = doc?.gbfsUrl ?? "";
  if (!onDoc && !saved) return null;
  const save = (raw: string) => {
    const v = raw.trim();
    if (v === saved) return;
    if (v && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(v)) {
      setError("Enter an https address, such as https://example.com/gbfs.json.");
      return;
    }
    setError(null);
    const next: DemandDoc = { ...(doc ?? { source: "auto" }) };
    if (v) next.gbfsUrl = v;
    else delete next.gbfsUrl;
    onDoc?.(next);
  };
  return (
    <div className="mt-3 text-sm">
      <label className="block">
        <span className="font-medium">Shared-bike feed (GBFS)</span>
        <input
          key={saved}
          type="url"
          inputMode="url"
          className="input mt-1 w-full max-w-xl"
          placeholder="https://…/gbfs.json"
          defaultValue={saved}
          disabled={!onDoc}
          onBlur={(e) => save(e.target.value)}
        />
      </label>
      <p className="mt-1 text-slate-500">
        Optional. Its stations are used with the shared-bike stations and bike parkings OpenStreetMap has in
        the zones.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** What cycle lanes, bike parkings, shared bikes, pedestrian streets and stops with steps did in the run. */
function Catchment({ c }: { c: NonNullable<DemandResult["catchment"]> }) {
  const rows: [string, string][] = [
    [
      "Cycle lanes and tracks",
      `${fmt(c.cycle_lane_km, 1)} km of lanes, ${fmt(c.cycle_track_km, 1)} km of tracks`,
    ],
    ["Pedestrian streets", `${fmt(c.pedestrian_km, 1)} km`],
    ["Bike parkings", fmt(c.bike_parkings)],
    ["Shared-bike stations", fmt(c.shared_bike_stations)],
    [
      "Stops with steps",
      `${fmt(c.stops_with_steps)} recorded without step-free access, ${fmt(c.stops_step_free)} with it`,
    ],
    ["Trips on a shared bike", fmt(c.shared_bike_trips)],
    [
      "Shared bike to or from public transport",
      `${fmt(c.shared_bike_to_transit)} to a stop, ${fmt(c.shared_bike_from_transit)} from a stop`,
    ],
    ["Bike and ride", `${fmt(c.bike_and_ride)} riders cycle to a stop and park`],
  ];
  return (
    <div className="mt-4">
      <h4 className="m-0 text-sm font-semibold">Catchment, a weekday</h4>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-slate-100">
              <th scope="row" className={th}>
                {k}
              </th>
              <td className={td}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Whether the run shown is the one whose ridership the Tables tab (ridership, the service table's Riders
 * column, fare revenue) and the system test's passenger loads use, instead of the formula estimate.
 */
function RidershipChoice({
  runId,
  doc,
  onDoc,
}: {
  runId: string;
  doc: DemandDoc | null;
  onDoc?: (doc: DemandDoc) => void;
}) {
  const used = doc?.ridershipRun === runId;
  const other = !!doc?.ridershipRun && !used;
  const set = (id: string | null) => {
    const next: DemandDoc = { ...(doc ?? { source: "auto" }) };
    if (id) next.ridershipRun = id;
    else delete next.ridershipRun;
    onDoc?.(next);
  };
  return (
    <div className={card} aria-label="Ridership used in the project">
      <h3 className="caps m-0">Ridership in the project</h3>
      <p className="mt-2 text-sm text-slate-600">
        {used
          ? "This run's boardings are the ridership of the Tables tab, the service table's Riders column, the fare revenue table and the system test's passenger loads."
          : other
            ? "Another run's boardings are the project's ridership."
            : "The project's ridership comes from the Tables tab's formula estimate. Use this run's boardings instead?"}{" "}
        Boardings you typed in the system test still come first.
      </p>
      {onDoc && (
        <div className="mt-3 flex flex-wrap gap-2">
          {used ? (
            <button type="button" className="btn min-h-10" onClick={() => set(null)}>
              Go back to the formula estimate
            </button>
          ) : (
            <button type="button" className="btn btn-pri min-h-10" onClick={() => set(runId)}>
              Use this run for ridership
            </button>
          )}
        </div>
      )}
    </div>
  );
}

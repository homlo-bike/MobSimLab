import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { useModeLabel } from "../schematic/common";
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
import { engineErrorText } from "../../i18n/engine";

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

const MODE_LABEL: Record<Mode, MessageKey> = {
  transit: "dem.mode.transit",
  car: "dem.mode.car",
  walk: "dem.mode.walk",
  cycle: "dem.mode.cycle",
};
const PURPOSE_LABEL: Record<string, MessageKey> = {
  hbw: "dem.purpose.hbw",
  hbe: "dem.purpose.hbe",
  hbo: "dem.purpose.hbo",
  nhb: "dem.purpose.nhb",
};
const PERIOD_LABEL: Record<string, MessageKey> = {
  am: "dem.period.am",
  md: "dem.period.md",
  pm: "dem.period.pm",
  ev: "dem.period.ev",
  nt: "dem.period.nt",
};
const SOURCE_LABEL: Record<ValueSource, MessageKey> = {
  own: "dem.src.own",
  worldpop: "dem.src.worldpop",
  buildings: "dem.src.buildings",
  places: "dem.src.places",
  country: "dem.src.country",
  none: "dem.src.none",
};
const STATUS_LABEL: Record<string, MessageKey | undefined> = {
  queued: "dem.st.queued",
  running: "dem.st.running",
  done: "dem.st.done",
  failed: "dem.st.failed",
  cancelled: "dem.st.cancelled",
};
const STEP_LABEL: Record<string, MessageKey> = {
  skims: "dem.step.skims",
  feedback: "dem.step.feedback",
  "transit assignment": "dem.step.assignment",
};

function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(v);
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${fmt((100 * part) / whole, 1)} %` : "–";
}

function message(e: unknown): string {
  return engineErrorText(e);
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
  const { t } = useI18n();
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
    ? t("dem.block.noLines")
    : !zones.length
      ? t("dem.block.noZones")
      : !economy
        ? indError
          ? t("dem.block.noWorldBank", { error: indError })
          : t("dem.block.waiting")
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
        setRunError(t("dem.tooLarge", { tiles: tiles.length, max: MAX_DEMAND_TILES }));
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
      setUploadNotes([t("dem.zonesRead", { count: own.length, file: f.name }), ...notes]);
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
        {t("dem.title")}
      </h2>
      <p className="mt-1 max-w-3xl text-slate-600">{t("dem.intro", { buffer: fmt(buffer) })}</p>

      <TablePart id="demand.zones">
        <div className={card}>
          <h3 className="caps m-0">{t("dem.zones")}</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span
              className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700"
              data-testid="zone-source"
            >
              {doc?.source === "own"
                ? t("dem.yourZones", { count: fmt(zones.length) })
                : auto.res === null
                  ? t("dem.autoHex")
                  : t("dem.autoHexCount", {
                      count: fmt(zones.length),
                      res: auto.res,
                      ha: fmt(
                        zones.length ? (zones.reduce((a, z) => a + zoneKm2(z), 0) / zones.length) * 100 : 0,
                      ),
                    })}
            </span>
            {editable && (
              <>
                <button type="button" className="btn min-h-10" onClick={() => fileInput.current?.click()}>
                  {t("dem.upload")}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".geojson,.json,application/geo+json,application/json"
                  className="hidden"
                  aria-label={t("dem.zonesFile")}
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
                {t("dem.download")}
              </button>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {doc?.source === "own" ? t("dem.ownHint") : t("dem.autoHint", { max: fmt(maxZones) })}
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
                {current ? t("dem.estimateAgain") : t("dem.estimate")}
              </button>
              {loading !== null && (
                <span role="status" className="text-slate-500">
                  {t("dem.loading", { pct: fmt(loading * 100) })}
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
          <h3 className="caps m-0">{t("dem.run")}</h3>
          {blocker ? (
            <p className="mt-2 text-sm text-slate-600">{blocker}</p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              {t("dem.runSummary", {
                zones: fmt(zones.length),
                lines: fmt(transit.lines.length),
                stops: fmt(transit.stops.length),
              })}
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
                {sending ? t("dem.starting") : t("dem.runModel")}
              </button>
            )}
            {viewing && isOpen(viewing) && canRun && (
              <button type="button" className="btn min-h-10" onClick={() => void cancel()}>
                {t("dem.stop")}
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
  const { t } = useI18n();
  const notes = [
    data.popYear ? t("dem.data.people", { year: data.popYear }) : null,
    ...data.popReasons.map((r) => `WorldPop: ${r}`),
    data.capped
      ? t("dem.data.capped", { tiles: data.loaded.size + data.failed + data.capped, max: MAX_ZONE_TILES })
      : null,
    data.failed ? t("dem.data.failed", { count: data.failed }) : null,
    ...(estimated?.notes ?? []).map((n) => t(n.key, n.vars)),
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
  const { t } = useI18n();
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
          <span className="font-medium">{t("dem.findZone")}</span>
          <input
            className="input min-h-10"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="text-slate-500">{estimated ? t("dem.greyHint") : t("dem.estimateHint")}</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("dem.col.zone")}</th>
              {ZONE_FIELDS.map((f) => (
                <th key={f.key} className={`${th} text-right`} title={t(`dem.zu.${f.key}`)}>
                  {t(`dem.zf.${f.key}`)}
                </th>
              ))}
              <th className={th} title={t("dem.centreHint")}>
                {t("dem.col.centre")}
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
                      aria-label={t("dem.isCentre", { zone: z.name })}
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
            {t("dem.prev")}
          </button>
          <span>{t("dem.page", { page: p + 1, pages, count: fmt(shown.length) })}</span>
          <button
            type="button"
            className="btn min-h-9"
            disabled={p >= pages - 1}
            onClick={() => setPage(p + 1)}
          >
            {t("dem.next")}
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
  const { t } = useI18n();
  const own = zone.values[field];
  const hasOwn = typeof own === "number" && Number.isFinite(own);
  const title = hasOwn
    ? t("dem.yourValue")
    : source
      ? t("dem.from", { source: t(SOURCE_LABEL[source]) })
      : undefined;
  if (!editable)
    return <span className={hasOwn ? "font-medium" : "text-slate-500"}>{fmt(hasOwn ? own : estimate)}</span>;
  return (
    <input
      key={`${zone.id}-${field}-${hasOwn ? own : "x"}`}
      inputMode="decimal"
      className={`input min-h-9 w-24 text-right ${hasOwn ? "font-medium" : "text-slate-500"}`}
      aria-label={t("dem.valueIn", { value: t(`dem.zf.${field}`), zone: zone.name })}
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
  const { t } = useI18n();
  const p = run.progress;
  const step = STEP_LABEL[String(p?.step ?? "")];
  const period = p?.period ? PERIOD_LABEL[String(p.period)] : undefined;
  const text =
    run.status === "queued"
      ? p?.step === "streets" && typeof p.done === "number" && typeof p.of === "number"
        ? t("dem.status.streets", { done: p.done, of: p.of })
        : p?.step === "bikes"
          ? t("dem.status.bikes")
          : t("dem.status.waiting")
      : run.status === "running"
        ? t("dem.status.running", {
            step: [
              step ? t(step) : t("dem.status.preparing"),
              ...(p?.period ? [period ? t(period) : String(p.period)] : []),
              ...(typeof p?.round === "number" ? [t("dem.status.round", { n: p.round + 1 })] : []),
            ].join(", "),
            calibration:
              typeof p?.calibration_round === "number" && typeof p.calibration_rounds === "number"
                ? t("dem.status.calibration", { n: p.calibration_round, of: p.calibration_rounds })
                : "",
          })
        : run.status === "failed"
          ? t("dem.status.failed", { error: run.error ?? t("dem.status.noReason") })
          : run.status === "cancelled"
            ? t("dem.status.stopped")
            : t("dem.status.done", { when: new Date(run.finishedAt ?? run.createdAt).toLocaleString("en") });
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
  const { t } = useI18n();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">{t("dem.savedRuns", { count: saved.length })}</summary>
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
              {t("dem.savedRun", {
                status: STATUS_LABEL[r.status] ? t(STATUS_LABEL[r.status]!) : r.status,
                zones: fmt(r.network.zones),
                lines: fmt(r.network.lines),
              })}
              {r.createdBy?.displayName ? t("dem.by", { name: r.createdBy.displayName }) : ""}
            </span>
            {onRemove && !isOpen(r) && (
              <button type="button" className="text-red-700 underline" onClick={() => onRemove(r.id)}>
                {t("dem.delete")}
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
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const tot = result.totals;
  const periods = Object.keys(tot.by_period);
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
    <div className={card} aria-label={t("dem.results.label")}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="caps m-0">{t("dem.results")}</h3>
        {result.uncalibrated && (
          <span
            className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-900"
            title={t("dem.uncalHint")}
          >
            {t("dem.uncal")}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {t("dem.summary", {
          trips: fmt(tot.trips),
          zones: fmt(result.zones_count),
          share: pct(tot.by_mode.transit ?? 0, tot.trips),
          car: fmt(tot.car_km, 1),
          walk: fmt(tot.walk_min, 1),
          bike: fmt(tot.cycle_min, 1),
        })}
      </p>

      <h4 className="mt-4 font-medium">{t("dem.byModePeriod")}</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("dem.col.period")}</th>
              {MODES.map((m) => (
                <th key={m} className={`${th} text-right`}>
                  {t(MODE_LABEL[m])}
                </th>
              ))}
              <th className={`${th} text-right`}>{t("dem.col.ptShare")}</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const row = tot.by_period[p]!;
              const all = MODES.reduce((a, m) => a + (row[m] ?? 0), 0);
              return (
                <tr key={p} className="border-b border-slate-100">
                  <td className={td}>{PERIOD_LABEL[p] ? t(PERIOD_LABEL[p]!) : p}</td>
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
              <td className={td}>{t("dem.weekday")}</td>
              {MODES.map((m) => (
                <td key={m} className={num}>
                  {fmt(tot.by_mode[m])}
                </td>
              ))}
              <td className={num}>{pct(tot.by_mode.transit ?? 0, tot.trips)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 className="mt-4 font-medium">{t("dem.byPurpose")}</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("dem.col.purpose")}</th>
              {MODES.map((m) => (
                <th key={m} className={`${th} text-right`}>
                  {t(MODE_LABEL[m])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PURPOSES.filter((p) => tot.by_purpose[p]).map((p) => (
              <tr key={p} className="border-b border-slate-100">
                <td className={td}>{PURPOSE_LABEL[p] ? t(PURPOSE_LABEL[p]!) : p}</td>
                {MODES.map((m) => (
                  <td key={m} className={num}>
                    {fmt(tot.by_purpose[p]![m])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="mt-4 font-medium">{t("dem.lines")}</h4>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={th}>{t("dem.col.line")}</th>
              <th className={th}>{t("dem.col.mode")}</th>
              <th className={`${th} text-right`}>{t("dem.col.boardingsWeekday")}</th>
              <th className={`${th} text-right`} title={t("dem.peakHint")}>
                {t("dem.col.peak")}
              </th>
              <th className={`${th} text-right`} title={t("dem.busiestHint")}>
                {t("dem.col.busiest")}
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
          <h4 className="font-medium">{t("dem.busiestStops")}</h4>
          <table className="mt-1 min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t("dem.col.stop")}</th>
                <th className={`${th} text-right`}>{t("dem.col.boardings")}</th>
                <th className={`${th} text-right`}>{t("dem.col.alightings")}</th>
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
          <h4 className="font-medium">{t("dem.desire")}</h4>
          <table className="mt-1 min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={th}>{t("dem.col.from")}</th>
                <th className={th}>{t("dem.col.to")}</th>
                <th className={`${th} text-right`}>{t("dem.col.ridersWeekday")}</th>
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
        {t("dem.roads", { links: fmt(result.road.links.length), crowded: fmt(crowded) })}
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
            {t("dem.downloadOmx")}
          </a>
        )}
        <span className="text-slate-500">{result.attribution}</span>
      </div>
    </div>
  );
}

/** The GBFS feed of the project's shared-bike scheme: stations it lists are added to OpenStreetMap's. */
function GbfsField({ doc, onDoc }: { doc: DemandDoc | null; onDoc?: (doc: DemandDoc) => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const saved = doc?.gbfsUrl ?? "";
  if (!onDoc && !saved) return null;
  const save = (raw: string) => {
    const v = raw.trim();
    if (v === saved) return;
    if (v && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(v)) {
      setError(t("dem.gbfsInvalid"));
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
        <span className="font-medium">{t("dem.gbfs")}</span>
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
      <p className="mt-1 text-slate-500">{t("dem.gbfsHint")}</p>
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
  const { t } = useI18n();
  const rows: [string, string][] = [
    [
      t("dem.c.cycle"),
      t("dem.c.cycleV", { lanes: fmt(c.cycle_lane_km, 1), tracks: fmt(c.cycle_track_km, 1) }),
    ],
    [t("dem.c.pedestrian"), t("dem.c.km", { v: fmt(c.pedestrian_km, 1) })],
    [t("dem.c.parkings"), fmt(c.bike_parkings)],
    [t("dem.c.sharedStations"), fmt(c.shared_bike_stations)],
    [t("dem.c.steps"), t("dem.c.stepsV", { steps: fmt(c.stops_with_steps), free: fmt(c.stops_step_free) })],
    [t("dem.c.sharedTrips"), fmt(c.shared_bike_trips)],
    [
      t("dem.c.sharedTransit"),
      t("dem.c.sharedTransitV", { to: fmt(c.shared_bike_to_transit), from: fmt(c.shared_bike_from_transit) }),
    ],
    [t("dem.c.bikeRide"), t("dem.c.bikeRideV", { count: fmt(c.bike_and_ride) })],
  ];
  return (
    <div className="mt-4">
      <h4 className="m-0 text-sm font-semibold">{t("dem.c.title")}</h4>
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
  const { t } = useI18n();
  const used = doc?.ridershipRun === runId;
  const other = !!doc?.ridershipRun && !used;
  const set = (id: string | null) => {
    const next: DemandDoc = { ...(doc ?? { source: "auto" }) };
    if (id) next.ridershipRun = id;
    else delete next.ridershipRun;
    onDoc?.(next);
  };
  return (
    <div className={card} aria-label={t("dem.rid.label")}>
      <h3 className="caps m-0">{t("dem.rid.title")}</h3>
      <p className="mt-2 text-sm text-slate-600">
        {used ? t("dem.rid.used") : other ? t("dem.rid.other") : t("dem.rid.formula")}{" "}
        {t("dem.rid.typedFirst")}
      </p>
      {onDoc && (
        <div className="mt-3 flex flex-wrap gap-2">
          {used ? (
            <button type="button" className="btn min-h-10" onClick={() => set(null)}>
              {t("dem.rid.back")}
            </button>
          ) : (
            <button type="button" className="btn btn-pri min-h-10" onClick={() => set(runId)}>
              {t("dem.rid.use")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

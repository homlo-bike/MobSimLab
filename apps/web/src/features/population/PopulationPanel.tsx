import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatInt, useI18n } from "../../i18n/i18n";
import { JobProgress } from "../../shell/JobProgress";
import type {
  Confidence,
  FileOptions,
  LatticeView,
  LayerDetails,
  PopulationApi,
  PopulationLayer,
  PopulationOverview,
} from "./api";
import { type FileFormat, fieldsOf, formatOf, guessField } from "./files";
import { drawArea, drawLattice, legend, removeLattice, scaleTop } from "./mapLayer";

interface Props {
  /** The map; `null` until it has loaded. */
  map: MapLibreMap | null;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** The project's population layers on the server; null while the project loads. */
  api: PopulationApi | null;
  /** Owners and Editors may import, upload and choose. */
  editable: boolean;
  /** Called when the project's primary layer changed, so the readers fetch again. */
  onPrimaryChange?: () => void;
}

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const PEOPLE_WORDS = /pop|people|persons|inhab|resid|einw|habit|total/i;
const ZONE_WORDS = /^(id|code|zone|zone_id|zoneid|gid|fid|name)$/i;

/**
 * The GIS tab's population view (06-gis §3, FR-GIS-04): the project area (the box around everything drawn,
 * widened by the buffer), WorldPop and GHSL imports for it, uploads of the planner's own GeoTIFF, GeoJSON and
 * CSV files, the layer the project uses, and a layer or the difference between two layers on the map.
 */
export function PopulationPanel({ map, panel, api, editable, onPrimaryChange }: Props) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<PopulationOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The layers this panel just started, shown under the button that started them until they are done.
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [lastUpload, setLastUpload] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    setLoadError(null);
    api.overview().then(
      (o) => live && setOverview(o),
      (e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);

  // Follow imports until they end.
  const importing = overview?.layers.some((l) => l.status === "importing") ?? false;
  useEffect(() => {
    if (!api || !importing) return;
    const timer = setInterval(() => {
      api.overview().then(setOverview, () => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [api, importing]);

  // The project area's outline while the view is open.
  const bbox = overview?.area?.bbox ?? null;
  useEffect(() => {
    if (!map) return;
    drawArea(map, bbox);
  }, [map, bbox]);
  useEffect(
    () => () => {
      if (!map) return;
      drawArea(map, null);
      removeLattice(map);
    },
    [map],
  );

  /** Runs a change, shows its error, and keeps the overview current. */
  const run = useCallback(async (f: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    if (api) setOverview(await api.overview());
  }, [api]);

  const ready = useMemo(() => overview?.layers.filter((l) => l.status === "ready") ?? [], [overview]);
  const primary = ready.find((l) => l.isPrimary) ?? null;

  let content: ReactNode;
  if (!api || (!overview && !loadError)) content = <p role="status">{t("pop.loading")}</p>;
  else if (!overview)
    content = (
      <div role="alert" className="text-sm text-red-700">
        <p>{t("pop.failed", { error: loadError ?? "" })}</p>
        <button type="button" className="btn mt-2 min-h-10" onClick={() => setAttempt((n) => n + 1)}>
          {t("pop.retry")}
        </button>
      </div>
    );
  else
    content = (
      <>
        <AreaSection
          overview={overview}
          editable={editable}
          busy={busy}
          onBuffer={(km) => run(async () => setOverview(await api.setBuffer(km)))}
        />
        <section aria-labelledby="pop-primary" className="flex flex-col gap-1">
          <h3 id="pop-primary" className="font-semibold">
            {t("pop.primary.title")}
          </h3>
          <p className="text-xs text-slate-500">{t("pop.primary.hint")}</p>
          <select
            className="input mt-1 w-full"
            value={primary?.id ?? ""}
            disabled={!editable || busy}
            aria-label={t("pop.primary.title")}
            onChange={(e) =>
              run(async () => {
                await api.setPrimary(e.target.value || null);
                await refresh();
              }, onPrimaryChange)
            }
          >
            <option value="">{t("pop.primary.live")}</option>
            {ready.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </section>
        {editable && (
          <ImportSection
            overview={overview}
            busy={busy}
            latest={overview.layers.find((l) => l.id === lastImport) ?? null}
            onImport={(req) =>
              run(async () => {
                setLastImport((await api.startImport(req)).id);
                await refresh();
              })
            }
          />
        )}
        {editable && (
          <UploadSection
            overview={overview}
            busy={busy}
            latest={overview.layers.find((l) => l.id === lastUpload) ?? null}
            onUpload={(details, file, bytes) =>
              run(async () => {
                setLastUpload((await api.upload(details, file, bytes)).id);
                await refresh();
              })
            }
          />
        )}
        <section aria-labelledby="pop-layers" className="flex flex-col gap-2">
          <h3 id="pop-layers" className="font-semibold">
            {t("pop.layers.title")}
          </h3>
          {overview.layers.length === 0 && <p className="text-sm text-slate-600">{t("pop.layers.none")}</p>}
          {overview.layers.map((l) => (
            <LayerCard
              key={l.id}
              layer={l}
              editable={editable}
              busy={busy}
              onUse={() =>
                run(async () => {
                  await api.setPrimary(l.id);
                  await refresh();
                }, onPrimaryChange)
              }
              onSave={(patch) =>
                run(async () => {
                  await api.update(l.id, patch);
                  await refresh();
                })
              }
              onDelete={() =>
                window.confirm(t("pop.layer.confirmDelete", { name: l.name })) &&
                run(
                  async () => {
                    await api.remove(l.id);
                    await refresh();
                  },
                  l.isPrimary ? onPrimaryChange : undefined,
                )
              }
            />
          ))}
        </section>
        {ready.length > 0 && <CompareSection map={map} api={api} layers={ready} />}
      </>
    );

  const body = (
    <div className="flex flex-col gap-5 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("pop.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("pop.intro")}</p>
      </div>
      {error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
          {t("pop.error", { error })}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-slate-600">
          {t("pop.busy")}
        </p>
      )}
      {content}
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}

function AreaSection({
  overview,
  editable,
  busy,
  onBuffer,
}: {
  overview: PopulationOverview;
  editable: boolean;
  busy: boolean;
  onBuffer: (km: number) => void;
}) {
  const { t } = useI18n();
  const [km, setKm] = useState(String(overview.bufferKm));
  useEffect(() => setKm(String(overview.bufferKm)), [overview.bufferKm]);
  const value = Number(km);
  const valid = km.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 50;
  const tooLarge = overview.areaKm2 !== null && overview.areaKm2 > overview.choices.maxAreaKm2;
  return (
    <section aria-labelledby="pop-area" className="flex flex-col gap-1">
      <h3 id="pop-area" className="font-semibold">
        {t("pop.area.title")}
      </h3>
      {overview.area ? (
        <p className="text-sm text-slate-600">
          {t("pop.area.box", { km2: formatInt(Math.round(overview.areaKm2 ?? 0)) })}
        </p>
      ) : (
        <p className="text-sm text-amber-800">{t("pop.area.none")}</p>
      )}
      {tooLarge && (
        <p className="text-sm text-amber-800">
          {t("pop.area.tooLarge", { max: formatInt(overview.choices.maxAreaKm2) })}
        </p>
      )}
      <div className="mt-1 flex items-end gap-2">
        <label className="text-sm">
          <span className="font-medium">{t("pop.area.buffer")}</span>
          <input
            type="number"
            min={0}
            max={50}
            step="any"
            className="input mt-1 w-28"
            value={km}
            readOnly={!editable}
            onChange={(e) => setKm(e.target.value)}
          />
        </label>
        {editable && (
          <button
            type="button"
            className="btn min-h-10"
            disabled={busy || !valid || value === overview.bufferKm}
            onClick={() => onBuffer(value)}
          >
            {t("pop.area.save")}
          </button>
        )}
      </div>
    </section>
  );
}

function ImportSection({
  overview,
  busy,
  latest,
  onImport,
}: {
  overview: PopulationOverview;
  busy: boolean;
  /** The layer this section last started: its progress, then what it brought or why it failed. */
  latest: PopulationLayer | null;
  onImport: (req: Parameters<PopulationApi["startImport"]>[0]) => void;
}) {
  const { t } = useI18n();
  const c = overview.choices;
  const now = new Date().getFullYear();
  const nearest = c.ghslEpochs.reduce(
    (b, e) => (Math.abs(e - now) < Math.abs(b - now) ? e : b),
    c.ghslEpochs[0] ?? 2025,
  );
  const [source, setSource] = useState<"worldpop" | "ghsl">("worldpop");
  const [year, setYear] = useState(Math.min(c.worldpopYears.last, Math.max(c.worldpopYears.first, now)));
  const [epoch, setEpoch] = useState(nearest);
  const [resolution, setResolution] = useState<"3ss" | "30ss">("3ss");
  const [confidence, setConfidence] = useState<Confidence>("medium");
  const blocked = !overview.area || (overview.areaKm2 ?? 0) > c.maxAreaKm2;
  return (
    <section
      aria-labelledby="pop-import"
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3"
    >
      <h3 id="pop-import" className="font-semibold">
        {t("pop.import.title")}
      </h3>
      <label className="text-sm">
        <span className="font-medium">{t("pop.import.source")}</span>
        <select
          className="input mt-1 w-full"
          value={source}
          onChange={(e) => setSource(e.target.value as "worldpop" | "ghsl")}
        >
          <option value="worldpop">{t("pop.import.worldpop")}</option>
          <option value="ghsl">{t("pop.import.ghsl")}</option>
        </select>
      </label>
      {source === "worldpop" ? (
        <label className="text-sm">
          <span className="font-medium">{t("pop.import.year")}</span>
          <input
            type="number"
            className="input mt-1 w-28"
            min={c.worldpopYears.first}
            max={c.worldpopYears.last}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
      ) : (
        <div className="flex flex-wrap gap-2">
          <label className="text-sm">
            <span className="font-medium">{t("pop.import.epoch")}</span>
            <select className="input mt-1" value={epoch} onChange={(e) => setEpoch(Number(e.target.value))}>
              {c.ghslEpochs.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">{t("pop.import.resolution")}</span>
            <select
              className="input mt-1"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as "3ss" | "30ss")}
            >
              <option value="3ss">{t("pop.import.res3ss")}</option>
              <option value="30ss">{t("pop.import.res30ss")}</option>
            </select>
          </label>
        </div>
      )}
      <ConfidenceSelect value={confidence} onChange={setConfidence} />
      <button
        type="button"
        className="btn btn-pri min-h-10 self-start"
        disabled={
          busy ||
          blocked ||
          (source === "worldpop" && !(year >= c.worldpopYears.first && year <= c.worldpopYears.last))
        }
        onClick={() =>
          onImport(
            source === "worldpop" ? { source, year, confidence } : { source, epoch, resolution, confidence },
          )
        }
      >
        {t("pop.import.start")}
      </button>
      {latest && <LayerOutcome layer={latest} />}
    </section>
  );
}

function ConfidenceSelect({ value, onChange }: { value: Confidence; onChange: (c: Confidence) => void }) {
  const { t } = useI18n();
  return (
    <label className="text-sm">
      <span className="font-medium">{t("pop.confidence")}</span>
      <select
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value as Confidence)}
      >
        {CONFIDENCES.map((c) => (
          <option key={c} value={c}>
            {t(`pop.confidence.${c}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldSelect({
  label,
  fields,
  value,
  onChange,
  optional,
}: {
  label: string;
  fields: string[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="font-medium">{label}</span>
      {fields.length ? (
        <select className="input mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
          {optional && <option value="">—</option>}
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      ) : (
        <input className="input mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function UploadSection({
  overview,
  busy,
  latest,
  onUpload,
}: {
  overview: PopulationOverview;
  busy: boolean;
  /** The layer this section last uploaded: its progress, then what it brought or why it failed. */
  latest: PopulationLayer | null;
  onUpload: (details: LayerDetails, file: FileOptions, bytes: Blob) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<FileFormat | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [details, setDetails] = useState<LayerDetails>({
    name: "",
    licence: "",
    sourceUrl: "",
    citation: "",
    confidence: "medium",
    referenceYear: new Date().getFullYear(),
  });
  const [values, setValues] = useState<"count" | "density_km2">("count");
  const [clip, setClip] = useState(true);
  const [crs, setCrs] = useState("");
  const [people, setPeople] = useState("");
  const [zone, setZone] = useState("");
  const [mode, setMode] = useState<"points" | "zones">("points");
  const [lon, setLon] = useState("");
  const [lat, setLat] = useState("");
  const zoneLayers = overview.layers.filter(
    (l) => l.status === "ready" && l.kind === "zones" && l.options.format === "geojson",
  );
  const [zonesLayer, setZonesLayer] = useState("");
  const tooBig = !!file && file.size > overview.choices.maxUploadMb * 1024 * 1024;

  const choose = async (f: File | null) => {
    setFile(f);
    const fmt = f ? formatOf(f.name) : null;
    setFormat(fmt);
    setFields([]);
    if (!f || !fmt) return;
    setDetails((d) => ({ ...d, name: f.name.replace(/\.[^.]+$/, "").slice(0, 200) || d.name }));
    const list = await fieldsOf(f, fmt).catch(() => [] as string[]);
    setFields(list);
    setPeople(guessField(list, PEOPLE_WORDS));
    setZone(list.find((x) => ZONE_WORDS.test(x)) ?? "");
    setLon(guessField(list, /^(lon|lng|long|longitude|x)$/i));
    setLat(guessField(list, /^(lat|latitude|y)$/i));
  };

  const options = (): FileOptions | null => {
    const own = crs.trim() || undefined;
    if (format === "geotiff") return { format, values, clipToArea: clip, crs: own };
    if (format === "geojson")
      return people ? { format, peopleField: people, zoneField: zone || undefined, crs: own } : null;
    if (format === "csv" && mode === "points")
      return people && lon && lat
        ? { format, mode, lonField: lon, latField: lat, peopleField: people, crs: own }
        : null;
    if (format === "csv" && mode === "zones")
      return people && zone && zonesLayer
        ? { format, mode, zoneField: zone, peopleField: people, zonesLayerId: zonesLayer }
        : null;
    return null;
  };
  const opts = options();
  const text = (k: keyof LayerDetails, label: string) => (
    <label className="text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="input mt-1 w-full"
        value={String(details[k] ?? "")}
        onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
      />
    </label>
  );
  return (
    <section
      aria-labelledby="pop-upload"
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3"
    >
      <h3 id="pop-upload" className="font-semibold">
        {t("pop.upload.title")}
      </h3>
      <p className="text-xs text-slate-500">{t("pop.upload.hint", { mb: overview.choices.maxUploadMb })}</p>
      {/* The browser's own file control does not follow the app's buttons: a button opens it instead. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          aria-label={t("pop.upload.file")}
          accept=".tif,.tiff,.geojson,.json,.csv,.tsv,.txt"
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn min-h-10"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {t("pop.upload.choose")}
        </button>
        {file && <span className="min-w-0 truncate text-slate-700">{file.name}</span>}
      </div>
      {file && !format && <p className="text-sm text-amber-800">{t("pop.upload.unknown")}</p>}
      {file && format && (
        <>
          {text("name", t("pop.upload.name"))}
          {format === "geotiff" && (
            <>
              <label className="text-sm">
                <span className="font-medium">{t("pop.upload.values")}</span>
                <select
                  className="input mt-1 w-full"
                  value={values}
                  onChange={(e) => setValues(e.target.value as "count" | "density_km2")}
                >
                  <option value="count">{t("pop.upload.count")}</option>
                  <option value="density_km2">{t("pop.upload.density")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} />
                {t("pop.upload.clip")}
              </label>
            </>
          )}
          {format === "csv" && (
            <label className="text-sm">
              <span className="font-medium">{t("pop.upload.mode")}</span>
              <select
                className="input mt-1 w-full"
                value={mode}
                onChange={(e) => setMode(e.target.value as "points" | "zones")}
              >
                <option value="points">{t("pop.upload.modePoints")}</option>
                <option value="zones">{t("pop.upload.modeZones")}</option>
              </select>
            </label>
          )}
          {format !== "geotiff" && (
            <FieldSelect
              label={t("pop.upload.peopleField")}
              fields={fields}
              value={people}
              onChange={setPeople}
            />
          )}
          {format === "geojson" && (
            <FieldSelect
              label={t("pop.upload.zoneField")}
              fields={fields}
              value={zone}
              onChange={setZone}
              optional
            />
          )}
          {format === "csv" && mode === "points" && (
            <>
              <FieldSelect label={t("pop.upload.lonField")} fields={fields} value={lon} onChange={setLon} />
              <FieldSelect label={t("pop.upload.latField")} fields={fields} value={lat} onChange={setLat} />
            </>
          )}
          {format === "csv" && mode === "zones" && (
            <>
              <FieldSelect
                label={t("pop.upload.zoneColumn")}
                fields={fields}
                value={zone}
                onChange={setZone}
              />
              {zoneLayers.length ? (
                <label className="text-sm">
                  <span className="font-medium">{t("pop.upload.zonesLayer")}</span>
                  <select
                    className="input mt-1 w-full"
                    value={zonesLayer}
                    onChange={(e) => setZonesLayer(e.target.value)}
                  >
                    <option value="">—</option>
                    {zoneLayers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-sm text-amber-800">{t("pop.upload.noZones")}</p>
              )}
            </>
          )}
          {!(format === "csv" && mode === "zones") && (
            <label className="text-sm">
              <span className="font-medium">{t("pop.upload.crs")}</span>
              <span className="block text-xs text-slate-500">{t("pop.upload.crsHint")}</span>
              <textarea
                className="input mt-1 w-full"
                rows={2}
                value={crs}
                onChange={(e) => setCrs(e.target.value)}
              />
            </label>
          )}
          {text("licence", t("pop.upload.licence"))}
          {text("sourceUrl", t("pop.upload.sourceUrl"))}
          {text("citation", t("pop.upload.citation"))}
          <label className="text-sm">
            <span className="font-medium">{t("pop.upload.year")}</span>
            <input
              type="number"
              className="input mt-1 w-28"
              min={1800}
              max={2200}
              value={details.referenceYear ?? ""}
              onChange={(e) =>
                setDetails((d) => ({
                  ...d,
                  referenceYear: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </label>
          <ConfidenceSelect
            value={details.confidence}
            onChange={(c) => setDetails((d) => ({ ...d, confidence: c }))}
          />
          {tooBig && (
            <p className="text-sm text-amber-800">
              {t("pop.upload.hint", { mb: overview.choices.maxUploadMb })}
            </p>
          )}
          <button
            type="button"
            className="btn btn-pri min-h-10 self-start"
            disabled={busy || !opts || !details.name.trim() || tooBig}
            onClick={() => opts && onUpload({ ...details, name: details.name.trim() }, opts, file)}
          >
            {busy ? t("pop.upload.sending") : t("pop.upload.send")}
          </button>
        </>
      )}
      {latest && <LayerOutcome layer={latest} />}
    </section>
  );
}

/**
 * Purpose: right under Import or Upload, what the layer just started is doing and how it ended: a progress bar
 * while it imports (download, then storing the cells), then its name and the people it brought, or why it failed.
 */
function LayerOutcome({ layer: l }: { layer: PopulationLayer }) {
  const { t } = useI18n();
  if (l.status === "importing") return <LayerProgress layer={l} />;
  if (l.status === "failed")
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {t("pop.status.failed", { error: l.error ?? "" })}
      </p>
    );
  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
    >
      <p className="flex items-start gap-1.5 font-medium">
        <span aria-hidden="true">✓</span>
        <span className="min-w-0 break-words">{l.name}</span>
        {l.isPrimary && (
          <span className="ms-auto shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-normal text-violet-900">
            {t("pop.layer.primary")}
          </span>
        )}
      </p>
      <p>
        {t("pop.layer.people", {
          people: formatInt(Math.round(l.peopleTotal)),
          n: formatInt(l.featureCount),
        })}
      </p>
    </div>
  );
}

/** Purpose: a layer's import as a progress bar: step 1 downloads (filled by the bytes when known), step 2 stores. */
function LayerProgress({ layer: l }: { layer: PopulationLayer }) {
  const { t } = useI18n();
  const p = l.progress;
  const storing = p?.step === "store";
  const fraction =
    !storing && p?.receivedBytes !== undefined && p.totalBytes
      ? Math.min(1, p.receivedBytes / p.totalBytes)
      : null;
  return (
    <JobProgress
      label={l.name}
      step={progressText(l, t)}
      index={storing ? 2 : 1}
      steps={2}
      fraction={fraction}
    />
  );
}

function progressText(l: PopulationLayer, t: ReturnType<typeof useI18n>["t"]): string {
  const p = l.progress;
  const mb = (b: number) => formatInt(Math.round(b / 1e6));
  if (p?.step === "download" && p.receivedBytes !== undefined)
    return p.totalBytes
      ? t("pop.status.download", { got: mb(p.receivedBytes), total: mb(p.totalBytes) })
      : t("pop.status.downloadOpen", { got: mb(p.receivedBytes) });
  if (p?.step === "store") return t("pop.status.store");
  return t("pop.status.importing");
}

function LayerCard({
  layer: l,
  editable,
  busy,
  onUse,
  onSave,
  onDelete,
}: {
  layer: PopulationLayer;
  editable: boolean;
  busy: boolean;
  onUse: () => void;
  onSave: (patch: Partial<LayerDetails>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LayerDetails>({
    name: l.name,
    licence: l.licence,
    sourceUrl: l.sourceUrl,
    citation: l.citation,
    confidence: l.confidence,
    referenceYear: l.referenceYear,
  });
  const facts = [
    `${t(`pop.source.${l.source}`)} · ${t(`pop.kind.${l.kind}`)}`,
    l.referenceYear !== null ? t("pop.layer.year", { year: l.referenceYear }) : null,
    l.resolutionM ? t("pop.layer.resolution", { m: formatInt(Math.round(l.resolutionM)) }) : null,
    `${t("pop.confidence")}: ${t(`pop.confidence.${l.confidence}`)}`,
  ].filter(Boolean);
  return (
    <article aria-label={l.name} className="rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{l.name}</p>
          <p className="text-xs text-slate-500">{facts.join(" · ")}</p>
        </div>
        {l.isPrimary && (
          <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-900">
            {t("pop.layer.primary")}
          </span>
        )}
      </div>
      {l.status === "importing" && (
        <div className="mt-1">
          <LayerProgress layer={l} />
        </div>
      )}
      {l.status === "failed" && (
        <p role="alert" className="mt-1 text-red-700">
          {t("pop.status.failed", { error: l.error ?? "" })}
        </p>
      )}
      {l.status === "ready" && (
        <p className="mt-1">
          {t("pop.layer.people", {
            people: formatInt(Math.round(l.peopleTotal)),
            n: formatInt(l.featureCount),
          })}
        </p>
      )}
      {l.licence && (
        <p className="mt-1 text-xs text-slate-500">{t("pop.layer.licence", { licence: l.licence })}</p>
      )}
      {l.citation && <p className="mt-1 text-xs break-words text-slate-500">{l.citation}</p>}
      {(l.options.notes ?? []).map((n) => (
        <p key={n} className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {n}
        </p>
      ))}
      {editable && editing && (
        <div className="mt-2 flex flex-col gap-2">
          {(["name", "licence", "sourceUrl", "citation"] as const).map((k) => (
            <label key={k} className="text-sm">
              <span className="font-medium">
                {t(
                  k === "name"
                    ? "pop.upload.name"
                    : k === "licence"
                      ? "pop.upload.licence"
                      : k === "sourceUrl"
                        ? "pop.upload.sourceUrl"
                        : "pop.upload.citation",
                )}
              </span>
              <input
                className="input mt-1 w-full"
                value={draft[k]}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
            </label>
          ))}
          <label className="text-sm">
            <span className="font-medium">{t("pop.upload.year")}</span>
            <input
              type="number"
              className="input mt-1 w-28"
              value={draft.referenceYear ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  referenceYear: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </label>
          <ConfidenceSelect
            value={draft.confidence}
            onChange={(c) => setDraft((d) => ({ ...d, confidence: c }))}
          />
        </div>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap gap-2">
          {l.status === "ready" && !l.isPrimary && (
            <button type="button" className="btn min-h-10" disabled={busy} onClick={onUse}>
              {t("pop.layer.use")}
            </button>
          )}
          {editing ? (
            <button
              type="button"
              className="btn btn-pri min-h-10"
              disabled={busy || !draft.name.trim()}
              onClick={() => {
                onSave({ ...draft, name: draft.name.trim() });
                setEditing(false);
              }}
            >
              {t("pop.layer.save")}
            </button>
          ) : (
            <button type="button" className="btn min-h-10" disabled={busy} onClick={() => setEditing(true)}>
              {t("pop.layer.edit")}
            </button>
          )}
          <button
            type="button"
            className="btn min-h-10"
            disabled={busy || l.status === "importing"}
            onClick={onDelete}
          >
            {t("pop.layer.delete")}
          </button>
        </div>
      )}
    </article>
  );
}

function CompareSection({
  map,
  api,
  layers,
}: {
  map: MapLibreMap | null;
  api: PopulationApi;
  layers: PopulationLayer[];
}) {
  const { t } = useI18n();
  const [layerId, setLayerId] = useState(layers[0]!.id);
  const [minusId, setMinusId] = useState("");
  const [cellM, setCellM] = useState("500");
  const [shown, setShown] = useState<{ view: LatticeView; diff: boolean; top: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A layer that was deleted is no longer offered.
  useEffect(() => {
    if (!layers.some((l) => l.id === layerId)) setLayerId(layers[0]!.id);
    if (minusId && !layers.some((l) => l.id === minusId)) setMinusId("");
  }, [layers, layerId, minusId]);
  useEffect(() => {
    if (map) drawLattice(map, shown?.view ?? null, shown?.diff ?? false);
  }, [map, shown]);
  const cell = Number(cellM);
  const validCell = Number.isFinite(cell) && cell >= 90 && cell <= 20_000;
  const show = async () => {
    setLoading(true);
    setError(null);
    try {
      const view = await api.lattice(layerId, minusId || null, cell);
      setShown({ view, diff: !!minusId, top: scaleTop(view.grid.values) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  const entries = shown ? legend(shown.diff, shown.top) : [];
  return (
    <section
      aria-labelledby="pop-compare"
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3"
    >
      <h3 id="pop-compare" className="font-semibold">
        {t("pop.compare.title")}
      </h3>
      <p className="text-xs text-slate-500">{t("pop.compare.hint")}</p>
      <label className="text-sm">
        <span className="font-medium">{t("pop.compare.layer")}</span>
        <select className="input mt-1 w-full" value={layerId} onChange={(e) => setLayerId(e.target.value)}>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="font-medium">{t("pop.compare.minus")}</span>
        <select className="input mt-1 w-full" value={minusId} onChange={(e) => setMinusId(e.target.value)}>
          <option value="">{t("pop.compare.nothing")}</option>
          {layers
            .filter((l) => l.id !== layerId)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="font-medium">{t("pop.compare.cell")}</span>
        <input
          type="number"
          min={90}
          max={20000}
          step={10}
          className="input mt-1 w-28"
          value={cellM}
          onChange={(e) => setCellM(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-pri min-h-10"
          disabled={loading || !validCell}
          onClick={() => void show()}
        >
          {t("pop.compare.show")}
        </button>
        {shown && (
          <button type="button" className="btn min-h-10" onClick={() => setShown(null)}>
            {t("pop.compare.hide")}
          </button>
        )}
      </div>
      {loading && <p role="status">{t("pop.busy")}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t("pop.error", { error })}
        </p>
      )}
      {shown && (
        <figure className="text-xs">
          <figcaption className="font-medium">
            {t(shown.diff ? "pop.compare.diffLegend" : "pop.compare.peopleLegend", {
              m: formatInt(shown.view.cellM),
            })}
          </figcaption>
          <ul className="mt-1 flex flex-wrap gap-2">
            {entries.map((e) => (
              <li key={e.value} className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-4 rounded-sm border border-slate-300"
                  style={{ background: e.color }}
                />
                {e.value > 0 && shown.diff ? "+" : ""}
                {formatInt(Math.round(e.value))}
              </li>
            ))}
          </ul>
        </figure>
      )}
    </section>
  );
}

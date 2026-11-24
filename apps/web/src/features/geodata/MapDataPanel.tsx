import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/i18n";
import { JobProgress } from "../../shell/JobProgress";
import type { GeodataApi, GeodataStatus, GeofabrikRegion, ImportRun } from "./api";
import { engineErrorText } from "../../i18n/engine";

const POLL_MS = 2_000;

type Method = "overpass" | "geofabrik" | "upload";

type ImportStep = NonNullable<ImportRun["progress"]["step"]>;
const ALL_STEPS: ImportStep[] = ["download", "merge", "extract", "database"];
/**
 * Purpose: the steps an import goes through, in order (apps/api geodata.service.ts), so its bar can say how far
 * it is: Overpass tiles are downloaded, joined and written; a Geofabrik extract is downloaded, cut out and
 * written; an uploaded file is cut out and written; elevation is downloaded cell by cell, or an uploaded grid
 * is read and written. A step the list does not expect falls back to every step.
 */
function importSteps(r: ImportRun): ImportStep[] {
  const known: ImportStep[] =
    r.kind === "dem"
      ? ["download"]
      : r.kind === "dem_upload"
        ? ["extract", "database"]
        : r.method === "overpass"
          ? ["download", "merge", "database"]
          : r.method === "geofabrik"
            ? ["download", "extract", "database"]
            : ["extract", "database"];
  return r.progress.step && !known.includes(r.progress.step) ? ALL_STEPS : known;
}

/**
 * Purpose: what a running import is doing and how far it is, for its progress bar (the Map data panel's and the
 * bar at the bottom of the project). Inputs: the run, the translator and the language for numbers.
 */
export function importProgress(
  r: ImportRun,
  t: ReturnType<typeof useI18n>["t"],
  locale: string,
): { label: string; step: string; index: number; steps: number; fraction: number | null } {
  const p = r.progress;
  const steps = importSteps(r);
  const at = p.step ? steps.indexOf(p.step) : 0;
  const num = (n: number) => n.toLocaleString(locale);
  const step =
    r.status === "queued"
      ? t("data.queued")
      : p.step === "download" && p.total
        ? t("data.step.downloadN", {
            done: r.method === "geofabrik" ? `${Math.round((p.done ?? 0) / 1e6)} MB` : num(p.done ?? 0),
            total: r.method === "geofabrik" ? `${Math.round(p.total / 1e6)} MB` : num(p.total),
          })
        : p.step === "merge"
          ? t("data.step.merge")
          : p.step === "extract"
            ? t("data.step.extract")
            : p.step === "database"
              ? t("data.step.database")
              : t("data.step.download");
  return {
    label: t(r.kind === "osm" ? "data.osm" : "data.dem"),
    step,
    index: r.status === "queued" ? 1 : Math.max(0, at) + 1,
    steps: steps.length,
    fraction:
      r.status !== "queued" && p.step === "download" && p.total ? Math.min(1, (p.done ?? 0) / p.total) : null,
  };
}

/** Purpose: whether an import is waiting or running. */
export const importBusy = (r: ImportRun | null | undefined) =>
  r?.status === "queued" || r?.status === "running";

/**
 * The Map data view of the GIS tab (ADR-0046): the project area (its polygons; the map draws their edges as the
 * Project area layer), and the OpenStreetMap and elevation imports of it, with their state, source and licence. Owners and
 * Editors start and cancel imports; the panel follows a running import until it ends.
 */
export function MapDataPanel({
  api,
  panel = null,
  onOsmImport,
}: {
  api: GeodataApi;
  /** Where the side panel renders; inline when `null`. */
  panel?: HTMLElement | null;
  /** Called with the current OpenStreetMap import when it changes, so the map tools read the new data. */
  onOsmImport?: (importId: string | null) => void;
}) {
  const { t, language: locale } = useI18n();
  const [status, setStatus] = useState<GeodataStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Imports the planner asked to cancel, shown as stopping until the server reports them finished.
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [method, setMethod] = useState<Method | null>(null);
  const [regions, setRegions] = useState<GeofabrikRegion[] | null>(null);
  /** Why Geofabrik's region list could not be had (it cannot be reached), so "no region holds the area" is not said. */
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [planned, setPlanned] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const demFileRef = useRef<HTMLInputElement>(null);
  const [own, setOwn] = useState({ crs: "", source: "", licence: "", accuracy: "" });
  const lastOsm = useRef<string | null | undefined>(undefined);
  const onOsm = useRef(onOsmImport);
  onOsm.current = onOsmImport;

  const load = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      setError(null);
      const id = s.osm.current?.id ?? null;
      if (lastOsm.current !== id) {
        lastOsm.current = id;
        onOsm.current?.(id);
      }
    } catch (e) {
      setError(engineErrorText(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow a running import.
  const running =
    importBusy(status?.osm.latest) || importBusy(status?.dem.latest) || importBusy(status?.demUpload.latest);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
  }, [running, status, load]);

  const accuracyValue = own.accuracy.trim() === "" ? null : Number(own.accuracy);
  const ownValid = accuracyValue === null || (Number.isFinite(accuracyValue) && accuracyValue >= 0);

  const tooLarge = !!status?.area && status.area.areaKm2 > status.limits.overpassMaxKm2;
  const suggested: Method = status?.suggestedMethod ?? "overpass";
  // Until the planner picks one: the suggested method, but not Geofabrik once it cannot be reached.
  const chosen: Method =
    method ?? (suggested === "geofabrik" && regionsError ? (tooLarge ? "upload" : "overpass") : suggested);
  useEffect(() => {
    if (chosen !== "geofabrik" || regions !== null || !status?.area) return;
    api.regions().then(
      (r) => {
        setRegions(r);
      },
      (e: Error) => {
        setRegions([]);
        setRegionsError(e.message);
      },
    );
  }, [api, chosen, regions, status?.area]);

  const run = async (fn: () => Promise<unknown>) => {
    setSending(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(engineErrorText(e));
    } finally {
      setSending(false);
    }
  };

  const date = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "";
  const num = (n: number) => n.toLocaleString(locale);

  const lastProblem = (latest: ImportRun | null, current: ImportRun | null) => {
    if (!latest || latest.id === current?.id) return null;
    if (latest.status === "failed")
      return (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {t("data.failed", { error: latest.error ?? "" })}
        </p>
      );
    if (latest.status === "cancelled")
      return <p className="mt-2 text-sm text-slate-600">{t("data.cancelled")}</p>;
    return null;
  };

  const runningLine = (r: ImportRun | null) => {
    if (!importBusy(r)) return null;
    // Cancel answers at once; the server stops the download under way and the next poll shows it cancelled.
    const isStopping = stopping.has(r!.id);
    const job = importProgress(r!, t, locale);
    return (
      <div className="mt-2">
        <JobProgress
          label={job.label}
          step={isStopping ? t("capacity.stopping") : job.step}
          index={job.index}
          steps={job.steps}
          fraction={job.fraction}
          jobKey={`import:${r!.id}`}
          onCancel={
            status?.canImport && !isStopping
              ? () => {
                  const id = r!.id;
                  setStopping((x) => new Set(x).add(id));
                  void run(async () => {
                    try {
                      await api.cancel(id);
                    } catch (e) {
                      // The cancel did not go through: show the run as it is, with its Cancel again.
                      setStopping((x) => {
                        const next = new Set(x);
                        next.delete(id);
                        return next;
                      });
                      throw e;
                    }
                  });
                }
              : undefined
          }
        />
      </div>
    );
  };

  const osm = status?.osm;
  const dem = status?.dem;
  const demUpload = status?.demUpload;
  const ownGrid = demUpload?.current ?? null;
  const rows = osm?.current?.stats.rows ?? {};

  const body = (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-6 md:px-5">
      <div>
        <h2 className="text-lg font-semibold">{t("data.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("data.intro")}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {status && !status.area && (
        <p className="rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-sm text-slate-600">
          {t("aw.data.noArea")}
        </p>
      )}
      {status?.area && (
        <p className="text-sm text-slate-700">
          {t("aw.data.area", {
            names: status.area.polygons.map((r) => r.name).join(", "),
            area: num(status.area.areaKm2),
          })}
        </p>
      )}
      {status && !status.canImport && <p className="text-sm text-slate-600">{t("data.readOnly")}</p>}

      {status && (
        <section aria-labelledby="data-osm">
          <h3 id="data-osm" className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            {t("data.osm")}
          </h3>
          {osm?.current ? (
            <p className="mt-1 text-sm text-slate-700">
              {t("data.imported", { date: date(osm.current.finishedAt) })}
              {osm.current.source.dataTimestamp
                ? ` · ${t("data.dataDate", { date: date(osm.current.source.dataTimestamp) })}`
                : ""}
              {osm.current.source.via ? ` · ${osm.current.source.via}` : ""}
              <br />
              <span className="text-xs text-slate-500">
                {t("data.counts", {
                  roads: num(rows.osm_way_road ?? 0),
                  rails: num(rows.osm_way_rail ?? 0),
                  buildings: num(rows.osm_building ?? 0),
                  stops: num(rows.osm_pt ?? 0),
                })}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">{t("data.notImported")}</p>
          )}
          {osm?.current && osm.coversDrawing === false && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t("data.outside")}
            </p>
          )}
          {lastProblem(osm?.latest ?? null, osm?.current ?? null)}
          {runningLine(osm?.latest ?? null)}
          {status.canImport && status.area && !importBusy(osm?.latest) && (
            <div className="mt-3 flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("data.method")}</span>
                <span className="field">
                  <select value={chosen} onChange={(e) => setMethod(e.target.value as Method)}>
                    <option value="overpass" disabled={tooLarge}>
                      {t("data.method.overpass", { max: num(status.limits.overpassMaxKm2) })}
                    </option>
                    <option value="geofabrik">{t("data.method.geofabrik")}</option>
                    <option value="upload">{t("data.method.upload")}</option>
                  </select>
                </span>
              </label>
              {chosen !== "geofabrik" && regionsError && (
                <p role="alert" className="text-sm text-red-700">
                  {regionsError}
                </p>
              )}
              {chosen === "overpass" && tooLarge && (
                <p className="text-sm text-amber-900">
                  {t("data.tooLarge", { area: num(status.area.areaKm2) })}
                </p>
              )}
              {chosen === "geofabrik" && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("aw.data.regions")}</span>
                  {regions === null ? (
                    <span role="status" className="text-slate-600">
                      {t("data.regionsLoading")}
                    </span>
                  ) : regionsError ? (
                    <span role="alert" className="text-red-700">
                      {regionsError}
                    </span>
                  ) : regions.length === 0 ? (
                    <span className="text-slate-600">{t("data.noRegions")}</span>
                  ) : (
                    <>
                      <span>{regions.map((r) => r.name).join(", ")}</span>
                      <span className="text-xs text-slate-500">{t("aw.data.regionsHelp")}</span>
                    </>
                  )}
                </div>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />
                {t("data.planned")}
              </label>
              {chosen === "upload" ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pbf,.osm.pbf"
                    className="sr-only"
                    aria-label={t("data.chooseFile", { max: num(status.limits.maxPbfMb) })}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void run(() => api.uploadPbf(f, planned));
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-pri"
                    disabled={sending}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t("data.chooseFile", { max: num(status.limits.maxPbfMb) })}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-pri"
                  disabled={
                    sending ||
                    (chosen === "overpass" && tooLarge) ||
                    (chosen === "geofabrik" && !regions?.length)
                  }
                  onClick={() =>
                    run(() =>
                      api.startOsm(
                        chosen === "geofabrik"
                          ? { method: "geofabrik", planned }
                          : { method: "overpass", planned },
                      ),
                    )
                  }
                >
                  {osm?.current ? t("data.refresh") : t("data.import")}
                </button>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">{t("data.licence")}</p>
        </section>
      )}

      {status && (
        <section aria-labelledby="data-dem">
          <h3 id="data-dem" className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            {t("data.dem")}
          </h3>
          {dem?.current ? (
            <p className="mt-1 text-sm text-slate-700">
              {t("data.imported", { date: date(dem.current.finishedAt) })}
              <br />
              <span className="text-xs text-slate-500">
                {t("data.demFacts", {
                  res: num(dem.current.source.resolutionM ?? 30),
                  acc: num(dem.current.source.verticalAccuracyM ?? 4),
                })}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">{t("data.notImported")}</p>
          )}
          {!!dem?.current?.stats.cellsWithoutData && (
            <p className="mt-1 text-xs text-slate-500">
              {t("data.demNoData", { n: num(dem.current.stats.cellsWithoutData) })}
            </p>
          )}
          {dem?.current && dem.coversDrawing === false && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t("data.outside")}
            </p>
          )}
          {lastProblem(dem?.latest ?? null, dem?.current ?? null)}
          {runningLine(dem?.latest ?? null)}
          {status.canImport && status.area && !importBusy(dem?.latest) && (
            <button
              type="button"
              className="btn mt-3 w-full"
              disabled={sending}
              onClick={() => run(() => api.startDem())}
            >
              {dem?.current ? t("data.refresh") : t("data.import")}
            </button>
          )}
        </section>
      )}

      {status && (
        <section aria-labelledby="data-own">
          <h3 id="data-own" className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            {t("data.own")}
          </h3>
          <p className="mt-1 text-sm text-slate-600">{t("data.ownIntro")}</p>
          {ownGrid && (
            <div className="mt-2 text-sm text-slate-700">
              <p>
                {ownGrid.source.name}
                {" · "}
                {t("data.imported", { date: date(ownGrid.finishedAt) })}
              </p>
              <p className="text-xs text-slate-500">
                {t("data.ownFacts", {
                  res: num(ownGrid.source.resolutionM ?? 0),
                  crs: ownGrid.source.crs ?? "",
                })}
                {ownGrid.source.verticalAccuracyM !== undefined &&
                  ` · ${t("data.ownAccuracy", { acc: num(ownGrid.source.verticalAccuracyM) })}`}
                {ownGrid.source.licence ? ` · ${ownGrid.source.licence}` : ""}
              </p>
              {ownGrid.stats.notes?.map((n) => (
                <p key={n} className="text-xs text-slate-500">
                  {n}
                </p>
              ))}
              {status.canImport && (
                <button
                  type="button"
                  className="btn-ghost btn mt-1 min-h-9"
                  disabled={sending || importBusy(demUpload?.latest)}
                  onClick={() => run(() => api.remove(ownGrid.id))}
                >
                  {t("data.remove")}
                </button>
              )}
            </div>
          )}
          {lastProblem(demUpload?.latest ?? null, ownGrid)}
          {runningLine(demUpload?.latest ?? null)}
          {status.canImport && status.area && !importBusy(demUpload?.latest) && (
            <div className="mt-3 flex flex-col gap-2">
              {(
                [
                  ["source", "data.ownSource"],
                  ["licence", "data.ownLicence"],
                  ["accuracy", "data.ownAccuracyField"],
                  ["crs", "data.ownCrs"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t(label)}</span>
                  <input
                    className="input"
                    type={field === "accuracy" ? "number" : "text"}
                    min={field === "accuracy" ? 0 : undefined}
                    step={field === "accuracy" ? "any" : undefined}
                    value={own[field]}
                    onChange={(e) => setOwn((o) => ({ ...o, [field]: e.target.value }))}
                  />
                </label>
              ))}
              <input
                ref={demFileRef}
                type="file"
                accept=".tif,.tiff,image/tiff"
                className="sr-only"
                aria-label={t("data.ownChoose", { max: num(status.limits.demUploadMaxMb) })}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f)
                    void run(() =>
                      api.uploadDem(f, {
                        crs: own.crs,
                        source: own.source,
                        licence: own.licence,
                        accuracy: accuracyValue,
                      }),
                    );
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={sending || !ownValid}
                onClick={() => demFileRef.current?.click()}
              >
                {t(ownGrid ? "data.ownReplace" : "data.ownChoose", {
                  max: num(status.limits.demUploadMaxMb),
                })}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );

  return panel ? createPortal(body, panel) : body;
}

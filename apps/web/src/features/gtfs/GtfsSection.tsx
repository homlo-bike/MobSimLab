import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { activePlugins, pluginConverter, type Plugin } from "../../plugins/registry";
import type { Timetable } from "../journey-planner/types";
import { loadWasmGtfs } from "./engine";
import type { GtfsEngineLoader, GtfsFeed, GtfsNetworkDoc } from "./types";
import { readZip, writeZip } from "./zip";

/** At most this many feeds, and this much JSON, fit in the project (the drawing's limits in the API). */
export const MAX_FEEDS = 5;
export const MAX_DOC_BYTES = 8 * 1024 * 1024 - 64 * 1024;

/** Purpose: whether the GTFS plugin is present (its importer and exporter). */
export function gtfsAvailable(plugins: readonly Plugin[] = activePlugins()) {
  return {
    importer: pluginConverter("importers", "gtfs_import", plugins),
    exporter: pluginConverter("exporters", "gtfs_export", plugins),
  };
}

/** Purpose: `YYYYMMDD` as `YYYY-MM-DD`, and back. */
export const isoDate = (d: string) =>
  d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d;
const gtfsDate = (d: string) => d.replaceAll("-", "");

/** Purpose: the GTFS route type of every plugin mode, for modes the core does not know. */
export function pluginRouteTypes(plugins: readonly Plugin[] = activePlugins()): Record<string, number> {
  return Object.fromEntries(plugins.flatMap((p) => p.modes.map((m) => [m.id, m.gtfsRouteType])));
}

/** Purpose: the project name as a file name, such as `harbour-loop-gtfs.zip`. */
export function feedFileName(project: string): string {
  const slug = project
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "mobsimlab"}-gtfs.zip`;
}

/**
 * Purpose: the GTFS plugin in the journey planner: import a feed (zip) as the existing network of one
 * service day, cut to the map view if asked, and download the project's lines as a GTFS feed.
 * Inputs: the imported feeds and which of them the planner leaves out; `onChange` saves the feeds (absent
 * when the planner may only look); `ownLines` is what the project draws and publishes, for the download.
 * Side effects: reads the chosen file; the download starts a file save in the browser.
 */
export function GtfsSection({
  map,
  feeds,
  skipped,
  onToggle,
  onChange,
  ownLines,
  projectName,
  loadEngine = loadWasmGtfs,
}: {
  map: MapLibreMap | null;
  feeds: readonly GtfsFeed[];
  skipped: ReadonlySet<string>;
  onToggle: (id: string, use: boolean) => void;
  onChange?: (doc: GtfsNetworkDoc) => void;
  ownLines: Timetable | null;
  projectName: string;
  loadEngine?: GtfsEngineLoader;
}) {
  const { t } = useI18n();
  const { importer, exporter } = gtfsAvailable();
  const [inView, setInView] = useState(true);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!importer && !exporter) return null;

  const importFile = async (file: File) => {
    setError(null);
    if (importer && file.size > importer.maxBytes) {
      const mb = (n: number) => Math.round(n / 1e5) / 10;
      setError(t("jp.gtfs.tooLarge", { mb: mb(file.size), max: mb(importer.maxBytes) }));
      return;
    }
    setBusy(t("jp.gtfs.reading", { name: file.name }));
    try {
      const files = await readZip(new Uint8Array(await file.arrayBuffer()));
      const engine = await loadEngine();
      const b = map?.getBounds();
      const got = engine.import(files, {
        ...(date ? { date: gtfsDate(date) } : {}),
        ...(inView && b ? { bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] } : {}),
      });
      const feed: GtfsFeed = {
        id: crypto.randomUUID().slice(0, 8),
        name: file.name,
        importedAt: new Date().toISOString(),
        summary: got.summary,
        timetable: got.timetable,
      };
      const doc: GtfsNetworkDoc = { feeds: [...feeds, feed].slice(-MAX_FEEDS) };
      const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
      if (bytes > MAX_DOC_BYTES) {
        const mb = (n: number) => Math.round(n / 1e5) / 10;
        setError(t("jp.gtfs.tooLarge", { mb: mb(bytes), max: mb(MAX_DOC_BYTES) }));
        return;
      }
      onChange?.(doc);
    } catch (e) {
      setError(t("jp.gtfs.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!ownLines) return;
    setError(null);
    try {
      const engine = await loadEngine();
      const today = new Date();
      const day = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
      const files = engine.export(ownLines, {
        agency_name: projectName || "MobSimLab",
        agency_url: window.location.origin,
        agency_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        lang: document.documentElement.lang || "en",
        start_date: day(today),
        end_date: day(new Date(today.getTime() + 365 * 86_400_000)),
        route_types: pluginRouteTypes(),
        feed_version: today.toISOString(),
      });
      const url = URL.createObjectURL(new Blob([writeZip(files) as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = feedFileName(projectName);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(t("jp.gtfs.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <section aria-labelledby="gtfs-title" className="space-y-2 border-t border-slate-200 pt-2">
      <h3 id="gtfs-title" className="text-xs font-semibold text-slate-700">
        {t("jp.gtfs.title")}
      </h3>
      {feeds.map((f) => (
        <div key={f.id} className="flex items-start gap-2">
          <label className="flex flex-1 items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!skipped.has(f.id)}
              onChange={(e) => onToggle(f.id, e.target.checked)}
            />
            <span>
              {t("jp.gtfs.feed", {
                name: f.summary.agencies.join(", ") || f.name,
                routes: f.summary.routes,
                stops: f.summary.stops,
                trips: f.summary.trips + f.summary.patterns,
                date: isoDate(f.summary.date),
              })}
              {f.summary.outside > 0 && (
                <span className="block text-xs text-slate-500">
                  {t("jp.gtfs.outside", { n: f.summary.outside })}
                </span>
              )}
              {f.summary.warnings.map((w) => (
                <span key={w} className="block text-xs text-amber-700">
                  {w}
                </span>
              ))}
            </span>
          </label>
          {onChange && (
            <button
              type="button"
              className="text-xs text-blue-700 underline"
              onClick={() => onChange({ feeds: feeds.filter((x) => x.id !== f.id) })}
            >
              {t("jp.gtfs.remove")}
            </button>
          )}
        </div>
      ))}
      {importer && onChange && feeds.length < MAX_FEEDS && (
        <div className="space-y-1.5">
          {feeds.length === 0 && <p className="text-xs text-slate-600">{t("jp.gtfs.intro")}</p>}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} />
            {t("jp.gtfs.inView")}
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span>{t("jp.gtfs.date")}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded border border-slate-300 px-1.5 py-0.5"
            />
            <span className="text-xs text-slate-500">{t("jp.gtfs.dateHint")}</span>
          </label>
          <label
            className={`inline-flex cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <input
              type="file"
              accept={(importer.extensions ?? [".zip"]).join(",")}
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
            {t("jp.gtfs.pick")}
          </label>
        </div>
      )}
      {busy && (
        <p role="status" className="text-xs text-slate-600">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      {exporter && ownLines && (
        <button
          type="button"
          onClick={() => void download()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
        >
          {t("jp.gtfs.export")}
        </button>
      )}
    </section>
  );
}

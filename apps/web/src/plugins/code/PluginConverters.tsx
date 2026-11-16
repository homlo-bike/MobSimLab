import { useState } from "react";
import type { GtfsFeed, GtfsNetworkDoc, GtfsSummary } from "../../features/gtfs/types";
import type { Timetable } from "../../features/journey-planner/types";
import { useI18n } from "../../i18n/i18n";
import { componentConverters, type Plugin, type PluginConverter } from "../registry";
import { pluginRuntime } from "./context";
import { runPluginCode, type WorkerFactory } from "./runtime";

type Converter = PluginConverter & { plugin: Plugin };

/** Purpose: a summary for an imported timetable, from the plugin's summary where it gave a sound one. */
function summaryOf(tt: Timetable, s: unknown): GtfsSummary {
  const o = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 20) : [];
  return {
    agencies: strings(o.agencies),
    date: typeof o.date === "string" ? o.date.slice(0, 8) : "",
    routes: tt.routes.length,
    stops: tt.stops.length,
    trips: tt.trips.length,
    patterns: tt.frequency_patterns?.length ?? 0,
    outside: 0,
    warnings: strings(o.warnings),
  };
}

/** Purpose: check the shape of a timetable an importer returned, enough for the app to use it. */
function asTimetable(v: unknown): Timetable {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  for (const k of ["stops", "routes", "trips"])
    if (!Array.isArray(o[k])) throw new Error(`the result has no ${k} list`);
  return {
    stops: o.stops as Timetable["stops"],
    routes: o.routes as Timetable["routes"],
    trips: o.trips as Timetable["trips"],
    transfers: Array.isArray(o.transfers) ? (o.transfers as Timetable["transfers"]) : [],
    frequency_patterns: Array.isArray(o.frequency_patterns) ? (o.frequency_patterns as Timetable["frequency_patterns"]) : [],
  };
}

/**
 * Purpose: the importers and exporters of installed plugins in the journey planner's existing-network section
 * (contract published-timetable): import a file as one more existing network, and download the project's lines.
 * The plugin's code runs in the browser sandbox; the API checks the saved network like any other.
 * Inputs: the imported networks, `onAdd` to keep a new one (absent when the planner may only look), the
 * project's own lines and its name.
 */
export function PluginConverters({
  feeds,
  onAdd,
  ownLines,
  maxDocBytes,
  maxFeeds,
  createWorker,
}: {
  feeds: readonly GtfsFeed[];
  onAdd?: (doc: GtfsNetworkDoc) => void;
  ownLines: Timetable | null;
  maxDocBytes: number;
  maxFeeds: number;
  createWorker?: WorkerFactory;
}) {
  const { t } = useI18n();
  const importers = componentConverters("importers");
  const exporters = componentConverters("exporters");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (importers.length === 0 && exporters.length === 0) return null;
  const rt = pluginRuntime();

  const importFile = async (c: Converter, file: File) => {
    setError(null);
    if (!rt.projectId || !c.component) return;
    if (file.size > c.maxBytes) {
      setError(t("pcode.importFailed", { plugin: c.plugin.name, error: `${file.name}: too large` }));
      return;
    }
    setBusy(true);
    try {
      const r = await runPluginCode(
        {
          projectId: rt.projectId,
          pluginId: c.plugin.id,
          component: c.component,
          world: "importer",
          id: c.id,
          files: [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }],
          options: {},
          limits: rt.limits,
        },
        createWorker,
      );
      if (!r.ok) throw new Error(r.error);
      const got = JSON.parse(String(r.value)) as { timetable?: unknown; summary?: unknown };
      const timetable = asTimetable(got.timetable);
      const feed: GtfsFeed = {
        id: crypto.randomUUID().slice(0, 8),
        name: file.name.slice(0, 200),
        importedAt: new Date().toISOString(),
        summary: summaryOf(timetable, got.summary),
        timetable,
      };
      const doc: GtfsNetworkDoc = { feeds: [...feeds, feed].slice(-maxFeeds) };
      if (new TextEncoder().encode(JSON.stringify(doc)).length > maxDocBytes) throw new Error("the network is too large");
      onAdd?.(doc);
    } catch (e) {
      setError(t("pcode.importFailed", { plugin: c.plugin.name, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const download = async (c: Converter) => {
    setError(null);
    if (!rt.projectId || !c.component || !ownLines) return;
    setBusy(true);
    try {
      const r = await runPluginCode(
        {
          projectId: rt.projectId,
          pluginId: c.plugin.id,
          component: c.component,
          world: "exporter",
          id: c.id,
          input: JSON.stringify({ timetable: ownLines, options: {} }),
          limits: rt.limits,
        },
        createWorker,
      );
      if (!r.ok) throw new Error(r.error);
      const files = r.value as { name: string; data: Uint8Array }[];
      if (files.reduce((n, f) => n + f.data.length, 0) > c.maxBytes) throw new Error("the file is too large");
      for (const f of files) {
        const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: "application/octet-stream" }));
        const a = document.createElement("a");
        a.href = url;
        // Only the file's own name, never a folder.
        a.download = f.name.split("/").pop()!.replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "export";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      setError(t("pcode.exportFailed", { plugin: c.plugin.name, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {onAdd &&
        feeds.length < maxFeeds &&
        importers.map((c) => (
          <label
            key={`${c.plugin.id}/${c.id}`}
            className={`inline-flex cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <input
              type="file"
              accept={(c.extensions ?? []).join(",")}
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(c, f);
              }}
            />
            {t("pcode.import", { label: c.label, plugin: c.plugin.name })}
          </label>
        ))}
      {ownLines &&
        exporters.map((c) => (
          <button
            key={`${c.plugin.id}/${c.id}`}
            type="button"
            disabled={busy}
            onClick={() => void download(c)}
            className="block rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
          >
            {t("pcode.export", { label: c.label, plugin: c.plugin.name })}
          </button>
        ))}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

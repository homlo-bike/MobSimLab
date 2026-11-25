import { useCallback, useEffect, useState } from "react";
import { formatDateTime, useI18n } from "../i18n/i18n";
import type { MessageKey } from "../i18n/messages";
import type { ProjectsApi } from "../projects/api";
import type { PreferencesDoc } from "./preferences";
import {
  ALWAYS_SAVED,
  SAVED_DATA_IDS,
  SAVED_NOW,
  type SavedDataId,
  type SavedDataRow,
  savedIn,
  type UpdateTarget,
  updateTarget,
  withSaved,
} from "./savedFiles";

const NAMES: Record<SavedDataId, MessageKey> = {
  design: "savedFiles.design",
  vehicles: "savedFiles.vehicles",
  processed: "savedFiles.processed",
  runs: "savedFiles.runs",
  comments: "savedFiles.comments",
  history: "savedFiles.history",
  osm: "savedFiles.osm",
  liveTiles: "savedFiles.liveTiles",
  elevation: "savedFiles.elevation",
  population: "savedFiles.population",
  uploads: "savedFiles.uploads",
  facts: "savedFiles.facts",
  economy: "savedFiles.economy",
  otherFetched: "savedFiles.otherFetched",
  viewerMap: "savedFiles.viewerMap",
};

/** Purpose: a size in bytes as kB, MB or GB in the language shown, in Latin digits. */
export function sizeText(bytes: number, language: string): string {
  const [value, unit] =
    bytes >= 1e9
      ? [bytes / 1e9, "gigabyte"]
      : bytes >= 1e6
        ? [bytes / 1e6, "megabyte"]
        : [bytes / 1e3, "kilobyte"];
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit,
    maximumFractionDigits: value < 10 ? 1 : 0,
    numberingSystem: "latn",
  }).format(value);
}

/**
 * Purpose: the Saved project files section of Project preferences: for every kind of data the project holds, a
 * switch for whether a saved `.mslab` file holds it, with its size, source and the date it was last fetched or
 * worked out, and a link to where it is updated. `editable` false shows the choices only. Side effects: loads the
 * sizes from the API once, and again on Refresh.
 */
export function SavedFilesSection({
  api,
  projectId,
  preferences,
  editable,
  onPreferences,
  onGo,
}: {
  api: Pick<ProjectsApi, "mslabContents">;
  projectId: string;
  preferences: PreferencesDoc | null;
  editable: boolean;
  onPreferences: (doc: PreferencesDoc) => void;
  /** Open where a kind of data is updated: a tab or another section of Project preferences. */
  onGo?: (target: UpdateTarget) => void;
}) {
  const { t, language } = useI18n();
  const [rows, setRows] = useState<ReadonlyMap<SavedDataId, SavedDataRow> | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (typeof api.mslabContents !== "function") return () => {};
    let live = true;
    setFailed(false);
    api.mslabContents(projectId).then(
      (r) => {
        if (live) setRows(new Map(r.map((x) => [x.id, x])));
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api, projectId]);
  useEffect(() => load(), [load]);

  const total = rows
    ? SAVED_DATA_IDS.filter((id) => savedIn(preferences, id) && SAVED_NOW.has(id)).reduce(
        (s, id) => s + (rows.get(id)?.bytes ?? 0),
        0,
      )
    : null;

  return (
    <section
      aria-labelledby="pp-saved-files"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="pp-saved-files" className="caps m-0 flex-1">
          {t("savedFiles.title")}
        </h2>
        <button type="button" className="min-h-10 text-sm text-blue-700 underline" onClick={() => load()}>
          {t("savedFiles.refresh")}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-600">{t("savedFiles.intro")}</p>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t("savedFiles.loadFailed")}
        </p>
      )}
      <ul className="m-0 mt-3 list-none divide-y divide-slate-100 p-0">
        {SAVED_DATA_IDS.map((id) => {
          const row = rows?.get(id);
          const always = ALWAYS_SAVED.has(id);
          const on = savedIn(preferences, id);
          const target = updateTarget(id);
          const name = t(NAMES[id]);
          const size =
            id === "viewerMap"
              ? t("savedFiles.whenSaving")
              : !row
                ? "…"
                : row.bytes > 0 || row.items > 0
                  ? sizeText(row.bytes, language)
                  : t("savedFiles.none");
          const source = row?.sources.length ? row.sources.join(", ") : null;
          return (
            <li key={id} className="flex items-start gap-3 py-3" data-saved={id}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-600">
                  <span>{size}</span>
                  {source && <span>{t("savedFiles.from", { source })}</span>}
                  {row?.at && <span>{t("savedFiles.at", { date: formatDateTime(row.at) })}</span>}
                  {target && onGo && (
                    <button
                      type="button"
                      className="text-blue-700 underline"
                      aria-label={t("savedFiles.updateOf", { name })}
                      onClick={() => onGo(target)}
                    >
                      {t("savedFiles.update")}
                    </button>
                  )}
                </div>
                {always && <div className="mt-0.5 text-xs text-slate-500">{t("savedFiles.always")}</div>}
                {!SAVED_NOW.has(id) && (
                  <div className="mt-0.5 text-xs text-slate-500">{t("savedFiles.later")}</div>
                )}
              </div>
              <input
                type="checkbox"
                role="switch"
                className="mt-1 h-5 w-5 shrink-0"
                aria-label={t("savedFiles.include", { name })}
                checked={on}
                disabled={always || !editable}
                onChange={(e) =>
                  onPreferences(withSaved(preferences ?? { values: {} }, id, e.target.checked))
                }
              />
            </li>
          );
        })}
      </ul>
      {total !== null && (
        <p className="mt-2 text-sm font-semibold">
          {t("savedFiles.total", { size: sizeText(total, language) })}
        </p>
      )}
      {!editable && <p className="mt-3 text-sm text-slate-500">{t("prefs.readOnly")}</p>}
    </section>
  );
}

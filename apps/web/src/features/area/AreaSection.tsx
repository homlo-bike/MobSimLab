import { useEffect, useState } from "react";
import { formatInt, useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import {
  type AreaImport,
  type AreaPolygon,
  type AreaView,
  megabytes,
  type ProjectAreaApi,
  ringAreaKm2,
} from "./api";
import { AreaOutline, AreaWindow, DETAIL_COLOUR } from "./AreaWindow";
import { notifyAreaChanged } from "./areaLayer";
import { countryName } from "../costs/economy";

const IMPORT_NAMES: Record<AreaImport["kind"], MessageKey> = {
  osm: "data.osm",
  dem: "data.dem",
  population: "pop.title",
};

/** Purpose: one line per import queued when the area was saved: started, already there, or why it could not start. */
export function AreaImports({ imports }: { imports: readonly AreaImport[] }) {
  const { t } = useI18n();
  if (!imports.length) return null;
  return (
    <ul className="m-0 mt-2 list-none p-0 text-sm" aria-live="polite">
      {imports.map((i) => {
        const what = t(IMPORT_NAMES[i.kind]);
        return (
          <li key={i.kind} className={i.status === "failed" ? "text-red-800" : "text-slate-700"}>
            <span aria-hidden="true">{i.status === "failed" ? "✕ " : "✓ "}</span>
            {i.status === "failed"
              ? t("area.import.failed", { what, reason: i.reason ?? "" })
              : t(i.status === "queued" ? "area.import.queued" : "area.import.current", { what })}
          </li>
        );
      })}
      <li className="mt-1 text-xs text-slate-500">{t("area.seeMapData")}</li>
    </ul>
  );
}

/** Purpose: the polygons as a list: colour, name, detail and area. */
export function PolygonList({ polygons }: { polygons: readonly AreaPolygon[] }) {
  const { t } = useI18n();
  return (
    <ul className="m-0 list-none p-0 text-sm">
      {polygons.map((p) => (
        <li key={p.id} className="flex items-center gap-2 py-0.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: DETAIL_COLOUR[p.detail] }}
          />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="shrink-0 text-xs text-slate-500">
            {t("aw.polyLine", {
              detail: t(p.detail === "full" ? "aw.detail.full" : "aw.detail.main"),
              area: formatInt(ringAreaKm2(p.ring)),
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Preferences, Project area: the polygons drawn round the project, when its map data was downloaded, and the
 * area window to change them (Edit area). Owners and Editors change the area and download the map data again.
 */
export function AreaSection({
  api,
  editable,
  projectName,
}: {
  api: ProjectAreaApi;
  editable: boolean;
  projectName?: string;
}) {
  const { t, tn, language } = useI18n();
  const [view, setView] = useState<AreaView | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "saved" | { error: string }>("idle");
  const [imports, setImports] = useState<AreaImport[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .get()
      .then((a) => live && setView(a))
      .catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [api]);
  const save = async (polygons: AreaPolygon[]) => {
    const r = await api.set(polygons, true);
    setView(r);
    notifyAreaChanged();
    setImports(r.imports);
    setState("saved");
    setOpen(false);
  };
  const refresh = async () => {
    setState("busy");
    setImports([]);
    try {
      setImports((await api.refresh()).imports);
      setState("idle");
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  const polygons = view?.polygons ?? [];
  const countries = view?.countries?.countries ?? [];
  const date = view?.dataDate
    ? new Date(view.dataDate).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  return (
    <section
      aria-labelledby="pp-area"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-area" className="caps m-0">
        {t("area.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("aw.prefsIntro")}</p>
      {!view && typeof state !== "object" ? (
        <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p>
      ) : polygons.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-sm text-slate-600">
          {t("aw.none")}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4 rounded-xl border border-slate-200 p-4 sm:flex-row">
          <AreaOutline polygons={polygons} label={t("aw.outline")} />
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                <b>{formatInt(view?.estimate.areaKm2 ?? 0)}</b> km²
              </span>
              <b>{tn("aw.count", polygons.length)}</b>
              <span>
                {date ? t("aw.dataFrom", { date }) : t("aw.noData")} ·{" "}
                {t("aw.download", { mb: formatInt(megabytes(view?.estimate.bytes ?? 0)) })}
              </span>
            </p>
            <div className="mt-2">
              <PolygonList polygons={polygons} />
            </div>
          </div>
        </div>
      )}
      {editable ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-pri"
              disabled={!view || state === "busy"}
              onClick={() => setOpen(true)}
            >
              <span aria-hidden="true">▱ </span>
              {t(polygons.length ? "aw.editArea" : "aw.drawArea")}
            </button>
            {polygons.length > 0 && (
              <button
                type="button"
                className="btn"
                disabled={state === "busy"}
                onClick={() => void refresh()}
              >
                {t("aw.refresh")}
              </button>
            )}
            <span role="status" className="text-sm text-slate-600">
              {state === "saved" ? t("aw.saved") : typeof state === "object" ? state.error : ""}
            </span>
          </div>
          {polygons.length > 0 && <p className="mt-2 text-xs text-slate-500">{t("aw.refreshHelp")}</p>}
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-500">{t("prefs.readOnly")}</p>
      )}
      {countries.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          {countries.length === 1
            ? t("area.country", { name: countryName(countries[0]!, language) })
            : t("area.crossesBorder", {
                countries: countries
                  .map((c) => `${countryName(c, language)} ${Math.round(c.share * 100)} %`)
                  .join(", "),
                name: countryName(countries[0]!, language),
              })}
        </p>
      )}
      <AreaImports imports={imports} />
      {open && view && (
        <AreaWindow
          initial={polygons}
          saved={polygons}
          projectName={projectName}
          estimate={api.estimate}
          onSave={save}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

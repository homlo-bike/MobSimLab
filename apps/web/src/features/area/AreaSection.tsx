import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { type AreaImport, type AreaRegion, type ProjectAreaApi } from "./api";
import { AreaPicker } from "./AreaPicker";

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

/**
 * Preferences, Area (#140): the OpenStreetMap regions the project area is made of. Owners and Editors change
 * them; saving queues the OpenStreetMap, elevation and population imports for the area once.
 */
export function AreaSection({ api, editable }: { api: ProjectAreaApi; editable: boolean }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<AreaRegion[] | null>(null);
  const [regions, setRegions] = useState<AreaRegion[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const [imports, setImports] = useState<AreaImport[]>([]);
  useEffect(() => {
    let live = true;
    api
      .get()
      .then((a) => {
        if (!live) return;
        setSaved(a.regions ?? []);
        setRegions(a.regions ?? []);
      })
      .catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [api]);
  const dirty =
    saved !== null &&
    regions
      .map((r) => r.id)
      .sort()
      .join() !==
      saved
        .map((r) => r.id)
        .sort()
        .join();
  const save = async () => {
    setState("saving");
    setImports([]);
    try {
      const r = await api.set(regions, true);
      setSaved(r.regions);
      setRegions(r.regions);
      setImports(r.imports);
      setState("saved");
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section
      aria-labelledby="pp-area"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-area" className="caps m-0">
        {t("area.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("area.intro")}</p>
      {saved === null && typeof state !== "object" ? (
        <p className="mt-3 text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <div className="mt-3">
          <AreaPicker value={regions} onChange={setRegions} disabled={!editable || state === "saving"} />
        </div>
      )}
      {editable ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-pri"
            disabled={!dirty || state === "saving"}
            onClick={() => void save()}
          >
            {t("area.save")}
          </button>
          <span role="status" className="text-sm text-slate-600">
            {state === "saved" && !dirty ? t("area.saved") : typeof state === "object" ? state.error : ""}
          </span>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">{t("prefs.readOnly")}</p>
      )}
      <AreaImports imports={imports} />
    </section>
  );
}

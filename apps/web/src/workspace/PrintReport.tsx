import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useI18n } from "../i18n/i18n";
import { Dialog } from "../shell/Dialog";

/**
 * Purpose: the map as it is drawn now, as a PNG data URL, with its attribution as plain text; null when the
 * map is not on screen (another tab is open) or cannot be read.
 * Side effects: asks the map for one more frame and reads its canvas while that frame is fresh.
 */
export function printMap(map: MapLibreMap | null): Promise<{ image: string; attribution: string } | null> {
  if (!map) return Promise.resolve(null);
  const canvas = map.getCanvas();
  if (!canvas.clientWidth || !canvas.clientHeight) return Promise.resolve(null);
  const attribution = (map.getContainer().querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3_000);
    map.once("render", () => {
      clearTimeout(timer);
      try {
        resolve({ image: canvas.toDataURL("image/png"), attribution });
      } catch {
        resolve(null);
      }
    });
    map.triggerRepaint();
  });
}

/**
 * Purpose: print the project, or save it as PDF through the browser's print dialog: its name and date, the
 * map as it is drawn now with its attribution, and the cost tables. The planner picks the parts.
 * Side effects: while open, renders the report off screen (shown only when printing) so the tables can load;
 * opens the browser's print dialog.
 */
export function PrintReport({
  projectName,
  areaName,
  map,
  mapOnScreen,
  tables,
  onClose,
}: {
  projectName: string;
  areaName: string | null;
  map: MapLibreMap | null;
  /** Whether a map tab is open, so the map can be printed as it is drawn. */
  mapOnScreen: boolean;
  /** The cost tables, read-only. */
  tables: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [withMap, setWithMap] = useState(mapOnScreen);
  const [withTables, setWithTables] = useState(true);
  const [shot, setShot] = useState<{ image: string; attribution: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const print = async () => {
    setBusy(true);
    const picture = withMap ? await printMap(map) : null;
    flushSync(() => setShot(picture));
    setBusy(false);
    window.print();
  };

  const date = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
  return (
    <>
      <Dialog
        title={t("print.title")}
        subtitle={t("print.intro")}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-pri"
              disabled={busy || (!withMap && !withTables)}
              onClick={() => void print()}
            >
              {t("print.print")}
            </button>
          </>
        }
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="caps pb-1">{t("print.include")}</legend>
          <label className="flex min-h-10 items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-700"
              checked={withMap && mapOnScreen}
              disabled={!mapOnScreen}
              onChange={(e) => setWithMap(e.target.checked)}
            />
            {t("print.map")}
          </label>
          {!mapOnScreen && <p className="ms-6.5 text-xs text-slate-500">{t("print.mapHidden")}</p>}
          <label className="flex min-h-10 items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-700"
              checked={withTables}
              onChange={(e) => setWithTables(e.target.checked)}
            />
            {t("print.tables")}
          </label>
        </fieldset>
        <p className="mt-3 text-xs text-slate-500">{t("print.pdfHint")}</p>
      </Dialog>
      {createPortal(
        <div className="print-report hidden bg-white p-0 text-slate-900">
          <header className="mb-4 border-b border-slate-300 pb-2">
            <h1 className="text-2xl font-semibold">{projectName}</h1>
            <p className="text-sm text-slate-600">{[areaName, date].filter(Boolean).join(" · ")}</p>
          </header>
          {withMap && shot && (
            <figure className="mb-6 break-inside-avoid">
              <img src={shot.image} alt={t("print.map")} className="w-full border border-slate-300" />
              {shot.attribution && (
                <figcaption className="mt-1 text-[10px] text-slate-600">{shot.attribution}</figcaption>
              )}
            </figure>
          )}
          {withTables && <section aria-label={t("print.tables")}>{tables}</section>}
        </div>,
        document.body,
      )}
    </>
  );
}

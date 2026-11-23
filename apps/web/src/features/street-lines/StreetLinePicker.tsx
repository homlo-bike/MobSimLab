import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/i18n";
import { type SavedStreetLine, streetLineColor } from "./saved";

/** The layer the other modes draw the saved street lines in (workspace/OtherModesLayer). */
const LINES_LAYER = "om-lines";

interface Props {
  map: MapLibreMap | null;
  panel: HTMLElement | null;
  lines: readonly SavedStreetLine[];
  /** Open the line at this index of `lines`. */
  onPick: (index: number) => void;
  onNew: () => void;
}

/**
 * Purpose: the street route tool while no line is open: the project's lines to pick from, in the panel or by
 * clicking one on the map, and a new line. A line's settings only show once it is picked.
 */
export function StreetLinePicker({ map, panel, lines, onPick, onNew }: Props) {
  const { t, tn } = useI18n();

  useEffect(() => {
    if (!map) return;
    const near = (ev: MapMouseEvent) => {
      if (!map.getLayer(LINES_LAYER)) return [];
      const { x, y } = ev.point;
      return map.queryRenderedFeatures(
        [
          [x - 5, y - 5],
          [x + 5, y + 5],
        ],
        { layers: [LINES_LAYER] },
      );
    };
    const onClick = (ev: MapMouseEvent) => {
      const id = near(ev).find((f) => typeof f.properties?.line === "string")?.properties?.line;
      const i = lines.findIndex((l) => l.id === id);
      if (i >= 0) onPick(i);
    };
    const onMove = (ev: MapMouseEvent) => {
      map.getCanvas().style.cursor = near(ev).length ? "pointer" : "";
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.getCanvas().style.cursor = "";
    };
  }, [map, lines, onPick]);

  const body = (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <h2 className="text-xl font-semibold">{t("street.lines", { n: lines.length })}</h2>
      <p className="text-slate-600">{t("street.pickLine")}</p>
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => (
          <li key={l.id ?? i}>
            <button
              type="button"
              onClick={() => onPick(i)}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-start hover:bg-slate-100"
            >
              <span
                className="h-3 w-6 shrink-0 rounded-sm"
                style={{ background: streetLineColor(l) }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{l.name || t("street.untitled")}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {tn("rail.stops", l.points.filter((p) => p.kind !== "via").length)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn self-start" onClick={onNew}>
        {t("street.newLine")}
      </button>
    </div>
  );
  return panel ? createPortal(body, panel) : body;
}

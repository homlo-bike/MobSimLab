import { Map as MapLibreMap, type MapOptions } from "maplibre-gl";
import { useI18n } from "../i18n/i18n";
import { getLogger } from "../logging/logger";

const log = getLogger("map");

/**
 * Purpose: make a MapLibre map, or say that it can't be made. Without WebGL2 (no graphics card, or 3D graphics
 * switched off) MapLibre throws, and that error took the whole page down to a blank window (Damascus bug 24).
 * Output: the map, or `null` when it could not be made (the error is logged).
 */
export function createMap(options: MapOptions): MapLibreMap | null {
  try {
    return new MapLibreMap(options);
  } catch (error) {
    log.error({ error: error instanceof Error ? error : String(error) }, "the map could not be made");
    return null;
  }
}

/** Purpose: shown where the map would be when it could not be made, so the rest of the page still works. */
export function NoMapNotice() {
  const { t } = useI18n();
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center p-6" data-testid="no-map">
      <div className="max-w-md rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-800 shadow">
        <p className="font-semibold">{t("map.noWebgl")}</p>
        <p className="mt-2">{t("map.noWebglHelp")}</p>
      </div>
    </div>
  );
}

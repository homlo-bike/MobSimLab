import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect } from "react";

/** How many editors on each map need Shift-click; box zoom is back on once none does. */
const holders = new WeakMap<MapLibreMap, number>();

/**
 * Purpose: let Shift-click reach the map's click handlers while an editor selects with it. MapLibre's box zoom
 * takes every Shift press on the map and swallows the click that follows, so it is off while the editor is
 * open and back on once the last such editor closes.
 * Side effects: disables and re-enables the map's box zoom.
 */
export function useShiftClickSelect(map: MapLibreMap | null | undefined): void {
  useEffect(() => {
    if (!map) return;
    holders.set(map, (holders.get(map) ?? 0) + 1);
    map.boxZoom.disable();
    return () => {
      const n = (holders.get(map) ?? 1) - 1;
      holders.set(map, n);
      if (n <= 0) map.boxZoom.enable();
    };
  }, [map]);
}

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { groupOf } from "../../map/mapLayers";
import type { AreaPolygon } from "./api";

/** The project area layer on every map tab: the polygons' edges as dashed lines (layer control: Project area). */
export const AREA_SOURCE = "pa-area";
export const AREA_LINE = "pa-area-line";

/** Fired on `window` when a project's area is saved, so the map draws the new edges. */
export const AREA_CHANGED = "mobsimlab:area-changed";

/** Purpose: tell the map that the project area changed (Preferences, or a GIS region added to it). */
export function notifyAreaChanged(): void {
  window.dispatchEvent(new Event(AREA_CHANGED));
}

/**
 * Purpose: draw the edges of the project area's polygons as dashed lines, under the project's other layers,
 * or clear them when there are none.
 * Side effects: adds or updates the map's `pa-area` source and `pa-area-line` layer.
 */
export function drawAreaLayer(map: MapLibreMap, polygons: readonly AreaPolygon[]): void {
  const data = {
    type: "FeatureCollection" as const,
    features: polygons.map((p) => ({
      type: "Feature" as const,
      properties: { name: p.name },
      geometry: { type: "LineString" as const, coordinates: p.ring },
    })),
  };
  const src = map.getSource(AREA_SOURCE) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(AREA_SOURCE, { type: "geojson", data });
  const before = (map.getStyle()?.layers ?? []).find((l) => {
    const g = groupOf(l.id);
    return g !== null && g !== "projectArea";
  })?.id;
  map.addLayer(
    {
      id: AREA_LINE,
      type: "line",
      source: AREA_SOURCE,
      paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [2, 2] },
    },
    before,
  );
}

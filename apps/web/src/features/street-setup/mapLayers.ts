import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { effective, priority } from "./model";
import type { StreetInfo, StreetSetup } from "./types";

/** Layer that receives taps on streets: wide and transparent, so a finger finds a street easily. */
export const HIT_LAYER = "ss-streets-hit";
const SOURCE = "ss-streets";
const LAYERS = ["ss-streets-casing", "ss-streets", "ss-selected", HIT_LAYER];

/** Map colours by transit priority, shared with the legend. */
export const PRIORITY_COLOR = {
  separated: "#047857",
  painted: "#2563eb",
  mixed: "#d97706",
  other: "#94a3b8",
} as const;

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** Purpose: add the street setup source and layers once. Side effects: adds them to the map. */
export function ensureLayers(map: MapLibreMap): void {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  const width = (lo: number, hi: number) => ["interpolate", ["linear"], ["zoom"], 13, lo, 18, hi] as never;
  map.addLayer({
    id: "ss-streets-casing",
    type: "line",
    source: SOURCE,
    filter: ["get", "setup"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0f172a", "line-width": width(4, 12), "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "ss-streets",
    type: "line",
    source: SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "match",
        ["get", "priority"],
        "separated",
        PRIORITY_COLOR.separated,
        "painted",
        PRIORITY_COLOR.painted,
        "mixed",
        PRIORITY_COLOR.mixed,
        PRIORITY_COLOR.other,
      ],
      // Zoom must be the outermost expression: main roads draw wider at every zoom.
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        13,
        ["case", ["get", "main"], 2.5, 1],
        18,
        ["case", ["get", "main"], 9, 5],
      ] as never,
      "line-opacity": ["case", ["==", ["get", "priority"], "other"], 0.55, 0.95],
    },
  });
  map.addLayer({
    id: "ss-selected",
    type: "line",
    source: SOURCE,
    filter: ["==", ["get", "way"], -1],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#facc15", "line-width": width(6, 16), "line-opacity": 0.75 },
  });
  map.addLayer({
    id: HIT_LAYER,
    type: "line",
    source: SOURCE,
    paint: { "line-color": "#000", "line-width": 24, "line-opacity": 0 },
  });
  // The selection glow sits under the street colour.
  map.moveLayer("ss-selected", "ss-streets-casing");
}

/** Purpose: draw the streets coloured by their priority with the setups applied. */
export function drawStreets(
  map: MapLibreMap,
  infos: Iterable<StreetInfo>,
  setups: readonly StreetSetup[],
): void {
  const by = new Map(setups.map((s) => [s.way, s]));
  const features = [...infos].map((info) => {
    const s = by.get(info.way);
    return {
      type: "Feature" as const,
      properties: {
        way: info.way,
        main: info.main_road,
        setup: s !== undefined,
        priority: priority(info, effective(info, s)),
      },
      geometry: { type: "LineString" as const, coordinates: info.coords },
    };
  });
  (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
}

/** Purpose: highlight one street (or none). */
export function selectStreet(map: MapLibreMap, way: number | null): void {
  if (map.getLayer("ss-selected")) map.setFilter("ss-selected", ["==", ["get", "way"], way ?? -1]);
}

/** Purpose: remove the layers and source. */
export function removeLayers(map: MapLibreMap): void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

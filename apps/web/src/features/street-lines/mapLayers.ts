import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import {
  baysToGeoJson,
  depotTripsToGeoJson,
  groupLinksToGeoJson,
  legsToGeoJson,
  STATUS_COLOR,
  type FeatureCollection,
} from "./geojson";
import type { LineView } from "./types";

/** Layer that receives clicks on the route (to insert a point into a leg). */
export const HIT_LAYER = "sl-legs-hit";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["sl-roads", "sl-depot", "sl-groups", "sl-bays", "sl-legs"];
const LAYERS = [
  "sl-roads",
  "sl-depot",
  "sl-groups",
  "sl-bays-fill",
  "sl-bays-line",
  "sl-legs-casing",
  "sl-legs",
  "sl-legs-error",
  "sl-legs-arrows",
  HIT_LAYER,
];
const DEPOT_COLOR = "#6b7280";

/** Purpose: draw a white chevron into an image so direction arrows need no font glyphs. */
function arrowImage(): ImageData | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(11, 9);
  ctx.lineTo(19, 16);
  ctx.lineTo(11, 23);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Purpose: add the street line sources and layers once.
 * Inputs: the map (style loaded), the line colour and the driving side, which offsets each direction to its own side.
 * Side effects: adds sources, layers and the arrow image to the map.
 */
export function ensureLayers(map: MapLibreMap, color: string, trafficSide: "right" | "left"): void {
  if (map.getSource("sl-legs")) return;
  const offset = trafficSide === "right" ? 3 : -3;
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "sl-roads",
    type: "line",
    source: "sl-roads",
    paint: {
      "line-color": ["case", ["get", "wire"], "#15803d", ["get", "bus_lane"], "#0e7490", "#94a3b8"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 17, 3],
      "line-opacity": 0.6,
    },
  });
  map.addLayer({
    id: "sl-depot",
    type: "line",
    source: "sl-depot",
    layout: { "line-join": "round" },
    paint: {
      "line-color": DEPOT_COLOR,
      "line-width": 3,
      "line-dasharray": [2, 1.5],
      "line-offset": offset * 2,
    },
  });
  map.addLayer({
    id: "sl-groups",
    type: "line",
    source: "sl-groups",
    paint: { "line-color": "#334155", "line-width": 1, "line-dasharray": [1, 2] },
  });
  map.addLayer({
    id: "sl-bays-fill",
    type: "fill",
    source: "sl-bays",
    paint: { "fill-color": color, "fill-opacity": 0.3 },
  });
  map.addLayer({
    id: "sl-bays-line",
    type: "line",
    source: "sl-bays",
    paint: { "line-color": color, "line-width": 1 },
  });
  map.addLayer({
    id: "sl-legs-casing",
    type: "line",
    source: "sl-legs",
    filter: ["!=", ["get", "status"], "error"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 8, "line-offset": offset },
  });
  map.addLayer({
    id: "sl-legs",
    type: "line",
    source: "sl-legs",
    filter: ["!=", ["get", "status"], "error"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["match", ["get", "status"], "warning", STATUS_COLOR.warning, color],
      "line-width": 5,
      "line-offset": offset,
    },
  });
  map.addLayer({
    id: "sl-legs-error",
    type: "line",
    source: "sl-legs",
    filter: ["==", ["get", "status"], "error"],
    paint: { "line-color": STATUS_COLOR.error, "line-width": 3, "line-dasharray": [2, 2] },
  });
  const arrow = arrowImage();
  if (arrow) {
    map.addImage("sl-arrow", arrow, { pixelRatio: 2 });
    map.addLayer({
      id: "sl-legs-arrows",
      type: "symbol",
      source: "sl-legs",
      filter: ["!=", ["get", "status"], "error"],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 80,
        "icon-image": "sl-arrow",
        "icon-allow-overlap": true,
        "icon-offset": [0, offset * 2],
      },
    });
  }
  map.addLayer({
    id: HIT_LAYER,
    type: "line",
    source: "sl-legs",
    paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 16 },
  });
}

/** Purpose: recolour the route and stop bays for another mode. */
export function setLineColor(map: MapLibreMap, color: string): void {
  if (!map.getLayer("sl-legs")) return;
  map.setPaintProperty("sl-legs", "line-color", [
    "match",
    ["get", "status"],
    "warning",
    STATUS_COLOR.warning,
    color,
  ]);
  map.setPaintProperty("sl-bays-fill", "fill-color", color);
  map.setPaintProperty("sl-bays-line", "line-color", color);
}

/** Purpose: remove everything `ensureLayers` added. */
export function removeLayers(map: MapLibreMap): void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  if (map.hasImage("sl-arrow")) map.removeImage("sl-arrow");
}

function set(map: MapLibreMap, id: string, data: object): void {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
}

/** Purpose: show the roads usable by the current vehicle, or hide them with `null`. */
export function drawRoads(map: MapLibreMap, roads: object | null): void {
  set(map, "sl-roads", roads ?? EMPTY);
}

/** Purpose: push the line view to the map; `depot` picks which depot runs to show (`null` hides them). */
export function drawLine(
  map: MapLibreMap,
  view: LineView,
  depot: { out?: number; in?: number } | null,
): void {
  set(map, "sl-legs", legsToGeoJson(view));
  set(map, "sl-bays", baysToGeoJson(view));
  set(map, "sl-groups", groupLinksToGeoJson(view));
  set(map, "sl-depot", depot ? depotTripsToGeoJson(view, depot) : EMPTY);
}

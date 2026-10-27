import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { depotTripsToGeoJson, legsToGeoJson, STATUS_COLOR, type FeatureCollection } from "./geojson";
import type { LineView } from "./types";

/** Layer that receives clicks on the route (to insert a point into a leg). */
export const HIT_LAYER = "sl-legs-hit";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const LAYERS = [
  "sl-bounds",
  "sl-depot",
  "sl-legs-casing",
  "sl-legs",
  "sl-legs-error",
  "sl-legs-arrows",
  HIT_LAYER,
];
const SOURCES = ["sl-roads", "sl-bounds", "sl-depot", "sl-legs"];

/** Purpose: draw a chevron into an image so direction arrows need no font glyphs. */
function arrowImage(): ImageData | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [colour, width] of [
    ["#ffffff", 9],
    ["#1e3a8a", 4.5],
  ] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(10, 7);
    ctx.lineTo(21, 16);
    ctx.lineTo(10, 25);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Purpose: add the street line sources and layers once.
 * Inputs: the map (style loaded) and the side vehicles drive on, which offsets each direction to its own side.
 * Side effects: adds sources, layers and the arrow image to the map.
 */
export function ensureLayers(map: MapLibreMap, trafficSide: "right" | "left"): void {
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
      "line-opacity": 0.7,
    },
  });
  map.addLayer({
    id: "sl-bounds",
    type: "line",
    source: "sl-bounds",
    paint: { "line-color": "#64748b", "line-width": 1, "line-dasharray": [4, 3] },
  });
  map.addLayer({
    id: "sl-depot",
    type: "line",
    source: "sl-depot",
    layout: { "line-join": "round" },
    paint: {
      "line-color": ["match", ["get", "kind"], "pull_out", "#16a34a", "#9333ea"],
      "line-width": 3,
      "line-dasharray": [1.5, 1.5],
      "line-offset": offset * 2,
    },
  });
  map.addLayer({
    id: "sl-legs-casing",
    type: "line",
    source: "sl-legs",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 7, "line-offset": offset },
  });
  map.addLayer({
    id: "sl-legs",
    type: "line",
    source: "sl-legs",
    filter: ["!=", ["get", "status"], "error"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["match", ["get", "status"], "warning", STATUS_COLOR.warning, STATUS_COLOR.ok],
      "line-width": 4,
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
        "symbol-spacing": 90,
        "icon-image": "sl-arrow",
        "icon-allow-overlap": true,
        "icon-offset": [0, offset],
      },
    });
  }
  map.addLayer({
    id: HIT_LAYER,
    type: "line",
    source: "sl-legs",
    paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 14 },
  });
}

/** Purpose: remove everything `ensureLayers` added. */
export function removeLayers(map: MapLibreMap): void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  if (map.hasImage("sl-arrow")) map.removeImage("sl-arrow");
}

/** Purpose: show the roads usable by the current vehicle, or hide them with `null`. */
export function drawRoads(map: MapLibreMap, roads: object | null): void {
  (map.getSource("sl-roads") as GeoJSONSource | undefined)?.setData((roads ?? EMPTY) as never);
}

/** Purpose: push the current line view and network bounds to the map sources. */
export function drawLine(
  map: MapLibreMap,
  view: LineView,
  bounds: [number, number, number, number] | null,
): void {
  const set = (id: string, data: FeatureCollection) =>
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
  set("sl-legs", legsToGeoJson(view));
  set("sl-depot", depotTripsToGeoJson(view));
  if (bounds) {
    const [w, s, e, n] = bounds;
    set("sl-bounds", {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          },
        },
      ],
    });
  }
}

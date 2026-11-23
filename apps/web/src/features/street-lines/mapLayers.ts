import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import {
  baysToGeoJson,
  depotTripsToGeoJson,
  groupLinksToGeoJson,
  legsToGeoJson,
  setupDetoursToGeoJson,
  STATUS_COLOR,
  type FeatureCollection,
} from "./geojson";
import type { LineView } from "./types";

/** Layer that receives clicks on the route (to insert a point into a leg). */
export const HIT_LAYER = "sl-legs-hit";
/** Layer that receives clicks on the project's other lines (to switch to one of them). */
export const OTHERS_HIT_LAYER = "sl-others-hit";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["sl-others", "sl-roads", "sl-depot", "sl-groups", "sl-bays", "sl-closed", "sl-legs"];
const LAYERS = [
  "sl-others",
  "sl-roads",
  "sl-depot",
  "sl-groups",
  "sl-bays-fill",
  "sl-bays-line",
  "sl-closed",
  "sl-legs-warn",
  "sl-legs-casing",
  "sl-legs",
  "sl-legs-error",
  "sl-legs-arrows",
  HIT_LAYER,
  OTHERS_HIT_LAYER,
];
const DEPOT_COLOR = "#6b7280";
/** The mockup's warning colour, for the band under a leg with a warning. */
const WARN_BAND = "#b97300";

/** Pixel ratio of the chevron image: drawn at 4× so it stays sharp at its small size on the map. */
const ARROW_RATIO = 4;

/**
 * Purpose: draw the thin white direction chevron of the line and track drawing mockup into an image (no font
 * glyphs needed): a small chevron inside the 4 px line, pointing along it, with a 1.2 px stroke.
 */
function arrowImage(): ImageData | null {
  const size = 8 * ARROW_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return null;
  const k = ARROW_RATIO;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2 * k;
  ctx.beginPath();
  ctx.moveTo(2.3 * k, 2.3 * k);
  ctx.lineTo(4 * k, 4 * k);
  ctx.lineTo(2.3 * k, 5.7 * k);
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
    id: "sl-others",
    type: "line",
    source: "sl-others",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.4 },
  });
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
  // The route as drawn along a street the GIS tab's layout closes to buses: red dashes beside the detour.
  map.addLayer({
    id: "sl-closed",
    type: "line",
    source: "sl-closed",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": STATUS_COLOR.error,
      "line-width": 4,
      "line-dasharray": [0.5, 2],
      "line-offset": offset,
    },
  });
  // As in the mockup: a leg with a warning keeps the line colour over a wide, faint amber band; every leg
  // has a white casing under a 4 px line in the mode colour.
  map.addLayer({
    id: "sl-legs-warn",
    type: "line",
    source: "sl-legs",
    filter: ["==", ["get", "status"], "warning"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": WARN_BAND, "line-opacity": 0.45, "line-width": 10, "line-offset": offset },
  });
  map.addLayer({
    id: "sl-legs-casing",
    type: "line",
    source: "sl-legs",
    filter: ["!=", ["get", "status"], "error"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 6.5, "line-offset": offset },
  });
  map.addLayer({
    id: "sl-legs",
    type: "line",
    source: "sl-legs",
    filter: ["!=", ["get", "status"], "error"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": color, "line-width": 4, "line-offset": offset },
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
    map.addImage("sl-arrow", arrow, { pixelRatio: ARROW_RATIO });
    map.addLayer({
      id: "sl-legs-arrows",
      type: "symbol",
      source: "sl-legs",
      filter: ["!=", ["get", "status"], "error"],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 110,
        "icon-image": "sl-arrow",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "map",
        // The chevron turns with the line (pointing along it), so its offset is across the line in its own
        // frame: the same pixels as the leg's line-offset puts it on the middle of the drawn line.
        "icon-offset": [0, offset],
      },
    });
  }
  // Wide, invisible targets: 16 px with a mouse, 24 px on touch screens.
  const hitWidth =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? 24 : 16;
  map.addLayer({
    id: OTHERS_HIT_LAYER,
    type: "line",
    source: "sl-others",
    paint: { "line-color": "#000000", "line-opacity": 0, "line-width": hitWidth },
  });
  map.addLayer({
    id: HIT_LAYER,
    type: "line",
    source: "sl-legs",
    paint: { "line-color": "#000000", "line-opacity": 0, "line-width": hitWidth },
  });
}

/** Purpose: recolour the route and stop bays for another mode. */
export function setLineColor(map: MapLibreMap, color: string): void {
  if (!map.getLayer("sl-legs")) return;
  map.setPaintProperty("sl-legs", "line-color", color);
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

/** Purpose: draw the project's other street lines faded, from their saved routes, in their mode colours. */
export function drawOtherLines(
  map: MapLibreMap,
  lines: { view: LineView; color: string; id?: string }[],
): void {
  set(map, "sl-others", {
    type: "FeatureCollection",
    features: lines.flatMap((l) =>
      legsToGeoJson(l.view).features.map((f) => ({
        ...f,
        properties: { color: l.color, line: l.id ?? null },
      })),
    ),
  });
}

/** Purpose: push the line view to the map; `depot` picks which depot runs to show (`null` hides them). */
export function drawLine(
  map: MapLibreMap,
  view: LineView,
  depot: { out?: number; in?: number } | null,
): void {
  set(map, "sl-legs", legsToGeoJson(view));
  set(map, "sl-closed", setupDetoursToGeoJson(view));
  set(map, "sl-bays", baysToGeoJson(view));
  set(map, "sl-groups", groupLinksToGeoJson(view));
  set(map, "sl-depot", depot ? depotTripsToGeoJson(view, depot) : EMPTY);
}

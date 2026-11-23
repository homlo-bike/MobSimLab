import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { LANE_MIN_ZOOM, type LaneGeometry, type LaneKind } from "./lanes";
import { effective, junctionSetupOf, priority } from "./model";
import type { JunctionSetup, StreetInfo, StreetSetup } from "./types";

/** Layer of the junction shapes, which receives taps on junctions from zoom 16. */
export const JUNCTION_LAYER = "ss-junctions";
/** Layer that receives taps on streets: wide and transparent, so a finger finds a street easily. */
export const HIT_LAYER = "ss-streets-hit";
const SOURCE = "ss-streets";
const LANE_SOURCE = "ss-lanes";
const JUNCTION_SOURCE = "ss-junctions";
const MARKING_SOURCE = "ss-lane-markings";
const LAYERS = [
  "ss-junctions",
  "ss-junction-selected",
  "ss-lanes",
  "ss-lane-markings",
  "ss-centre-markings",
  "ss-lane-rails",
  "ss-streets-casing",
  "ss-streets",
  "ss-selected",
  HIT_LAYER,
];
/** The street lines, which make way for the lanes where those are drawn. */
const LINE_LAYERS = ["ss-streets-casing", "ss-streets"];

/** Map colours by transit priority, shared with the legend. */
export const PRIORITY_COLOR = {
  separated: "#047857",
  painted: "#2563eb",
  mixed: "#d97706",
  other: "#94a3b8",
} as const;

/** Lane colours as on the ground (asphalt, red bus lanes, green bike lanes), shared with the legend. */
export const LANE_COLOR: Record<LaneKind, string> = {
  traffic: "#9ca3af",
  bus: "#f87171",
  bike: "#4ade80",
  tram: "#c2a878",
  pavement: "#e2e8f0",
  footway: "#d6d3d1",
  shared_use: "#a7f3d0",
  parking: "#93c5fd",
  kerb: "#475569",
  buffer: "#cbd5e1",
  construction: "#fbbf24",
  island: "#d6d3d1",
  green: "#86a865",
};
const JUNCTION_COLOR = "#a8adb6";
/** Junctions with traffic lights (from OSM or the planner), shared with the legend. */
export const SIGNAL_JUNCTION_COLOR = "#f59e0b";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** Purpose: add the street setup source and layers once. Side effects: adds them to the map. */
export function ensureLayers(map: MapLibreMap): void {
  if (map.getSource(SOURCE)) return;
  // Lanes and junctions (ADR-0047) under everything else, from zoom 16.
  map.addSource(JUNCTION_SOURCE, { type: "geojson", data: EMPTY });
  map.addSource(LANE_SOURCE, { type: "geojson", data: EMPTY });
  map.addSource(MARKING_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "ss-junctions",
    type: "fill",
    source: JUNCTION_SOURCE,
    minzoom: LANE_MIN_ZOOM,
    paint: {
      "fill-color": ["case", ["get", "signals"], SIGNAL_JUNCTION_COLOR, JUNCTION_COLOR] as never,
    },
  });
  map.addLayer({
    id: "ss-junction-selected",
    type: "line",
    source: JUNCTION_SOURCE,
    minzoom: LANE_MIN_ZOOM,
    filter: ["==", ["get", "key"], ""],
    paint: { "line-color": "#0f172a", "line-width": 3 },
  });
  map.addLayer({
    id: "ss-lanes",
    type: "fill",
    source: LANE_SOURCE,
    minzoom: LANE_MIN_ZOOM,
    layout: { "fill-sort-key": ["get", "layer"] },
    paint: {
      "fill-color": [
        "match",
        ["get", "kind"],
        ...Object.entries(LANE_COLOR).flat(),
        LANE_COLOR.traffic,
      ] as never,
      "fill-outline-color": "#64748b",
    },
  });
  // Road markings stay white on a dark basemap too (map/darkLayers.ts).
  const markingWidth = ["interpolate", ["linear"], ["zoom"], 16, 0.5, 19, 2] as never;
  map.addLayer({
    id: "ss-lane-markings",
    type: "line",
    source: MARKING_SOURCE,
    minzoom: LANE_MIN_ZOOM,
    filter: ["==", ["get", "kind"], "lane"],
    paint: { "line-color": "#ffffff", "line-width": markingWidth, "line-dasharray": [3, 4] },
  });
  map.addLayer({
    id: "ss-centre-markings",
    type: "line",
    source: MARKING_SOURCE,
    minzoom: LANE_MIN_ZOOM,
    filter: ["==", ["get", "kind"], "centre"],
    paint: { "line-color": "#ffffff", "line-width": markingWidth },
  });
  map.addLayer({
    id: "ss-lane-rails",
    type: "line",
    source: MARKING_SOURCE,
    minzoom: LANE_MIN_ZOOM,
    filter: ["==", ["get", "kind"], "rails"],
    paint: {
      "line-color": "#57534e",
      "line-width": ["interpolate", ["linear"], ["zoom"], 16, 1, 19, 3] as never,
    },
  });
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

/** Purpose: flat `[lon, lat, …]` to GeoJSON positions. */
function positions(flat: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/**
 * Purpose: draw the lane and junction shapes (or clear them with `null`). Where lanes are drawn, the
 * street lines give way to them from zoom 16; without lanes they stay at every zoom.
 * Side effects: sets the lane sources and the zoom range of the street line layers.
 */
export function drawLanes(
  map: MapLibreMap,
  g: LaneGeometry | null,
  junctions: readonly JunctionSetup[] = [],
): void {
  const set = (id: string, features: unknown[]) =>
    (map.getSource(id) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    } as never);
  set(
    LANE_SOURCE,
    (g?.lanes ?? []).map((l) => ({
      type: "Feature",
      properties: { kind: l.kind, way: l.way, layer: l.layer },
      geometry: { type: "Polygon", coordinates: [positions(l.ring)] },
    })),
  );
  drawJunctions(map, g, junctions);
  set(
    MARKING_SOURCE,
    (g?.lines ?? []).map((l) => ({
      type: "Feature",
      properties: { kind: l.kind, layer: l.layer },
      geometry: { type: "LineString", coordinates: positions(l.path) },
    })),
  );
  const max = g && g.lanes.length ? LANE_MIN_ZOOM : 24;
  for (const id of LINE_LAYERS) if (map.getLayer(id)) map.setLayerZoomRange(id, 0, max);
}

/** Purpose: the key a junction is known by on the map: its OSM nodes. */
export function junctionKey(nodes: readonly number[]): string {
  return nodes.join(",");
}

/**
 * Purpose: draw the junction shapes, those with traffic lights (OSM's, or the planner's where set) in
 * amber. Side effects: sets the junction source.
 */
export function drawJunctions(
  map: MapLibreMap,
  g: LaneGeometry | null,
  junctions: readonly JunctionSetup[],
): void {
  (map.getSource(JUNCTION_SOURCE) as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: (g?.junctions ?? []).map((j) => ({
      type: "Feature",
      properties: {
        key: junctionKey(j.nodes),
        crossing: j.crossing,
        signals: junctionSetupOf(junctions, j.nodes)?.signals ?? j.signals,
      },
      geometry: { type: "Polygon", coordinates: [positions(j.ring)] },
    })),
  } as never);
}

/** Purpose: outline the selected junctions (none: an empty list), by their keys. */
export function selectJunction(map: MapLibreMap, keys: readonly string[]): void {
  if (map.getLayer("ss-junction-selected"))
    map.setFilter("ss-junction-selected", ["in", ["get", "key"], ["literal", [...keys]]]);
}

/** Purpose: highlight one street (or none). */
export function selectStreet(map: MapLibreMap, way: number | null): void {
  if (map.getLayer("ss-selected")) map.setFilter("ss-selected", ["==", ["get", "way"], way ?? -1]);
}

/** Purpose: remove the layers and source. */
export function removeLayers(map: MapLibreMap): void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SOURCE, LANE_SOURCE, JUNCTION_SOURCE, MARKING_SOURCE])
    if (map.getSource(id)) map.removeSource(id);
}

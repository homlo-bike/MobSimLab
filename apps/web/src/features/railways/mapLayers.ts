import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { COLORS } from "./modes";
import { LAYER_NAMES, type FeatureCollection, type IssueView, type RailView } from "./types";

const P = "rd-";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
/** Rails and sleepers appear from this zoom; below it each track is one line. */
export const RAILS_ZOOM = 17.5;
/** Below this zoom each alignment is one corridor line. */
export const CORRIDOR_ZOOM = 12.5;
const LEVEL_ORDERS = [0, 1, 2, 3, 4];

/** Layers that answer clicks on track, switches, stations and platforms. */
export const HIT_LAYERS = LEVEL_ORDERS.flatMap((z) => [
  `${P}z${z}-track-line`,
  `${P}z${z}-sleepers`,
  `${P}z${z}-rails`,
  `${P}z${z}-structures`,
  `${P}z${z}-platforms`,
]).concat([`${P}corridors`]);
export const CONNECTION_LAYER = `${P}connections`;

/**
 * Purpose: a width given in metres as a zoom expression in pixels, so the drawing stays to scale.
 * MapLibre's zoom 0 is 512 px for the world, so one pixel is 78,271.5 · cos(lat) / 2^z metres.
 * `minPx` keeps thin features visible when zoomed out.
 */
export function metres(m: number, lat: number, minPx = 0): ExpressionSpecification {
  const k = 78271.517 * Math.cos((lat * Math.PI) / 180);
  const stops: number[] = [];
  for (let z = 8; z <= 24; z++) stops.push(z, Math.max(minPx, (m * 2 ** z) / k));
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as ExpressionSpecification;
}

/** Purpose: the gauge of a track feature in metres (each railway system has its own). */
const GAUGE: ExpressionSpecification = ["coalesce", ["get", "gauge"], 1.435];

/**
 * Purpose: like `metres`, for a width that depends on the feature (`m` is an expression in metres),
 * so tracks of different railway systems in one drawing each keep their own gauge.
 */
export function metresBy(m: ExpressionSpecification, lat: number, minPx = 0): ExpressionSpecification {
  const k = 78271.517 * Math.cos((lat * Math.PI) / 180);
  const stops: unknown[] = [];
  for (let z = 8; z <= 24; z++) stops.push(z, ["max", minPx, ["*", m, 2 ** z / k]]);
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as ExpressionSpecification;
}

const kindIs = (...kinds: string[]): FilterSpecification =>
  ["match", ["get", "kind"], kinds, true, false] as FilterSpecification;
const atZ = (z: number, f?: FilterSpecification): FilterSpecification =>
  (f ? ["all", ["==", ["get", "z"], z], f] : ["==", ["get", "z"], z]) as FilterSpecification;

/**
 * Purpose: add the railway sources and layers once. One stack per level, lowest level first;
 * inside a level all beds and sleepers come before all rails, so tracks that meet or cross on one
 * level merge into one piece of trackwork.
 * Inputs: the map and the latitude used for metre widths. Track widths follow each feature's gauge.
 * Side effects: adds sources and layers to the map.
 */
export function ensureRailLayers(map: MapLibreMap, lat: number): void {
  if (map.getSource(`${P}tracks`)) return;
  for (const n of LAYER_NAMES) map.addSource(`${P}${n}`, { type: "geojson", data: EMPTY });
  map.addSource(`${P}issues`, { type: "geojson", data: EMPTY });
  map.addSource(`${P}selection`, { type: "geojson", data: EMPTY });
  const layers: LayerSpecification[] = [];
  layers.push({
    id: `${P}corridors`,
    type: "line",
    source: `${P}corridors`,
    maxzoom: CORRIDOR_ZOOM,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["case", ["==", ["get", "use"], "storage"], COLORS.storage, COLORS.rail],
      "line-width": 3,
      "line-opacity": ["case", ["get", "underground"], 0.55, 1],
    },
  });
  for (const z of LEVEL_ORDERS) {
    const below = z < 2;
    layers.push(
      {
        id: `${P}z${z}-structures`,
        type: "fill",
        source: `${P}structures`,
        minzoom: CORRIDOR_ZOOM,
        filter: atZ(z),
        paint: {
          "fill-color": [
            "match",
            ["get", "kind"],
            ["tunnel", "station_box"],
            COLORS.tunnel,
            "deck",
            COLORS.deck,
            "ramp",
            ["case", ["get", "underground"], COLORS.tunnel, COLORS.deck],
            "paving",
            COLORS.paving,
            COLORS.ballast,
          ],
          "fill-opacity": [
            "match",
            ["get", "kind"],
            ["tunnel", "station_box"],
            ["case", ["get", "deep"], 0.16, 0.1],
            "deck",
            ["case", ["get", "deep"], 0.3, 0.2],
            "ramp",
            0.22,
            0.85,
          ],
        },
      },
      {
        id: `${P}z${z}-edges`,
        type: "line",
        source: `${P}edges`,
        minzoom: CORRIDOR_ZOOM,
        filter: atZ(z),
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "kind"], ["tunnel_wall", "portal"], COLORS.tunnel, COLORS.deck],
          "line-width": [
            "match",
            ["get", "kind"],
            "tunnel_wall",
            ["case", ["get", "deep"], 3.6, 2.4],
            "portal",
            3,
            1,
          ],
          "line-opacity": ["match", ["get", "kind"], "deck_edge", 0.8, 1],
        },
      },
      {
        id: `${P}z${z}-platforms`,
        type: "fill",
        source: `${P}platforms`,
        minzoom: 14,
        filter: atZ(z, ["==", ["geometry-type"], "Polygon"] as FilterSpecification),
        paint: { "fill-color": COLORS.platform, "fill-outline-color": "#bfb38f" },
      },
      {
        id: `${P}z${z}-platform-edges`,
        type: "line",
        source: `${P}platforms`,
        minzoom: 15,
        filter: atZ(z, kindIs("platform_edge")),
        paint: { "line-color": COLORS.platformEdge, "line-width": metres(0.3, lat, 1) },
      },
      {
        id: `${P}z${z}-sleepers`,
        type: "line",
        source: `${P}tracks`,
        minzoom: RAILS_ZOOM,
        filter: atZ(z, ["!=", ["get", "bed"], "embedded"] as FilterSpecification),
        paint: {
          "line-color": COLORS.sleeper,
          // Sleepers 2.6 m long on standard gauge: the gauge plus 1.165 m.
          "line-width": metresBy(["+", GAUGE, 1.165], lat, 1),
          // Concrete sleepers 0.26 m wide every 0.6 m; dash lengths are in line widths.
          "line-dasharray": [0.26 / 2.6, 0.34 / 2.6],
          "line-opacity": below ? 0.6 : 1,
        },
      },
      {
        // Level crossings: the street surface over the sleepers; rails are drawn on top.
        id: `${P}z${z}-crossing-deck`,
        type: "fill",
        source: `${P}level_crossings`,
        minzoom: 15,
        filter: atZ(z, kindIs("deck")),
        paint: { "fill-color": COLORS.road, "fill-opacity": 0.85 },
      },
      {
        id: `${P}z${z}-track-line`,
        type: "line",
        source: `${P}tracks`,
        minzoom: CORRIDOR_ZOOM,
        maxzoom: RAILS_ZOOM,
        filter: atZ(z),
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["case", ["==", ["get", "use"], "storage"], COLORS.storage, COLORS.rail],
          "line-width": metresBy(["+", GAUGE, 0.2], lat, 1.5),
          "line-opacity": below ? 0.6 : 1,
        },
      },
      {
        id: `${P}z${z}-rails`,
        type: "line",
        source: `${P}rails`,
        minzoom: RAILS_ZOOM,
        filter: atZ(z),
        layout: { "line-join": "round" },
        paint: {
          "line-color": ["case", ["==", ["get", "use"], "storage"], COLORS.storage, COLORS.rail],
          "line-width": metres(0.072, lat, 1),
          "line-opacity": below ? 0.7 : 1,
        },
      },
      {
        id: `${P}z${z}-third-rail`,
        type: "line",
        source: `${P}wires`,
        minzoom: 16,
        filter: atZ(z, kindIs("third_rail")),
        paint: { "line-color": COLORS.third, "line-width": metres(0.09, lat, 1.2) },
      },
      {
        id: `${P}z${z}-wires`,
        type: "line",
        source: `${P}wires`,
        minzoom: 15,
        filter: atZ(z, kindIs("contact_wire")),
        paint: {
          "line-color": COLORS.wire,
          "line-width": 1,
          "line-dasharray": [6, 3],
          "line-opacity": below ? 0.5 : 0.9,
        },
      },
      {
        id: `${P}z${z}-cantilevers`,
        type: "line",
        source: `${P}masts`,
        minzoom: 16,
        filter: atZ(z, kindIs("cantilever")),
        paint: { "line-color": COLORS.wire, "line-width": 1 },
      },
      {
        id: `${P}z${z}-masts`,
        type: "circle",
        source: `${P}masts`,
        minzoom: 16,
        filter: atZ(z, kindIs("mast")),
        paint: {
          "circle-color": COLORS.wire,
          "circle-radius": metres(0.25, lat, 2),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.5,
        },
      },
    );
  }
  layers.push(
    {
      id: `${P}selection`,
      type: "line",
      source: `${P}selection`,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": COLORS.accent, "line-width": 7, "line-opacity": 0.35 },
    },
    {
      id: `${P}buffers`,
      type: "line",
      source: `${P}markers`,
      minzoom: 15,
      filter: kindIs("buffer"),
      paint: { "line-color": COLORS.error, "line-width": metres(0.4, lat, 2) },
    },
    {
      id: `${P}stop-lines`,
      type: "line",
      source: `${P}level_crossings`,
      minzoom: 16,
      filter: kindIs("stop_line"),
      paint: { "line-color": COLORS.stopLine, "line-width": metres(0.3, lat, 1.5) },
    },
    {
      id: `${P}barriers`,
      type: "line",
      source: `${P}level_crossings`,
      minzoom: 16,
      filter: kindIs("barrier"),
      layout: { "line-cap": "round" },
      paint: {
        "line-color": COLORS.barrier,
        "line-width": metres(0.15, lat, 2),
        "line-dasharray": [2, 1],
      },
    },
    {
      id: `${P}diamonds`,
      type: "circle",
      source: `${P}markers`,
      minzoom: 14,
      filter: kindIs("diamond", "clash"),
      paint: {
        "circle-radius": 4,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ["case", ["==", ["get", "kind"], "clash"], COLORS.error, COLORS.info],
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: `${P}issues`,
      type: "circle",
      source: `${P}issues`,
      paint: {
        "circle-radius": 7,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ["match", ["get", "severity"], "error", COLORS.error, COLORS.warn],
        "circle-stroke-width": 2.5,
      },
    },
    {
      id: CONNECTION_LAYER,
      type: "circle",
      source: `${P}connections`,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["case", ["get", "pair"], 7, 5],
        "circle-color": ["case", ["get", "used"], "#ffffff", COLORS.accent],
        "circle-stroke-color": COLORS.accent,
        "circle-stroke-width": 2,
      },
    },
  );
  for (const l of layers) map.addLayer(l);
}

/** Purpose: remove every railway layer and source. Side effects: changes the map style. */
export function removeRailLayers(map: MapLibreMap): void {
  for (const l of map.getStyle()?.layers ?? []) if (l.id.startsWith(P)) map.removeLayer(l.id);
  for (const id of Object.keys(map.getStyle()?.sources ?? {})) if (id.startsWith(P)) map.removeSource(id);
}

/** Purpose: draw a built design. Side effects: replaces the data of every railway source. */
export function drawRail(map: MapLibreMap, view: RailView, selection: FeatureCollection): void {
  for (const n of LAYER_NAMES)
    (map.getSource(`${P}${n}`) as GeoJSONSource | undefined)?.setData(view.layers[n]);
  (map.getSource(`${P}issues`) as GeoJSONSource | undefined)?.setData(issuesToGeoJson(view.issues));
  (map.getSource(`${P}selection`) as GeoJSONSource | undefined)?.setData(selection);
}

/** Purpose: show or hide the connection points (while drawing track). */
export function showConnections(map: MapLibreMap, on: boolean): void {
  if (map.getLayer(CONNECTION_LAYER))
    map.setLayoutProperty(CONNECTION_LAYER, "visibility", on ? "visible" : "none");
}

/** Purpose: errors and warnings with a position, as map points. */
export function issuesToGeoJson(issues: IssueView[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: issues
      .filter((i) => i.at && (i.severity === "error" || i.severity === "warning"))
      .map((i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: i.at },
        properties: { severity: i.severity, ref: i.ref_id },
      })),
  };
}

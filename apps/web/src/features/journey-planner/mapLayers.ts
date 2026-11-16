import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Journey, Timetable } from "./types";

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: object };
interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["jp-zones", "jp-network", "jp-stops", "jp-journey"];
const LAYERS = [
  "jp-zones-fill",
  "jp-zones-line",
  "jp-network",
  "jp-stops",
  "jp-journey-casing",
  "jp-journey",
];

/** Purpose: every pattern as a straight-segment line in its route colour (no shapes in the contract yet). */
export function networkToGeoJson(tt: Timetable): FeatureCollection {
  const stops = new Map(tt.stops.map((s) => [s.stop_id, [s.stop_lon, s.stop_lat]]));
  const colour = new Map(tt.routes.map((r) => [r.route_id, `#${r.route_color ?? "475569"}`]));
  const seen = new Set<string>();
  const features: Feature[] = [];
  for (const p of tt.frequency_patterns) {
    const coords = p.stops.map((s) => stops.get(s.stop_id)).filter((c) => c !== undefined);
    const key = `${p.route_id}:${[...p.stops.map((s) => s.stop_id)].sort().join(",")}`;
    if (seen.has(key) || coords.length < 2) continue;
    seen.add(key);
    features.push({
      type: "Feature",
      properties: { color: colour.get(p.route_id) ?? "#475569" },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  for (const t of tt.trips) {
    const coords = t.stop_times.map((s) => stops.get(s.stop_id)).filter((c) => c !== undefined);
    const key = `${t.route_id}:${t.stop_times.map((s) => s.stop_id).join(",")}`;
    if (seen.has(key) || coords.length < 2) continue;
    seen.add(key);
    features.push({
      type: "Feature",
      properties: { color: colour.get(t.route_id) ?? "#475569" },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return { type: "FeatureCollection", features };
}

export function stopsToGeoJson(tt: Timetable): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: tt.stops.map((s) => ({
      type: "Feature",
      properties: { name: s.stop_name },
      geometry: { type: "Point", coordinates: [s.stop_lon, s.stop_lat] },
    })),
  };
}

/** Purpose: the legs of a journey: rides in their line colour, walks dashed grey. */
export function journeyToGeoJson(j: Journey | null): FeatureCollection {
  if (!j) return EMPTY;
  const features: Feature[] = [];
  for (const l of j.legs) {
    if (l.type === "wait") continue;
    features.push({
      type: "Feature",
      properties: {
        walk: l.type === "walk",
        color: l.type === "ride" ? `#${l.route_color ?? "1f2937"}` : "#475569",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [l.from.lon, l.from.lat],
          [l.to.lon, l.to.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Purpose: add the planner's sources and layers once (style loaded). */
export function ensureLayers(map: MapLibreMap): void {
  if (map.getSource("jp-journey")) return;
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "jp-zones-fill",
    type: "fill",
    source: "jp-zones",
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "jp-zones-line",
    type: "line",
    source: "jp-zones",
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "jp-network",
    type: "line",
    source: "jp-network",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.35 },
  });
  map.addLayer({
    id: "jp-stops",
    type: "circle",
    source: "jp-stops",
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#334155",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "jp-journey-casing",
    type: "line",
    source: "jp-journey",
    filter: ["!", ["get", "walk"]],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 8 },
  });
  map.addLayer({
    id: "jp-journey",
    type: "line",
    source: "jp-journey",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["get", "walk"], 3, 5],
      "line-dasharray": ["case", ["get", "walk"], ["literal", [1, 1.5]], ["literal", [1, 0]]],
    },
  });
}

export function removeLayers(map: MapLibreMap): void {
  for (const id of LAYERS) if (map.getLayer?.(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource?.(id)) map.removeSource(id);
}

export function drawNetwork(map: MapLibreMap, tt: Timetable): void {
  (map.getSource("jp-network") as GeoJSONSource | undefined)?.setData(networkToGeoJson(tt) as never);
  (map.getSource("jp-stops") as GeoJSONSource | undefined)?.setData(stopsToGeoJson(tt) as never);
}

export function drawJourney(map: MapLibreMap, j: Journey | null): void {
  (map.getSource("jp-journey") as GeoJSONSource | undefined)?.setData(journeyToGeoJson(j) as never);
}

/** Purpose: on-demand zones (service zone kit) as polygons with their colour. */
export function zonesToGeoJson(
  zones: readonly { ring: [number, number][]; color: string }[],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones
      .filter((z) => z.ring.length >= 3)
      .map((z) => ({
        type: "Feature",
        properties: { color: z.color },
        geometry: { type: "Polygon", coordinates: [[...z.ring, z.ring[0]!]] },
      })),
  };
}

export function drawZones(
  map: MapLibreMap,
  zones: readonly { ring: [number, number][]; color: string }[],
): void {
  (map.getSource("jp-zones") as GeoJSONSource | undefined)?.setData(zonesToGeoJson(zones) as never);
}

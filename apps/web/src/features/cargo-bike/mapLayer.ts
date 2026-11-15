import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { pluginMapLayers } from "../../plugins/registry";
import type { LonLat, Reach, Route, StreetClass } from "./model";

const TRIP_SOURCE = "cargo-bike-trip";
const RANGE_SOURCE = "cargo-bike-range";

interface LayerStyle {
  id: string;
  type: "fill" | "line";
  source: "trip" | "range";
  layout?: Record<string, unknown>;
  paint: Record<string, unknown>;
}

/** The plugin's `cargo_bike_route` layer style (plugins/cargo-bike/styles/cargo-bike.json, via the registry). */
const style = (pluginMapLayers("cargo_bike_range")[0]?.style ?? { layers: [], legend: [] }) as unknown as {
  layers: LayerStyle[];
  legend: { class: StreetClass; color: string }[];
};

/** Purpose: the colour of a street class on the map and in the tab's legend. */
export function classColour(c: StreetClass): string {
  return style.legend.find((l) => l.class === c)?.color ?? "#64748b";
}

/** A GeoJSON feature of the trip (a line) or the range map (a polygon). */
interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: LonLat[] } | { type: "Polygon"; coordinates: LonLat[][] };
}

/** Purpose: a route as line pieces of one street class each. */
function routeFeatures(route: Route, dir: "go" | "back"): Feature[] {
  const out: Feature[] = [];
  let cur: { cls: StreetClass; coords: LonLat[] } | null = null;
  route.classes.forEach((cls, i) => {
    const a = route.coords[i]!;
    const b = route.coords[i + 1]!;
    if (cur && cur.cls === cls) cur.coords.push(b);
    else {
      if (cur) out.push(line(cur.cls, cur.coords, dir));
      cur = { cls, coords: [a, b] };
    }
  });
  const last = cur as { cls: StreetClass; coords: LonLat[] } | null;
  if (last) out.push(line(last.cls, last.coords, dir));
  return out;
}

function line(cls: StreetClass, coords: LonLat[], dir: string): Feature {
  return {
    type: "Feature",
    properties: { class: cls, dir },
    geometry: { type: "LineString", coordinates: coords },
  };
}

function setData(map: MapLibreMap, id: string, features: Feature[]) {
  const data = { type: "FeatureCollection" as const, features };
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data as never);
    return;
  }
  map.addSource(id, { type: "geojson", data: data as never });
  for (const l of style.layers) {
    if ((l.source === "trip" ? TRIP_SOURCE : RANGE_SOURCE) !== id) continue;
    map.addLayer({ id: l.id, type: l.type, source: id, layout: l.layout ?? {}, paint: l.paint } as never);
  }
}

/**
 * Purpose: draw the trip there and back (coloured by street class) and the range map, or clear them.
 * Side effects: adds or updates the two GeoJSON sources and the plugin's layers.
 */
export function drawCargoBike(
  map: MapLibreMap,
  trip: { go: Route; back: Route } | null,
  reach: Reach[] | null,
): void {
  if (!map.isStyleLoaded?.() && !map.getSource?.(TRIP_SOURCE)) {
    map.once?.("load", () => drawCargoBike(map, trip, reach));
    return;
  }
  setData(map, RANGE_SOURCE, reach?.length ? [rangePolygon(reach)] : []);
  setData(
    map,
    TRIP_SOURCE,
    trip ? [...routeFeatures(trip.back, "back"), ...routeFeatures(trip.go, "go")] : [],
  );
}

/** Purpose: remove the plugin's layers and sources from the map. */
export function clearCargoBike(map: MapLibreMap): void {
  for (const l of [...style.layers].reverse()) if (map.getLayer?.(l.id)) map.removeLayer(l.id);
  for (const id of [TRIP_SOURCE, RANGE_SOURCE]) if (map.getSource?.(id)) map.removeSource(id);
}

/** Purpose: the range map's area: the turning points of every bearing, closed. */
export function rangePolygon(reach: Reach[]): Feature {
  const ring = [...reach].sort((a, b) => a.bearing_deg - b.bearing_deg).map((r) => r.at);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!]] },
  };
}

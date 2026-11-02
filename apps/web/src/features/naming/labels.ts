/**
 * Name candidates from the labels the basemap already has (no network request). The OpenFreeMap
 * basemap uses the OpenMapTiles schema: its `poi`, `place` and `transportation_name` layers give
 * stations, landmarks, facilities, districts and street names around a new stop or station.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

export type LonLat = [number, number];

export type FeatureCategory =
  "transit_station" | "landmark" | "district" | "facility" | "major_street" | "street" | "place";

/** A named thing near the new stop or station. */
export interface NameFeature {
  id: string;
  category: FeatureCategory;
  name: string;
  /** Localised names, keyed `name:<lang>`. */
  names: Record<string, string>;
  /** The feature's point, or the vertex of a street nearest to where the stop is. */
  lonlat: LonLat;
  /** For transit stations: rail (train, tram, metro) or bus. */
  transit?: "rail" | "bus";
}

/** A label feature as the basemap holds it (OpenMapTiles schema). */
export interface RenderedLabel {
  sourceLayer: string;
  properties: Record<string, unknown>;
  /** A point, or the vertices of a line (street names). */
  coordinates: LonLat[];
}

const RAIL_SUBCLASS = new Set(["station", "halt", "tram_stop", "subway", "stop"]);
const BUS_SUBCLASS = new Set(["bus_stop", "bus_station"]);
const LANDMARK = new Set(["attraction", "monument", "castle", "stadium", "museum", "place_of_worship"]);
const DISTRICT = new Set(["suburb", "quarter", "neighbourhood", "borough"]);
const PLACE = new Set(["village", "hamlet", "locality", "isolated_dwelling"]);
const MAJOR_STREET = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

/** Purpose: the category of a label, or null when it is no use as a stop or station name. */
export function labelCategory(l: RenderedLabel): FeatureCategory | null {
  const cls = String(l.properties.class ?? "");
  const sub = String(l.properties.subclass ?? "");
  switch (l.sourceLayer) {
    case "poi":
      if (
        cls === "railway" ||
        cls === "rail" ||
        cls === "bus" ||
        RAIL_SUBCLASS.has(sub) ||
        BUS_SUBCLASS.has(sub)
      )
        return "transit_station";
      if (LANDMARK.has(cls) || LANDMARK.has(sub)) return "landmark";
      return "facility";
    case "place":
      if (DISTRICT.has(cls)) return "district";
      if (PLACE.has(cls)) return "place";
      return null;
    case "transportation_name":
      if (cls === "path" || cls === "track") return null;
      return MAJOR_STREET.has(cls) ? "major_street" : "street";
    default:
      return null;
  }
}

function transitKind(l: RenderedLabel): "rail" | "bus" {
  const cls = String(l.properties.class ?? "");
  const sub = String(l.properties.subclass ?? "");
  return cls === "bus" || BUS_SUBCLASS.has(sub) ? "bus" : "rail";
}

function nearestVertex(coords: readonly LonLat[], p: LonLat): LonLat {
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = coords[0]!;
  let d = Infinity;
  for (const c of coords) {
    const dd = ((c[0] - p[0]) * k) ** 2 + (c[1] - p[1]) ** 2;
    if (dd < d) {
      d = dd;
      best = c;
    }
  }
  return best;
}

/** Purpose: turn basemap labels into name candidates around `at`, one per category and name. */
export function featuresFromLabels(labels: readonly RenderedLabel[], at: LonLat): NameFeature[] {
  const out: NameFeature[] = [];
  const seen = new Set<string>();
  labels.forEach((l, i) => {
    const category = labelCategory(l);
    const name = typeof l.properties.name === "string" ? l.properties.name.trim() : "";
    if (!category || !name || !l.coordinates.length) return;
    const key = `${category}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const names: Record<string, string> = {};
    for (const [k, v] of Object.entries(l.properties))
      if (k.startsWith("name:") && typeof v === "string") names[k] = v;
    out.push({
      id: `${l.sourceLayer}/${i}`,
      category,
      name,
      names,
      lonlat: nearestVertex(l.coordinates, at),
      ...(category === "transit_station" ? { transit: transitKind(l) } : {}),
    });
  });
  return out;
}

/**
 * Purpose: a rail station prefers a railway station's label to a nearby bus stop's, and a bus stop the
 * other way round. Transit labels of the other kind are dropped when one of the right kind is there.
 */
export function preferTransitKind(features: readonly NameFeature[], kind: "rail" | "bus"): NameFeature[] {
  const matches = (f: NameFeature) => f.category === "transit_station" && f.transit === kind;
  if (!features.some(matches)) return [...features];
  return features.filter((f) => f.category !== "transit_station" || matches(f));
}

const LABEL_LAYERS = ["poi", "place", "transportation_name"];

function flatten(coords: unknown): LonLat[] {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === "number" && typeof coords[1] === "number") return [[coords[0], coords[1]]];
  return coords.flatMap(flatten);
}

/**
 * Purpose: the basemap's label features near `at` from the vector tiles already loaded (OpenMapTiles
 * source layers), whether or not the style draws them. Output: [] when the map has none or cannot say.
 */
export function basemapLabels(map: MapLibreMap | null, at: LonLat, radiusM = 500): RenderedLabel[] {
  if (!map || typeof map.querySourceFeatures !== "function" || typeof map.getStyle !== "function") return [];
  try {
    const sources = Object.entries(map.getStyle()?.sources ?? {})
      .filter(([, s]) => s.type === "vector")
      .map(([id]) => id);
    const k = Math.cos((at[1] * Math.PI) / 180);
    const near = (c: LonLat) => Math.hypot((c[0] - at[0]) * k, c[1] - at[1]) * 111_320 <= radiusM;
    const out: RenderedLabel[] = [];
    for (const source of sources)
      for (const sourceLayer of LABEL_LAYERS)
        for (const f of map.querySourceFeatures(source, { sourceLayer })) {
          const coordinates = flatten((f.geometry as { coordinates?: unknown }).coordinates);
          if (coordinates.some(near))
            out.push({ sourceLayer, properties: { ...(f.properties ?? {}) }, coordinates });
        }
    return out;
  } catch {
    return [];
  }
}

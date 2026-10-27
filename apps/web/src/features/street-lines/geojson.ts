import type { LineView, LonLat, Status } from "./types";

/** Minimal GeoJSON types (RFC 7946) used by the editor. */
export interface Geometry {
  type: "LineString" | "Point";
  coordinates: LonLat[] | LonLat;
}
export interface Feature<G extends Geometry = Geometry> {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: G;
}
export interface LineString extends Geometry {
  type: "LineString";
  coordinates: LonLat[];
}
export interface FeatureCollection<G extends Geometry = Geometry> {
  type: "FeatureCollection";
  features: Feature<G>[];
}

/** Line colours by leg status. */
export const STATUS_COLOR: Record<Status, string> = { ok: "#2563eb", warning: "#d97706", error: "#dc2626" };

/**
 * Purpose: leg polylines as GeoJSON for the map, with `index` and `status` properties.
 * Inputs: the line view. Output: a FeatureCollection (empty when fewer than two points).
 */
export function legsToGeoJson(view: LineView): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: view.legs.map((l): Feature<LineString> => ({
      type: "Feature",
      properties: { index: l.index, status: l.status },
      geometry: { type: "LineString", coordinates: l.coords },
    })),
  };
}

/** Purpose: pull-out and pull-in trips as GeoJSON with a `kind` property. */
export function depotTripsToGeoJson(view: LineView): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: view.depot_trips
      .filter((t) => t.coords.length > 1)
      .map((t): Feature<LineString> => ({
        type: "Feature",
        properties: { kind: t.kind, stop: t.stop },
        geometry: { type: "LineString", coordinates: t.coords },
      })),
  };
}

/**
 * Purpose: the whole line as one GeoJSON file for download (legs, points, depot trips).
 * Output: FeatureCollection with an OSM attribution property, because paths are derived from OSM (ODbL).
 */
export function lineToGeoJson(view: LineView): FeatureCollection & { attribution: string } {
  const features: Feature[] = [
    ...legsToGeoJson(view).features.map((f) => ({ ...f, properties: { ...f.properties, type: "leg" } })),
    ...view.points.map((p): Feature => ({
      type: "Feature",
      properties: { type: "point", id: p.id, seq: p.seq, kind: p.kind, name: p.name },
      geometry: { type: "Point", coordinates: p.lonlat },
    })),
    ...depotTripsToGeoJson(view).features.map((f) => ({
      ...f,
      properties: { ...f.properties, type: "depot_trip" },
    })),
  ];
  return { type: "FeatureCollection", features, attribution: "Road data © OpenStreetMap contributors, ODbL" };
}

/** Purpose: "1.2 km" / "350 m". */
export function formatLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Purpose: "12 min" / "45 s". */
export function formatTime(s: number): string {
  return s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
}

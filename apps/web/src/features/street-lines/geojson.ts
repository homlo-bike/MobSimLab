import type { LineView, LonLat, Status } from "./types";

/** Minimal GeoJSON types (RFC 7946) used by the editor. */
export interface Geometry {
  type: "LineString" | "Point" | "Polygon";
  coordinates: LonLat[] | LonLat | LonLat[][];
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
export interface Polygon extends Geometry {
  type: "Polygon";
  coordinates: LonLat[][];
}
export interface FeatureCollection<G extends Geometry = Geometry> {
  type: "FeatureCollection";
  features: Feature<G>[];
}

/** Line colours by leg status (the route itself is drawn in the mode colour). */
export const STATUS_COLOR: Record<Status, string> = { ok: "#2563eb", warning: "#d97706", error: "#dc2626" };

const line = (coordinates: LonLat[], properties: Record<string, unknown>): Feature<LineString> => ({
  type: "Feature",
  properties,
  geometry: { type: "LineString", coordinates },
});

/** Purpose: leg polylines with `index` and `status` properties. */
export function legsToGeoJson(view: LineView): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: view.legs.map((l) => line(l.coords, { index: l.index, status: l.status })),
  };
}

/** Purpose: pull-out and pull-in trips with a `kind` property; only the chosen ones when given. */
export function depotTripsToGeoJson(
  view: LineView,
  show: { out?: number; in?: number } = {},
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: view.depot_trips
      .filter((t) => t.coords.length > 1)
      .filter(
        (t) =>
          (t.kind === "pull_out" ? show.out : show.in) === undefined ||
          t.stop === (t.kind === "pull_out" ? show.out : show.in),
      )
      .map((t) => line(t.coords, { kind: t.kind, stop: t.stop })),
  };
}

/** Purpose: bus bays of the stops, to scale. */
export function baysToGeoJson(view: LineView): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: view.points
      .filter((p) => p.bay)
      .map((p) => ({
        type: "Feature",
        properties: { id: p.id, kind: p.kind },
        geometry: { type: "Polygon", coordinates: [p.bay!] },
      })),
  };
}

/** Purpose: thin links from each grouped stop to the first stop of its station group. */
export function groupLinksToGeoJson(view: LineView): FeatureCollection<LineString> {
  const at = new Map(view.points.map((p) => [p.id, p.lonlat]));
  return {
    type: "FeatureCollection",
    features: view.station_groups.flatMap((g) =>
      g.stops.slice(1).map((s) => line([at.get(g.stops[0]!)!, at.get(s)!], {})),
    ),
  };
}

/** Purpose: "1.2 km" / "350 m". */
export function formatLength(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km` : `${Math.round(m)} m`;
}

/** Purpose: "12 min" / "45 s". */
export function formatTime(s: number): string {
  return s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
}

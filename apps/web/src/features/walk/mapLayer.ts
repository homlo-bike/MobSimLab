import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapLibreMap } from "maplibre-gl";
import { BAND_COLORS } from "./model";
import type { CatchmentGeoJson, LonLat } from "./types";

const CATCHMENT = "walk-catchment";
const GAPS = "walk-gaps";
const SPACING = "walk-spacing";
const LAYERS = [CATCHMENT, `${SPACING}-line`, GAPS, `${GAPS}-label`] as const;
const SOURCES = [CATCHMENT, SPACING, GAPS] as const;

/** A gap: uncovered people (or street length) and the walk to the nearest stop, min (null: unreachable). */
export interface GapPoint {
  lonlat: LonLat;
  rank: number;
  minutes: number | null;
}

/** A pair of consecutive stops to draw, flagged short or long against the mode's guidance. */
export interface SpacingPair {
  from: LonLat;
  to: LonLat;
  flag: "short" | "long" | null;
}

type Data = GeoJSONSourceSpecification["data"];

function set(map: MapLibreMap, id: string, data: Data): boolean {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data as never);
    return false;
  }
  map.addSource(id, { type: "geojson", data });
  return true;
}

/**
 * Purpose: draw the walk analysis: a soft shaded area round the stops coloured by minutes to the nearest
 * stop (5-minute bands, from the walk network), the gaps as numbered red circles, and the stop pairs
 * flagged by the stop spacing check (too short dashed purple, too long red). Pass null to leave a part out.
 * Side effects: adds or updates the `walk-*` sources and layers.
 */
export function drawWalk(
  map: MapLibreMap,
  what: { catchment: CatchmentGeoJson | null; gaps: GapPoint[]; spacing: SpacingPair[] },
): void {
  const empty = { type: "FeatureCollection", features: [] } as Data;
  if (set(map, CATCHMENT, (what.catchment ?? empty) as Data)) {
    const steps: unknown[] = [BAND_COLORS[0]];
    BAND_COLORS.slice(1).forEach((c, i) => steps.push((i + 1) * 5, c));
    // A soft shaded area rather than coloured streets: wide, blurred, see-through strokes that merge
    // into one patch per band, nearer bands drawn on top.
    const width = ["interpolate", ["exponential", 2], ["zoom"], 11, 9, 14, 60, 17, 450];
    map.addLayer({
      id: CATCHMENT,
      type: "line",
      source: CATCHMENT,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ["-", 100, ["get", "minutes"]] as never,
      },
      paint: {
        "line-width": width as never,
        "line-blur": ["interpolate", ["exponential", 2], ["zoom"], 11, 7, 14, 45, 17, 340] as never,
        "line-opacity": 0.32,
        "line-color": ["step", ["get", "minutes"], ...steps] as never,
      },
    });
  }
  const pairs = {
    type: "FeatureCollection",
    features: what.spacing.flatMap((p) => [
      {
        type: "Feature",
        properties: { flag: p.flag ?? "ok" },
        geometry: { type: "LineString", coordinates: [p.from, p.to] },
      },
    ]),
  };
  if (set(map, SPACING, pairs as Data)) {
    map.addLayer({
      id: `${SPACING}-line`,
      type: "line",
      source: SPACING,
      filter: ["!=", ["get", "flag"], "ok"],
      layout: { "line-cap": "round" },
      paint: {
        "line-width": 5,
        "line-opacity": 0.85,
        "line-color": ["match", ["get", "flag"], "short", "#7c3aed", "#dc2626"] as never,
        "line-dasharray": [1.5, 1],
      },
    });
  }
  const gaps = {
    type: "FeatureCollection",
    features: what.gaps.map((g) => ({
      type: "Feature",
      properties: { rank: String(g.rank) },
      geometry: { type: "Point", coordinates: g.lonlat },
    })),
  };
  if (set(map, GAPS, gaps as Data)) {
    map.addLayer({
      id: GAPS,
      type: "circle",
      source: GAPS,
      paint: {
        "circle-radius": 11,
        "circle-color": "#dc2626",
        "circle-opacity": 0.9,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: `${GAPS}-label`,
      type: "symbol",
      source: GAPS,
      layout: { "text-field": ["get", "rank"], "text-size": 12, "text-allow-overlap": true },
      paint: { "text-color": "#ffffff" },
    });
  }
}

/** Purpose: remove the walk analysis from the map. */
export function removeWalk(map: MapLibreMap): void {
  for (const l of LAYERS) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of SOURCES) if (map.getSource(s)) map.removeSource(s);
}

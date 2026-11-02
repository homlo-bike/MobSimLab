import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapLibreMap } from "maplibre-gl";

/** Scenario as `GET /api/agents/scenarios/:id` returns it (the parts the map draws). */
export interface ScenarioView {
  id: string;
  name: string;
  doc: {
    stops: { id: string; name: string; lon: number; lat: number }[];
    lines: { id: string; name: string; mode: string; colour?: string }[];
    routed: Record<string, { directions: { coords: [number, number][] }[] }>;
  };
}

const SOURCES = ["ag-catchment", "ag-lines", "ag-stops"] as const;
const LAYERS = ["ag-catchment", "ag-lines", "ag-stops"] as const;

/** Purpose: GeoJSON of a scenario's routed lines (outbound direction) and stops. */
export function scenarioToGeoJson(s: ScenarioView) {
  return {
    lines: {
      type: "FeatureCollection" as const,
      features: s.doc.lines.flatMap((l) => {
        const c = s.doc.routed[l.id]?.directions[0]?.coords;
        return c && c.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: { name: l.name, color: l.colour ?? "#1d4ed8" },
                geometry: { type: "LineString" as const, coordinates: c },
              },
            ]
          : [];
      }),
    },
    stops: {
      type: "FeatureCollection" as const,
      features: s.doc.stops.map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name },
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      })),
    },
  };
}

/**
 * Purpose: draw a scenario on the map with its walk catchment (street segments coloured by minutes to the
 * nearest stop: green within 5, yellow within 10, orange within 15). Replaces what was drawn before.
 */
export function showScenario(map: MapLibreMap, s: ScenarioView, catchment: object | null): void {
  clearScenario(map);
  const g = scenarioToGeoJson(s);
  map.addSource("ag-catchment", {
    type: "geojson",
    data: (catchment ?? { type: "FeatureCollection", features: [] }) as GeoJSONSourceSpecification["data"],
  });
  map.addSource("ag-lines", { type: "geojson", data: g.lines });
  map.addSource("ag-stops", { type: "geojson", data: g.stops });
  map.addLayer({
    id: "ag-catchment",
    type: "line",
    source: "ag-catchment",
    paint: {
      "line-width": 3,
      "line-opacity": 0.7,
      "line-color": ["step", ["get", "minutes"], "#16a34a", 5, "#eab308", 10, "#f97316", 15, "#94a3b8"],
    },
  });
  map.addLayer({
    id: "ag-lines",
    type: "line",
    source: "ag-lines",
    paint: { "line-width": 4, "line-color": ["get", "color"] },
  });
  map.addLayer({
    id: "ag-stops",
    type: "circle",
    source: "ag-stops",
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#0f172a",
    },
  });
  const pts = s.doc.stops;
  if (pts.length) {
    const lons = pts.map((p) => p.lon);
    const lats = pts.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 15 },
    );
  }
}

/** Purpose: remove the scenario layers. */
export function clearScenario(map: MapLibreMap): void {
  for (const l of LAYERS) if (map.getLayer(l)) map.removeLayer(l);
  for (const s of SOURCES) if (map.getSource(s) as GeoJSONSource | undefined) map.removeSource(s);
}

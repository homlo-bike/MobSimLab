import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";
import type { SavedDepot } from "../features/depots/types";
import { loadRailEngine } from "../features/railways/engine";
import type { Network, RailEngineLoader } from "../features/railways/types";
import { legsToGeoJson } from "../features/street-lines/geojson";
import { type SavedStreetLine, streetLineColor } from "../features/street-lines/saved";
import type { SavedPluginLine } from "../kits/saved";

/** Ids of the read-only layers: no tool's prefix, so no tool removes them and no click reaches them. */
const SRC = { lines: "om-lines", rail: "om-rail", rails: "om-rails", depots: "om-depots" } as const;
/** From this zoom the tracks are drawn rail by rail, as they lie in the street. */
const RAILS_MIN_ZOOM = 16;
const LAYERS: LayerSpecification[] = [
  {
    id: "om-depot-fill",
    type: "fill",
    source: SRC.depots,
    paint: { "fill-color": "#cbd5e1", "fill-opacity": 0.3 },
  },
  {
    id: "om-depot-line",
    type: "line",
    source: SRC.depots,
    paint: { "line-color": "#64748b", "line-width": 1.5, "line-dasharray": [3, 2] },
  },
  {
    id: "om-rail-platforms",
    type: "fill",
    source: SRC.rail,
    filter: ["==", ["geometry-type"], "Polygon"],
    minzoom: 14,
    paint: { "fill-color": "#94a3b8", "fill-opacity": 0.45 },
  },
  {
    id: "om-rail-tracks",
    type: "line",
    source: SRC.rail,
    filter: ["==", ["geometry-type"], "LineString"],
    maxzoom: RAILS_MIN_ZOOM,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#475569", "line-width": 2.5, "line-opacity": 0.55 },
  },
  {
    // The rails of the drawn tracks: the only rails on a street (a street layout's tram lane draws none).
    id: "om-rails",
    type: "line",
    source: SRC.rails,
    minzoom: RAILS_MIN_ZOOM,
    layout: { "line-join": "round" },
    paint: {
      "line-color": "#44403c",
      "line-width": ["interpolate", ["exponential", 2], ["zoom"], 16, 0.6, 20, 3] as never,
      "line-opacity": 0.85,
    },
  },
  {
    id: "om-lines",
    type: "line",
    source: SRC.lines,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 0.45 },
  },
  {
    id: "om-stops",
    type: "circle",
    source: SRC.lines,
    filter: ["==", ["geometry-type"], "Point"],
    minzoom: 13,
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#ffffff",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-opacity": 0.8,
      "circle-stroke-opacity": 0.6,
    },
  },
];

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: object };
const fc = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });
const EMPTY = fc([]);

/** Purpose: the saved street lines as routed lines and stops, in their mode colours. */
export function streetLinesGeoJson(lines: readonly SavedStreetLine[]) {
  const out: Feature[] = [];
  for (const l of lines) {
    const color = streetLineColor(l);
    // The line's id lets the street tool pick a line by clicking it while none is open.
    for (const f of legsToGeoJson(l.view).features)
      out.push({ ...f, properties: { color, line: l.id ?? null } } as Feature);
    for (const p of l.view.points)
      if (p.kind !== "via")
        out.push({
          type: "Feature",
          properties: { color },
          geometry: { type: "Point", coordinates: p.lonlat },
        });
  }
  return out;
}

/** Purpose: the plugin tools' lines (cable cars, ferries) as lines through their stops or legs. */
export function pluginLinesGeoJson(lines: Record<string, SavedPluginLine>, skip: string | null) {
  const out: Feature[] = [];
  for (const [id, saved] of Object.entries(lines)) {
    if (id === skip || !saved.line) continue;
    const color = saved.line.color;
    const legs =
      saved.noise?.kit === "water-route"
        ? saved.noise.legs.map((l) => l.path)
        : [saved.line.stops.map((s) => s.lonlat)];
    for (const path of legs)
      if (path.length >= 2)
        out.push({
          type: "Feature",
          properties: { color },
          geometry: { type: "LineString", coordinates: path },
        });
    for (const s of saved.line.stops)
      out.push({
        type: "Feature",
        properties: { color },
        geometry: { type: "Point", coordinates: s.lonlat },
      });
  }
  return out;
}

/** Purpose: the depots' outlines. */
export function depotOutlinesGeoJson(depots: readonly SavedDepot[]) {
  return fc(
    depots
      .filter((d) => d.boundary.length >= 3)
      .map((d) => ({
        type: "Feature" as const,
        properties: { name: d.name },
        geometry: { type: "Polygon", coordinates: [[...d.boundary, d.boundary[0]!]] },
      })),
  );
}

const set = (map: MapLibreMap, id: string, data: object) =>
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);

/**
 * Purpose: on the map tabs, draw what the other modes hold (street lines, railway, depots, plugin lines) faded
 * under the tool in use (or everything on GIS and Simulator), so the network stays in view. Only the tool in use edits: these layers answer no clicks.
 * Inputs: the tool in use ("street", "rail", "depots" or a plugin tool's id; null draws everything) and the saved
 * drawings. Side effects: adds `om-` sources and layers to the map, and removes them on close.
 */
export function OtherModesLayer({
  map,
  active,
  railway,
  streetLines,
  depots,
  pluginLines,
  loadRail = loadRailEngine,
}: {
  map: MapLibreMap | null;
  active: string | null;
  railway: Network | null;
  streetLines: readonly SavedStreetLine[];
  depots: readonly SavedDepot[];
  pluginLines: Record<string, SavedPluginLine>;
  loadRail?: RailEngineLoader;
}) {
  const [railGeo, setRailGeo] = useState<ReturnType<typeof fc> | null>(null);
  const [railsGeo, setRailsGeo] = useState<ReturnType<typeof fc> | null>(null);
  const showRail = active !== "rail" && Boolean(railway?.tracks.length || railway?.stations.length);

  useEffect(() => {
    if (!map) return;
    for (const id of Object.values(SRC))
      if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
    // Under the tools' own layers, which are added after these.
    for (const l of LAYERS) if (!map.getLayer(l.id)) map.addLayer(l);
    return () => {
      for (const l of [...LAYERS].reverse()) if (map.getLayer(l.id)) map.removeLayer(l.id);
      for (const id of Object.values(SRC)) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map]);

  // The railway's tracks and platforms, built by the railway engine once per change of the drawing.
  useEffect(() => {
    if (!showRail || !railway) {
      setRailGeo(null);
      setRailsGeo(null);
      return;
    }
    let live = true;
    loadRail().then(
      (e) => {
        try {
          if (!live) return;
          const v = e.build(railway, null);
          setRailGeo(
            fc([...v.layers.tracks.features, ...v.layers.platforms.features] as unknown as Feature[]),
          );
          setRailsGeo(fc((v.layers.rails?.features ?? []) as unknown as Feature[]));
        } catch {
          if (live) {
            setRailGeo(null);
            setRailsGeo(null);
          }
        } finally {
          e.dispose();
        }
      },
      () => {
        if (live) {
          setRailGeo(null);
          setRailsGeo(null);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [railway, showRail, loadRail]);

  useEffect(() => {
    if (!map) return;
    set(map, SRC.rail, showRail && railGeo ? railGeo : EMPTY);
    set(map, SRC.rails, showRail && railsGeo ? railsGeo : EMPTY);
  }, [map, railGeo, railsGeo, showRail]);

  useEffect(() => {
    if (!map) return;
    set(
      map,
      SRC.lines,
      fc([
        // The street tool draws the other street lines itself.
        ...(active === "street" ? [] : streetLinesGeoJson(streetLines)),
        ...pluginLinesGeoJson(pluginLines, active),
      ]),
    );
  }, [map, active, streetLines, pluginLines]);

  useEffect(() => {
    if (!map) return;
    set(map, SRC.depots, active === "depots" ? EMPTY : depotOutlinesGeoJson(depots));
  }, [map, active, depots]);

  return null;
}

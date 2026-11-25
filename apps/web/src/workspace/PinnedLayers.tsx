import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import type { Region } from "../features/benefits/regions";
import { loadRailEngine } from "../features/railways/engine";
import type { Network, RailEngineLoader, RailView } from "../features/railways/types";
import type { SavedStreetLine } from "../features/street-lines/saved";
import type { JunctionSetup, StreetSetup } from "../features/street-setup/types";
import type { SavedPluginLine } from "../kits/saved";
import { basemapLayers } from "../map/mapLayers";
import { PINNED_LAYERS, type PinnedLayer } from "../map/pinnedLayers";
import { pluginLinesGeoJson, streetLinesGeoJson } from "./OtherModesLayer";

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: object };
const fc = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });
const isLine = (f: Feature) => (f.geometry as { type: string }).type === "LineString";
const isPoint = (f: Feature) => (f.geometry as { type: string }).type === "Point";

/** Each kept layer's source and map layers. Ids start `pin-`: no tool removes them and the layer control's
 * project groups never hide them. */
const LAYERS: Record<PinnedLayer, LayerSpecification[]> = {
  regions: [
    {
      id: "pin-regions-fill",
      type: "fill",
      source: "pin-regions",
      paint: { "fill-color": "#7c3aed", "fill-opacity": 0.08 },
    },
    {
      id: "pin-regions-line",
      type: "line",
      source: "pin-regions",
      paint: { "line-color": "#7c3aed", "line-width": 1.5 },
    },
  ],
  tracks: [
    {
      id: "pin-tracks",
      type: "line",
      source: "pin-tracks",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#334155", "line-width": 2.5 },
    },
  ],
  serviceLines: [
    {
      id: "pin-service-lines",
      type: "line",
      source: "pin-service-lines",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 3.5 },
    },
  ],
  streetSetups: [
    {
      id: "pin-street-setups",
      type: "circle",
      source: "pin-street-setups",
      paint: {
        "circle-radius": 5,
        "circle-color": "#f59e0b",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
  ],
  stations: [
    {
      id: "pin-stations-platforms",
      type: "fill",
      source: "pin-stations",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#64748b", "fill-opacity": 0.6 },
    },
    {
      id: "pin-stations",
      type: "circle",
      source: "pin-stations",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5.5,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 2,
      },
    },
  ],
  stops: [
    {
      id: "pin-stops",
      type: "circle",
      source: "pin-stops",
      paint: {
        "circle-radius": 4,
        "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2,
      },
    },
  ],
};
const SOURCE: Record<PinnedLayer, string> = {
  regions: "pin-regions",
  tracks: "pin-tracks",
  serviceLines: "pin-service-lines",
  streetSetups: "pin-street-setups",
  stations: "pin-stations",
  stops: "pin-stops",
};
/** Bottom to top: areas, then track, lines and points. */
const ORDER: PinnedLayer[] = ["regions", "tracks", "serviceLines", "streetSetups", "stations", "stops"];

export interface ProjectContent {
  railway: Network | null;
  streetLines: readonly SavedStreetLine[];
  pluginLines: Record<string, SavedPluginLine>;
  setups: readonly StreetSetup[];
  junctions: readonly JunctionSetup[];
  regions: readonly Region[];
}

/** Purpose: the layers the project has something in, so the layer control offers only those. */
export function pinnableLayers(c: ProjectContent): PinnedLayer[] {
  const plugin = Object.values(c.pluginLines).some((p) => p.line);
  const has: Record<PinnedLayer, boolean> = {
    serviceLines: c.streetLines.length > 0 || plugin || (c.railway?.lines?.length ?? 0) > 0,
    tracks: (c.railway?.tracks.length ?? 0) > 0,
    stations: (c.railway?.stations.length ?? 0) > 0,
    stops: c.streetLines.length > 0 || plugin,
    streetSetups: c.setups.some((s) => s.at) || c.junctions.length > 0,
    regions: c.regions.length > 0,
  };
  return PINNED_LAYERS.filter((id) => has[id]);
}

/** Purpose: the features of each layer. Rail service lines run straight from station to station. */
export function pinnedFeatures(c: ProjectContent, view: RailView | null): Record<PinnedLayer, Feature[]> {
  const street = streetLinesGeoJson(c.streetLines) as Feature[];
  const plugin = pluginLinesGeoJson(c.pluginLines, null) as Feature[];
  const at = new Map((view?.stations ?? []).map((s) => [s.id, s.lonlat]));
  const rail: Feature[] = (c.railway?.lines ?? []).flatMap((l) => {
    const coords = l.stations.map((id) => at.get(id)).filter((p): p is [number, number] => !!p);
    return coords.length >= 2
      ? [
          {
            type: "Feature" as const,
            properties: { color: l.color },
            geometry: { type: "LineString", coordinates: coords },
          },
        ]
      : [];
  });
  return {
    serviceLines: [...street.filter(isLine), ...plugin.filter(isLine), ...rail],
    stops: [...street.filter(isPoint), ...plugin.filter(isPoint)],
    tracks: ((view?.layers.tracks.features ?? []) as unknown as Feature[]).filter(isLine),
    stations: [
      ...((view?.layers.platforms.features ?? []) as unknown as Feature[]),
      ...(view?.stations ?? []).map((s) => ({
        type: "Feature" as const,
        properties: { name: s.name },
        geometry: { type: "Point", coordinates: s.lonlat },
      })),
    ],
    streetSetups: [
      ...c.setups.flatMap((s) =>
        s.at
          ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Point", coordinates: s.at } }]
          : [],
      ),
      ...c.junctions.map((j) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point", coordinates: j.lonlat },
      })),
    ],
    regions: c.regions
      .filter((r) => r.ring.length >= 3)
      .map((r) => ({
        type: "Feature" as const,
        properties: { name: r.name },
        geometry: { type: "Polygon", coordinates: [[...r.ring, r.ring[0]!]] },
      })),
  };
}

/**
 * Purpose: draw the project layers the person keeps shown (Map layers → Always show) on every map tab, whatever
 * tool is open, under the tools' own layers. They answer no clicks.
 * Side effects: adds and removes `pin-` sources and layers on the map.
 */
export function PinnedLayers({
  map,
  pinned,
  content,
  loadRail = loadRailEngine,
}: {
  map: MapLibreMap | null;
  pinned: ReadonlySet<PinnedLayer>;
  content: ProjectContent;
  loadRail?: RailEngineLoader;
}) {
  const needRail = pinned.has("tracks") || pinned.has("stations") || pinned.has("serviceLines");
  const railway = content.railway;
  const [view, setView] = useState<RailView | null>(null);
  useEffect(() => {
    if (!needRail || !railway || !(railway.tracks.length || railway.stations.length)) {
      setView(null);
      return;
    }
    let live = true;
    loadRail().then(
      (e) => {
        try {
          if (live) setView(e.build(railway, null));
        } catch {
          if (live) setView(null);
        } finally {
          e.dispose();
        }
      },
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [railway, needRail, loadRail]);

  const features = useMemo(() => pinnedFeatures(content, view), [content, view]);
  const key = [...pinned].sort().join();

  useEffect(() => {
    if (!map) return;
    const shown = ORDER.filter((id) => pinned.has(id));
    const add = () => {
      const base = basemapLayers(map);
      // Under the first tool layer (any layer that is not the basemap's, an overlay, the faded network or ours).
      const before = (map.getStyle()?.layers ?? []).find(
        (l) =>
          !base?.has(l.id) && !l.id.startsWith("ogc-") && !l.id.startsWith("om-") && !l.id.startsWith("pin-"),
      )?.id;
      for (const id of shown) {
        if (!map.getSource(SOURCE[id])) map.addSource(SOURCE[id], { type: "geojson", data: fc([]) });
        for (const l of LAYERS[id]) if (!map.getLayer(l.id)) map.addLayer(l, before);
      }
    };
    add();
    return () => {
      for (const id of [...shown].reverse()) {
        for (const l of [...LAYERS[id]].reverse()) if (map.getLayer(l.id)) map.removeLayer(l.id);
        if (map.getSource(SOURCE[id])) map.removeSource(SOURCE[id]);
      }
    };
    // `key` stands for `pinned`.
  }, [map, key]);

  useEffect(() => {
    if (!map) return;
    for (const id of ORDER)
      if (pinned.has(id))
        (map.getSource(SOURCE[id]) as GeoJSONSource | undefined)?.setData(fc(features[id]) as never);
  }, [map, key, features]);

  return null;
}

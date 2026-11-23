import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { groupOf } from "../../map/mapLayers";
import { fetchStreetTile } from "../street-lines/engine";
import { tilesFor } from "../street-lines/tiles";
import type { TileFetcher } from "../street-lines/types";
import {
  LANE_MIN_ZOOM,
  loadLaneEngine,
  type LaneEngine,
  type LaneEngineLoader,
  type TrafficSide,
} from "./lanes";
import { LANE_COLOR } from "./mapLayers";
import type { StreetSetup } from "./types";

/** Source and layer of the faded lanes; `om-` like the other read-only backdrop layers, so no tool removes them. */
const SOURCE = "om-lanes";
const LAYER = "om-lanes";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** Purpose: put the lanes under every other backdrop and project layer (the first `om-` layer or tool layer). */
function sink(map: MapLibreMap): void {
  const first = map
    .getStyle?.()
    ?.layers?.find((l) => l.id !== LAYER && (l.id.startsWith("om-") || groupOf(l.id) !== null))?.id;
  if (first && map.getLayer(LAYER)) map.moveLayer(LAYER, first);
}

/**
 * Purpose: on the Create tab, the streets on screen drawn lane by lane (with the GIS tab's street setups),
 * faded under the tools from zoom 16, so tracks and lines are drawn where the street has room for them.
 * Rails come only from the tracks: a setup's tram lane without track is an empty strip.
 * Side effects: adds an `om-lanes` source and layer while mounted; fetches street tiles from zoom 16; runs the
 * lane engine in a Web Worker.
 */
export function LanesBackdrop({
  map,
  setups,
  trafficSide = "right",
  fetchTile = fetchStreetTile,
  loadLanes = loadLaneEngine,
}: {
  map: MapLibreMap | null;
  setups: readonly StreetSetup[];
  trafficSide?: TrafficSide;
  fetchTile?: TileFetcher;
  loadLanes?: LaneEngineLoader;
}) {
  const [engine, setEngine] = useState<LaneEngine | null>(null);
  const added = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    let e: LaneEngine | null = null;
    loadLanes()
      .then((x) => {
        if (!alive) return x?.dispose();
        e = x;
        setEngine(x);
      })
      // Without the lane engine the backdrop simply stays empty.
      .catch(() => undefined);
    return () => {
      alive = false;
      e?.dispose();
      added.current.clear();
    };
  }, [loadLanes]);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: "geojson", data: EMPTY });
    if (!map.getLayer(LAYER))
      map.addLayer({
        id: LAYER,
        type: "fill",
        source: SOURCE,
        minzoom: LANE_MIN_ZOOM,
        paint: {
          "fill-color": [
            "match",
            ["get", "kind"],
            ...Object.entries(LANE_COLOR).flat(),
            LANE_COLOR.traffic,
          ] as never,
          "fill-opacity": 0.35,
        },
      });
    sink(map);
    return () => {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !engine) return;
    let stopped = false;
    let seq = 0;
    const draw = async () => {
      if (stopped || map.getZoom() < LANE_MIN_ZOOM) return;
      const b = map.getBounds();
      const keys = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).map(
        ([x, y]) => `${x}/${y}`,
      );
      const mine = ++seq;
      await Promise.allSettled(
        keys
          .filter((k) => !added.current.has(k))
          .map(async (k) => {
            const [x, y] = k.split("/").map(Number);
            const xml = await fetchTile(x!, y!);
            if (stopped || added.current.has(k)) return;
            engine.addTile(k, xml);
            added.current.add(k);
          }),
      );
      if (stopped || mine !== seq) return;
      const have = keys.filter((k) => added.current.has(k));
      if (!have.length) return;
      try {
        const g = await engine.build(have, setups, trafficSide);
        if (stopped || mine !== seq) return;
        (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features: (g?.lanes ?? []).map((l) => {
            const ring: [number, number][] = [];
            for (let i = 0; i + 1 < l.ring.length; i += 2) ring.push([l.ring[i]!, l.ring[i + 1]!]);
            return {
              type: "Feature",
              properties: { kind: l.kind },
              geometry: { type: "Polygon", coordinates: [ring] },
            };
          }),
        } as never);
        sink(map);
      } catch {
        // A failed build leaves the last lanes drawn.
      }
    };
    const onMove = () => void draw();
    map.on("moveend", onMove);
    void draw();
    return () => {
      stopped = true;
      map.off("moveend", onMove);
    };
  }, [map, engine, setups, trafficSide, fetchTile]);

  return null;
}

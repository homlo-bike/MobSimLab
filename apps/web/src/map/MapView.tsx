import {
  AttributionControl,
  type IControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Basemap,
  basemapStyle,
  loadServerBasemaps,
  rememberBasemap,
  rememberedBasemap,
} from "./basemaps";
import { MapControls } from "./MapControls";
import { applyHidden, markBasemap, type OverlayGroup, switchBasemap } from "./mapLayers";

// MapLibre 6 looks for its worker next to its own module, which does not exist once Vite bundles it.
setWorkerUrl(workerUrl);

interface Props {
  /** Called once the map style has loaded, and with `null` when the map is removed. */
  onReady?: (map: MapLibreMap | null) => void;
}

/** A MapLibre control that only holds an element React renders into (the place search and layer buttons). */
class HostControl implements IControl {
  constructor(private readonly el: HTMLElement) {}
  onAdd() {
    return this.el;
  }
  onRemove() {
    this.el.remove();
  }
}

/**
 * Purpose: full-size MapLibre map with the basemap last picked in this browser and its attribution, the
 * place search and the layer control (basemaps and the project's layers) above the zoom buttons.
 * Side effects: creates a WebGL map on mount and removes it on unmount.
 */
export function MapView({ onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [basemap, setBasemap] = useState<Basemap>(rememberedBasemap);
  const [hidden, setHidden] = useState<ReadonlySet<OverlayGroup>>(() => new Set());
  const attribution = useRef<AttributionControl | null>(null);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  useEffect(() => {
    if (!container.current) return;
    const first = basemap;
    const map = new MapLibreMap({
      container: container.current,
      style: first.styleUrl,
      center: [10, 50],
      zoom: 4,
      attributionControl: false,
      transformStyle: (_, next) => basemapStyle(first, next),
    });
    attribution.current = new AttributionControl({
      compact: first.kind === "aerial",
      customAttribution: first.attribution,
    });
    map.addControl(attribution.current);
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl";
    map.addControl(new HostControl(el), "top-right");
    setHost(el);
    map.addControl(new NavigationControl(), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    map.on?.("load", () => {
      markBasemap(map);
      setMap(map);
      ready.current?.(map);
    });
    // Tools add their layers as they open: hide the new ones of hidden groups too.
    map.on?.("styledata", () => {
      if (hiddenNow.current.size) applyHidden(map, hiddenNow.current);
    });
    return () => {
      ready.current?.(null);
      setMap(null);
      setHost(null);
      map.remove();
    };
    // The map is made once; later basemap picks switch its style.
  }, []);

  useEffect(() => {
    if (map) applyHidden(map, hidden);
  }, [map, hidden]);

  // Keyed basemaps (Esri) are offered once the API says an Admin has saved their key.
  const [, setServerBasemaps] = useState(0);
  useEffect(() => {
    let live = true;
    void loadServerBasemaps().then((changed) => {
      if (live && changed) setServerBasemaps((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, []);

  const pickBasemap = (b: Basemap) => {
    if (b.id === basemap.id && b.day === basemap.day) return;
    setBasemap(b);
    rememberBasemap(b.id);
    if (!map) return;
    switchBasemap(map, b, () => applyHidden(map, hiddenNow.current));
    if (attribution.current) map.removeControl(attribution.current);
    attribution.current = new AttributionControl({
      compact: b.kind === "aerial",
      customAttribution: b.attribution,
    });
    map.addControl(attribution.current);
  };

  // MapLibre's stylesheet sets `position: relative` on the map element and, being unlayered, beats
  // Tailwind's `absolute`; so the map fills an absolutely positioned wrapper instead.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" data-testid="map" />
      {host &&
        createPortal(
          <MapControls
            map={map}
            basemap={basemap}
            onBasemap={pickBasemap}
            hidden={hidden}
            onHidden={setHidden}
          />,
          host,
        )}
    </div>
  );
}

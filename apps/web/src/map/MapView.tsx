import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";
import { DEFAULT_BASEMAP } from "./basemaps";

// MapLibre 6 looks for its worker next to its own module, which does not exist once Vite bundles it.
setWorkerUrl(workerUrl);

interface Props {
  /** Called once the map style has loaded, and with `null` when the map is removed. */
  onReady?: (map: MapLibreMap | null) => void;
}

/**
 * Purpose: full-size MapLibre map with the default basemap and its attribution.
 * Side effects: creates a WebGL map on mount and removes it on unmount.
 */
export function MapView({ onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: DEFAULT_BASEMAP.styleUrl,
      center: [10, 50],
      zoom: 4,
      attributionControl: false,
    });
    map.addControl(
      new AttributionControl({ compact: false, customAttribution: DEFAULT_BASEMAP.attribution }),
    );
    map.addControl(new NavigationControl(), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    map.on?.("load", () => ready.current?.(map));
    return () => {
      ready.current?.(null);
      map.remove();
    };
  }, []);

  // MapLibre's stylesheet sets `position: relative` on the map element and, being unlayered, beats
  // Tailwind's `absolute`; so the map fills an absolutely positioned wrapper instead.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" data-testid="map" />
    </div>
  );
}

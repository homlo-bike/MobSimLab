import { AttributionControl, Map as MapLibreMap, NavigationControl, ScaleControl } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { DEFAULT_BASEMAP } from "./basemaps";

/**
 * Purpose: full-size MapLibre map with the default basemap and its attribution.
 * Side effects: creates a WebGL map on mount and removes it on unmount.
 */
export function MapView() {
  const container = useRef<HTMLDivElement>(null);

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
    return () => map.remove();
  }, []);

  return <div ref={container} className="absolute inset-0" data-testid="map" />;
}

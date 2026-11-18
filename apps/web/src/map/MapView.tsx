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
  availableBasemaps,
  availableOverlays,
  DEFAULT_BASEMAP,
  onServerBasemaps,
  refreshServerBasemaps,
  rememberBasemap,
  rememberedBasemap,
  rememberedBasemapId,
  themedBasemap,
} from "./basemaps";
import { activePlugins } from "../plugins/registry";
import { isDark, useDark } from "../shell/theme";
import { applyMapTheme } from "./darkLayers";
import { MapControls } from "./MapControls";
import { applyHidden, markBasemap, type OverlayGroup, switchBasemap } from "./mapLayers";
import { applyOverlays, rememberOverlays, rememberedOverlays } from "./overlays";

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

/** How long the map waits for the API's keyed basemaps before tools get it with the default basemap. */
const SERVER_WAIT_MS = 5000;

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
  /** The WMS and WMTS overlays shown (ids of layers an Admin added). */
  const [overlays, setOverlays] = useState<ReadonlySet<string>>(rememberedOverlays);
  const attribution = useRef<AttributionControl | null>(null);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;
  const dark = useDark();
  /** The style the map draws now, so a theme change only reloads a basemap that has a dark design. */
  const drawn = useRef<string | null>(null);
  /** Whether the basemap drawn now is a dark one, so the project's layers are drawn for it. */
  const darkMap = dark && Boolean(basemap.darkStyleUrl);
  const darkMapNow = useRef(darkMap);
  darkMapNow.current = darkMap;

  useEffect(() => {
    if (!container.current) return;
    const first = themedBasemap(basemap, isDark());
    drawn.current = first.styleUrl;
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
    let gone = false;
    const asked = refreshServerBasemaps();
    map.on?.("load", () => {
      markBasemap(map);
      const give = () => {
        setMap(map);
        ready.current?.(map);
      };
      // A remembered basemap is drawn before the tools get the map: their layers added while its style
      // loads threw "Style is not done loading" and blanked the page (Damascus bug 14).
      const decide = () => {
        if (gone) return;
        if (restore.current(map)) map.once("style.load", give);
        else give();
      };
      // A keyed basemap (Esri) is offered once the API answers, so wait for that answer, a few seconds at most.
      const wanted = rememberedBasemapId();
      if (wanted && wanted !== DEFAULT_BASEMAP.id && !availableBasemaps().some((b) => b.id === wanted))
        void Promise.race([asked, new Promise((r) => setTimeout(r, SERVER_WAIT_MS))]).then(decide);
      else decide();
    });
    // Tools add their layers as they open: hide the new ones of hidden groups too.
    map.on?.("styledata", () => {
      if (hiddenNow.current.size) applyHidden(map, hiddenNow.current);
      applyMapTheme(map, darkMapNow.current);
    });
    return () => {
      gone = true;
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

  // Keyed basemaps (Esri) are offered once the API says an Admin has saved their key, also when the key is saved
  // while this map is open. A keyed basemap picked before a reload comes back once it is offered again.
  const [, setServerBasemaps] = useState(0);
  const pickNow = useRef<(b: Basemap, on: MapLibreMap | null) => void>(() => {});
  const basemapNow = useRef(basemap);
  basemapNow.current = basemap;
  /** Draws the remembered basemap if it is offered and not drawn yet; true when it starts switching. */
  const restore = useRef<(on?: MapLibreMap | null) => boolean>(() => false);
  restore.current = (on = map) => {
    // Only on a loaded map, so the style really switches; the map's load runs this again.
    if (!on) return false;
    const wanted = rememberedBasemapId();
    const offered = availableBasemaps().find((b) => b.id === wanted);
    if (!offered || basemapNow.current.id !== DEFAULT_BASEMAP.id || wanted === DEFAULT_BASEMAP.id)
      return false;
    pickNow.current(offered, on);
    return true;
  };
  useEffect(() => void restore.current(), [map]);
  useEffect(() => {
    const stop = onServerBasemaps(() => {
      setServerBasemaps((n) => n + 1);
      restore.current();
    });
    return stop;
  }, []);

  useEffect(() => {
    if (map) applyMapTheme(map, darkMap);
  }, [map, darkMap]);

  // WMS and WMTS overlays: drawn when picked, also once the API offers them or the project's plugins change.
  const [serverVersion, setServerVersion] = useState(0);
  useEffect(() => onServerBasemaps(() => setServerVersion((n) => n + 1)), []);
  const activeNow = activePlugins();
  useEffect(() => {
    if (!map) return;
    const draw = () => {
      try {
        applyOverlays(map, availableOverlays(), overlays);
      } catch {
        // The style is loading (a basemap switch): the switch's own load draws them.
      }
    };
    draw();
    map.on?.("style.load", draw);
    return () => void map.off?.("style.load", draw);
  }, [map, overlays, serverVersion, activeNow]);
  const pickOverlays = (ids: ReadonlySet<string>) => {
    setOverlays(ids);
    rememberOverlays(ids);
  };

  // Dark mode switched on or off: draw the basemap's other design, if it has one.
  useEffect(() => {
    if (!map) return;
    const shown = themedBasemap(basemap, dark);
    if (shown.styleUrl === drawn.current) return;
    drawn.current = shown.styleUrl;
    switchBasemap(map, shown, () => applyHidden(map, hiddenNow.current));
    // Only the theme: picking a basemap switches it below.
  }, [map, dark]);

  const pickBasemap = (b: Basemap, on: MapLibreMap | null = map) => {
    const now = basemapNow.current;
    if (b.id === now.id && b.day === now.day) return;
    // Now, not on the next render: the restore can run twice before it (map load, then the server's
    // basemaps), and a second switch while the first style loads blanked the page (Damascus bug 14).
    basemapNow.current = b;
    setBasemap(b);
    rememberBasemap(b.id);
    if (!on) return;
    const shown = themedBasemap(b, dark);
    drawn.current = shown.styleUrl;
    switchBasemap(on, shown, () => applyHidden(on, hiddenNow.current));
    if (attribution.current) on.removeControl(attribution.current);
    attribution.current = new AttributionControl({
      compact: b.kind === "aerial",
      customAttribution: b.attribution,
    });
    on.addControl(attribution.current);
  };
  pickNow.current = pickBasemap;

  // MapLibre's stylesheet sets `position: relative` on the map element and, being unlayered, beats
  // Tailwind's `absolute`; so the map fills an absolutely positioned wrapper instead.
  return (
    <div className={`absolute inset-0${darkMap ? " map-dark" : ""}`}>
      <div ref={container} className="h-full w-full" data-testid="map" />
      {host &&
        createPortal(
          <MapControls
            map={map}
            basemap={basemap}
            onBasemap={(b) => pickBasemap(b)}
            hidden={hidden}
            onHidden={setHidden}
            overlays={overlays}
            onOverlays={pickOverlays}
          />,
          host,
        )}
    </div>
  );
}

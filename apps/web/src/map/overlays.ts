import type { Map as MapLibreMap } from "maplibre-gl";
import type { ServiceLayer } from "./basemaps";
import { basemapLayers } from "./mapLayers";

/** How much of the basemap shows through an overlay. */
export const OVERLAY_OPACITY = 0.85;

/**
 * Purpose: draw the picked WMS and WMTS overlays over the basemap and under the project's layers, and take away
 * those no longer picked or offered. Their ids start `ogc-`, so a basemap switch keeps them and the layer
 * control's project groups never hide them. Each source carries its attribution, which the map shows.
 * Side effects: adds and removes the map's `ogc-` sources and layers.
 */
export function applyOverlays(
  map: MapLibreMap,
  offered: readonly ServiceLayer[],
  shown: ReadonlySet<string>,
): void {
  const style = map.getStyle();
  if (!style) return;
  const base = basemapLayers(map);
  const want = offered.filter((l) => shown.has(l.id) && !base?.has(l.id));
  const wantIds = new Set(want.map((l) => l.id));
  // An Admin's layer drawn as the basemap has an `ogc-` id too: it is the basemap's, not an overlay.
  const overlay = (id: string) => id.startsWith("ogc-") && !wantIds.has(id) && !base?.has(id);
  for (const l of style.layers ?? []) if (overlay(l.id) && map.getLayer(l.id)) map.removeLayer(l.id);
  for (const id of Object.keys(style.sources ?? {}))
    if (overlay(id) && !map.getLayer(id) && map.getSource(id)) map.removeSource(id);
  for (const l of want) {
    if (map.getLayer(l.id)) continue;
    if (!map.getSource(l.id))
      map.addSource(l.id, {
        type: "raster",
        tiles: l.tiles.map((t) => (t.startsWith("/") ? `${window.location.origin}${t}` : t)),
        tileSize: l.tileSize,
        minzoom: l.minzoom,
        maxzoom: l.maxzoom,
        ...(l.bounds ? { bounds: l.bounds } : {}),
        attribution: escapeHtml(l.attribution),
      });
    // Under the first of the project's own layers, so drawings stay on top.
    const before = (map.getStyle()?.layers ?? []).find(
      (x) => !base?.has(x.id) && !x.id.startsWith("ogc-"),
    )?.id;
    map.addLayer(
      { id: l.id, type: "raster", source: l.id, paint: { "raster-opacity": OVERLAY_OPACITY } },
      before,
    );
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const STORAGE_KEY = "mobsimlab.overlays";

/** Purpose: the overlays last shown in this browser (a per-viewer convenience). */
export function rememberedOverlays(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Purpose: remember the overlays shown in this browser. */
export function rememberOverlays(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

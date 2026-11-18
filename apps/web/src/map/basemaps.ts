import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { activePlugins, type Plugin, type PluginBasemap, pluginBasemaps } from "../plugins/registry";

/** A basemap the user can pick. Attribution is mandatory and always rendered. */
export interface Basemap {
  id: string;
  /** Shown in the layer control. Product names, so they are not translated. */
  label: string;
  /** "street" maps are drawn from OpenStreetMap; "aerial" shows imagery under the place and street names. */
  kind: "street" | "aerial";
  styleUrl: string;
  /** The style drawn instead in dark mode (App settings), when the basemap has a dark design. */
  darkStyleUrl?: string;
  attribution: string;
  /** For aerial basemaps: the imagery drawn under the labels of `styleUrl`. Tile URLs may hold `{date}`. */
  imagery?: {
    id: string;
    tiles: string[];
    tileSize: number;
    maxzoom: number;
    minzoom?: number;
    /** [west, south, east, north]: the map asks for no tiles outside. */
    bounds?: [number, number, number, number];
  };
  /** Shown in the layer control instead of "Aerial" or "Street map" (WMS, WMTS or XYZ for an Admin's service). */
  tag?: string;
  /** Plugin basemaps: one sentence on the imagery (its resolution), shown instead of the core note. */
  note?: string;
  /** Daily imagery (plugin basemaps): the first day there is, and how many days the newest lags behind today. */
  date?: { first: string; latencyDays: number };
  /** The day picked for daily imagery (YYYY-MM-DD); the newest day when not set. */
  day?: string;
  /** Plugin basemaps whose tiles come through the API with an Admin's key (`esri`). */
  server?: string;
}

const OSM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';

/**
 * Default basemap: OpenFreeMap Positron (free, no key), and OpenFreeMap Dark in dark mode. Data © OpenStreetMap
 * contributors (ODbL), schema by OpenMapTiles. See docs/compliance/license-compliance-report.md §6.
 */
export const DEFAULT_BASEMAP: Basemap = {
  id: "openfreemap-positron",
  label: "OpenFreeMap Positron",
  kind: "street",
  styleUrl: "https://tiles.openfreemap.org/styles/positron",
  darkStyleUrl: "https://tiles.openfreemap.org/styles/dark",
  attribution: OSM_ATTRIBUTION,
};

/** Purpose: the basemap as drawn in the page's theme: its dark style in dark mode, when it has one. */
export function themedBasemap(basemap: Basemap, dark: boolean): Basemap {
  return dark && basemap.darkStyleUrl ? { ...basemap, styleUrl: basemap.darkStyleUrl } : basemap;
}

/**
 * The basemaps in the layer control (docs/architecture/06-gis.md §8): the three OpenFreeMap styles and the
 * Sentinel-2 cloudless 2016 mosaic by EOX (CC BY 4.0, about 10 m per pixel) under the OpenFreeMap Liberty
 * labels. Later EOX years (non-commercial licence) and Esri World Imagery need an admin's consent and the
 * gateway's tile proxy, so they are not offered here.
 */
export const BASEMAPS: readonly Basemap[] = [
  DEFAULT_BASEMAP,
  {
    id: "openfreemap-liberty",
    label: "OpenFreeMap Liberty",
    kind: "street",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    attribution: OSM_ATTRIBUTION,
  },
  {
    id: "openfreemap-bright",
    label: "OpenFreeMap Bright",
    kind: "street",
    styleUrl: "https://tiles.openfreemap.org/styles/bright",
    attribution: OSM_ATTRIBUTION,
  },
  {
    id: "eox-s2cloudless-2016",
    label: "Sentinel-2 cloudless 2016",
    kind: "aerial",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    attribution:
      '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless – https://s2maps.eu</a> by ' +
      '<a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> ' +
      "(Contains modified Copernicus Sentinel data 2016) · " +
      OSM_ATTRIBUTION,
    imagery: {
      id: "eox-s2cloudless-2016",
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
      tileSize: 256,
      maxzoom: 15,
    },
  },
];

/** Labels over plugin imagery: the OpenFreeMap Liberty style, as for the Sentinel-2 mosaic. */
const PLUGIN_LABELS_STYLE = "https://tiles.openfreemap.org/styles/liberty";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Purpose: a plugin's basemap as the layer control shows it, with its attribution and the labels' own. */
export function pluginBasemap(b: PluginBasemap): Basemap {
  const text = escapeHtml(b.attribution.text);
  const credit = b.attribution.url
    ? `<a href="${escapeHtml(b.attribution.url)}" target="_blank" rel="noopener">${text}</a>`
    : text;
  return {
    id: b.id,
    label: b.label,
    kind: "aerial",
    styleUrl: PLUGIN_LABELS_STYLE,
    attribution: `${credit} · ${OSM_ATTRIBUTION}`,
    imagery: { id: b.id, tiles: b.tiles, tileSize: b.tileSize, maxzoom: b.maxzoom },
    ...(b.note ? { note: b.note } : {}),
    ...(b.date ? { date: b.date } : {}),
    ...(b.server ? { server: b.server } : {}),
  };
}

/** Keyed basemaps the API offers now (an Admin saved their key), from `GET /api/basemaps`. */
let serverBasemaps: ReadonlySet<string> = new Set();

/** The plugin whose WMS and WMTS layers an Admin adds; a project that turns it off shows none of them. */
export const OGC_PLUGIN = "org.mobsimlab.ogc-layers";

/** A WMS, WMTS or XYZ layer an Admin added (`layers` of `GET /api/basemaps`); its tiles come through the API. */
export interface ServiceLayer {
  id: string;
  label: string;
  service: string;
  kind: "wms" | "wmts" | "xyz";
  showAs: "basemap" | "overlay";
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
  attribution: string;
}

/** The WMS and WMTS layers the API offers now. */
let serviceLayers: readonly ServiceLayer[] = [];

function isServiceLayer(x: unknown): x is ServiceLayer {
  const l = x as Partial<ServiceLayer> | null;
  return (
    typeof l?.id === "string" &&
    /^ogc-[0-9a-f-]+-\d+$/.test(l.id) &&
    typeof l.label === "string" &&
    (l.showAs === "basemap" || l.showAs === "overlay") &&
    Array.isArray(l.tiles) &&
    l.tiles.every((t) => typeof t === "string" && t.startsWith("/api/map-layers/")) &&
    typeof l.tileSize === "number" &&
    typeof l.minzoom === "number" &&
    typeof l.maxzoom === "number" &&
    typeof l.attribution === "string"
  );
}

/** Purpose: an Admin's WMS or WMTS layer as a basemap: its tiles under the OpenFreeMap Liberty labels. */
export function serviceBasemap(l: ServiceLayer): Basemap {
  return {
    id: l.id,
    label: l.label,
    kind: "aerial",
    tag: l.kind.toUpperCase(),
    styleUrl: PLUGIN_LABELS_STYLE,
    attribution: `${escapeHtml(l.attribution)} · ${OSM_ATTRIBUTION}`,
    imagery: {
      id: l.id,
      tiles: l.tiles,
      tileSize: l.tileSize,
      minzoom: l.minzoom,
      maxzoom: l.maxzoom,
      ...(l.bounds ? { bounds: l.bounds } : {}),
    },
    note: "",
  };
}

/** Purpose: whether the open project uses the WMS and WMTS layers plugin. */
function serviceLayersOn(plugins: readonly Plugin[]): boolean {
  return plugins.some((p) => p.id === OGC_PLUGIN);
}

/** Purpose: the WMS and WMTS layers to offer as overlays over any basemap, when the project uses the plugin. */
export function availableOverlays(plugins: readonly Plugin[] = activePlugins()): ServiceLayer[] {
  return serviceLayersOn(plugins) ? serviceLayers.filter((l) => l.showAs === "overlay") : [];
}

/**
 * Purpose: ask the API which keyed basemaps (Esri) and WMS or WMTS layers an Admin has set up, so the layer
 * control offers them.
 * Output: whether the answer changed what is offered. Without an API (static viewer) none are offered.
 */
export async function loadServerBasemaps(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  let next: Set<string> = new Set();
  let layers: ServiceLayer[] = [];
  try {
    const res = await fetchImpl("/api/basemaps", { credentials: "same-origin" });
    if (res.ok) {
      const body = (await res.json()) as { available?: unknown; layers?: unknown };
      if (Array.isArray(body.available))
        next = new Set(body.available.filter((x): x is string => typeof x === "string"));
      if (Array.isArray(body.layers)) layers = body.layers.filter(isServiceLayer);
    }
  } catch {
    // No API here, or it cannot be reached: offer no keyed basemaps.
  }
  const changed =
    [...next].join() !== [...serverBasemaps].join() ||
    JSON.stringify(layers) !== JSON.stringify(serviceLayers);
  serverBasemaps = next;
  serviceLayers = layers;
  return changed;
}

const serverListeners = new Set<() => void>();

/**
 * Purpose: hear when the keyed basemaps on offer change (an Admin saved or removed a key), so open maps offer
 * them without a reload. Output: a function that stops listening.
 */
export function onServerBasemaps(listener: () => void): () => void {
  serverListeners.add(listener);
  return () => serverListeners.delete(listener);
}

/** Purpose: ask the API again which keyed basemaps it offers and tell the open maps when that changed. */
export async function refreshServerBasemaps(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (await loadServerBasemaps(fetchImpl)) for (const f of [...serverListeners]) f();
}

/** Purpose: the basemaps to offer: the core's, then those of the plugins turned on (ADR-0036). */
export function availableBasemaps(plugins: readonly Plugin[] = activePlugins()): Basemap[] {
  const core = new Set(BASEMAPS.map((b) => b.id));
  return [
    ...BASEMAPS,
    ...pluginBasemaps(plugins)
      .filter((b) => !core.has(b.id) && (!b.server || serverBasemaps.has(b.server)))
      .map(pluginBasemap),
    ...(serviceLayersOn(plugins)
      ? serviceLayers.filter((l) => l.showAs === "basemap").map(serviceBasemap)
      : []),
  ];
}

/** Purpose: the basemap with an id among `list`, else the default. */
export function basemapById(
  id: string | null | undefined,
  list: readonly Basemap[] = availableBasemaps(),
): Basemap {
  return list.find((b) => b.id === id) ?? DEFAULT_BASEMAP;
}

/** Purpose: the newest day a daily basemap has (today in UTC less its lag), as YYYY-MM-DD; null if not daily. */
export function newestDay(basemap: Basemap, now: Date = new Date()): string | null {
  if (!basemap.date) return null;
  const d = new Date(now.getTime() - basemap.date.latencyDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Purpose: the imagery's tile URLs for the picked day (or the newest one); the API's own paths (keyed basemaps)
 * made absolute, as MapLibre needs.
 */
export function imageryTiles(basemap: Basemap, now: Date = new Date()): string[] {
  const day = basemap.day ?? newestDay(basemap, now);
  return (basemap.imagery?.tiles ?? []).map((t) => {
    const url = day ? t.replaceAll("{date}", day) : t;
    return url.startsWith("/") ? `${window.location.origin}${url}` : url;
  });
}

/** Layer types of an OpenMapTiles style that are kept over imagery: names, and borders. */
function keptOverImagery(l: LayerSpecification): boolean {
  if (l.type === "symbol") return true;
  return l.type === "line" && "source-layer" in l && l["source-layer"] === "boundary";
}

/**
 * Purpose: a style whose OpenFreeMap sources give no credit of their own. Their tile description carries a credit
 * that differs from the basemap's `attribution` only in its links, and MapLibre showed both, one over the other
 * (Damascus phone test). A credit in the style's source takes the place of the tile description's, and an empty
 * one is not shown, so the basemap's `attribution` (which names the OpenStreetMap contributors) is the only one.
 */
function withoutTileCredits(style: StyleSpecification): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  let changed = false;
  for (const [id, src] of Object.entries(style.sources ?? {})) {
    const url = "url" in src && typeof src.url === "string" ? src.url : "";
    if (src.type === "vector" && url.startsWith("https://tiles.openfreemap.org/")) {
      sources[id] = { ...src, attribution: "" };
      changed = true;
    } else sources[id] = src;
  }
  return changed ? { ...style, sources } : style;
}

/**
 * Purpose: the style a basemap draws, from the style loaded from its `styleUrl`.
 * Street basemaps are used as they come. Aerial basemaps keep the vector source (place and street names,
 * which the naming rules also read) and its labels and borders, and draw the imagery under them.
 */
export function basemapStyle(basemap: Basemap, given: StyleSpecification): StyleSpecification {
  const loaded = withoutTileCredits(given);
  const img = basemap.imagery;
  if (!img) return loaded;
  return {
    ...loaded,
    sources: {
      ...loaded.sources,
      [img.id]: {
        type: "raster",
        tiles: imageryTiles(basemap),
        tileSize: img.tileSize,
        maxzoom: img.maxzoom,
        ...(img.minzoom ? { minzoom: img.minzoom } : {}),
        ...(img.bounds ? { bounds: img.bounds } : {}),
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#1f2a1f" } },
      { id: img.id, type: "raster", source: img.id },
      ...loaded.layers.filter(keptOverImagery),
    ],
  };
}

const STORAGE_KEY = "mobsimlab.basemap";

/** Purpose: the basemap last picked in this browser (a per-viewer convenience), else the default. */
export function rememberedBasemap(): Basemap {
  try {
    return basemapById(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_BASEMAP;
  }
}

/** Purpose: the id of the basemap last picked in this browser, even one not offered yet (Esri before the API says). */
export function rememberedBasemapId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Purpose: remember the basemap picked in this browser. */
export function rememberBasemap(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the pick lasts until the page is closed.
  }
}

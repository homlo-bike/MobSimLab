import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LonLat } from "./types";

/** What a kit editor draws besides its markers. */
export interface KitShapes {
  /** Line strings: sections or legs. `error` draws them red. */
  lines: { coords: LonLat[]; error?: boolean }[];
  /** Small points: towers or via points. */
  points: { lonlat: LonLat; label?: string }[];
  /** Polygons: speed zones (closed or being drawn). */
  zones?: LonLat[][];
}

const empty = { type: "FeatureCollection" as const, features: [] };

/** Purpose: add the sources and layers of one kit editor (`prefix` keeps editors apart). */
export function ensureKitLayers(map: MapLibreMap, prefix: string, color: string): void {
  if (map.getSource(`${prefix}-lines`)) return;
  map.addSource(`${prefix}-zones`, { type: "geojson", data: empty });
  map.addSource(`${prefix}-lines`, { type: "geojson", data: empty });
  map.addSource(`${prefix}-points`, { type: "geojson", data: empty });
  map.addLayer({
    id: `${prefix}-zones-fill`,
    type: "fill",
    source: `${prefix}-zones`,
    paint: { "fill-color": "#f59e0b", "fill-opacity": 0.15 },
  });
  map.addLayer({
    id: `${prefix}-zones-edge`,
    type: "line",
    source: `${prefix}-zones`,
    paint: { "line-color": "#d97706", "line-width": 1.5, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: `${prefix}-lines-casing`,
    type: "line",
    source: `${prefix}-lines`,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 7 },
  });
  map.addLayer({
    id: `${prefix}-lines`,
    type: "line",
    source: `${prefix}-lines`,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "error"], "#dc2626", color],
      "line-width": 4,
    },
  });
  map.addLayer({
    id: `${prefix}-points`,
    type: "circle",
    source: `${prefix}-points`,
    paint: {
      "circle-radius": 4,
      "circle-color": "#ffffff",
      "circle-stroke-color": color,
      "circle-stroke-width": 2,
    },
  });
}

/** Purpose: change the line colour (mode changed). */
export function setKitColor(map: MapLibreMap, prefix: string, color: string): void {
  if (!map.getLayer(`${prefix}-lines`)) return;
  map.setPaintProperty(`${prefix}-lines`, "line-color", ["case", ["get", "error"], "#dc2626", color]);
  map.setPaintProperty(`${prefix}-points`, "circle-stroke-color", color);
}

/** Purpose: draw the kit's shapes. */
export function drawKit(map: MapLibreMap, prefix: string, s: KitShapes): void {
  const set = (id: string, features: unknown[]) =>
    (map.getSource(id) as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    } as Parameters<GeoJSONSource["setData"]>[0]);
  set(
    `${prefix}-lines`,
    s.lines.map((l) => ({
      type: "Feature",
      properties: { error: Boolean(l.error) },
      geometry: { type: "LineString", coordinates: l.coords },
    })),
  );
  set(
    `${prefix}-points`,
    s.points.map((p) => ({
      type: "Feature",
      properties: { label: p.label ?? "" },
      geometry: { type: "Point", coordinates: p.lonlat },
    })),
  );
  set(
    `${prefix}-zones`,
    (s.zones ?? [])
      .filter((z) => z.length >= 2)
      .map((z) => ({
        type: "Feature",
        properties: {},
        geometry:
          z.length >= 3
            ? { type: "Polygon", coordinates: [[...z, z[0]]] }
            : { type: "LineString", coordinates: z },
      })),
  );
}

/** Purpose: remove the kit editor's layers and sources. */
export function removeKitLayers(map: MapLibreMap, prefix: string): void {
  for (const l of ["points", "lines", "lines-casing", "zones-edge", "zones-fill"])
    if (map.getLayer(`${prefix}-${l}`)) map.removeLayer(`${prefix}-${l}`);
  for (const s of ["points", "lines", "zones"])
    if (map.getSource(`${prefix}-${s}`)) map.removeSource(`${prefix}-${s}`);
}

/** Purpose: a numbered square marker element for a station or pier. */
export function stationElement(n: number, name: string, color: string, selected: boolean): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `${n}: ${name}`);
  el.title = `${n}. ${name}`;
  el.textContent = String(n);
  Object.assign(el.style, {
    width: "22px",
    height: "22px",
    boxSizing: "border-box",
    borderRadius: "5px",
    background: color,
    border: "2px solid #ffffff",
    boxShadow: selected ? "0 0 0 3px #f59e0b, 0 1px 3px rgba(0,0,0,.4)" : "0 1px 3px rgba(0,0,0,.4)",
    color: "#ffffff",
    font: "700 11px/18px system-ui, sans-serif",
    textAlign: "center",
    cursor: "pointer",
    userSelect: "none",
  });
  return el;
}

/** Purpose: load a JSON document from this device's storage, or `fallback`. */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Purpose: keep a JSON document in this device's storage (ignored when storage is unavailable). */
export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the drawing still works for this session.
  }
}

import type { Map as MapLibreMap } from "maplibre-gl";
import { activePlugins, type Plugin, type PluginStreetPhotos, pluginStreetPhotos } from "../plugins/registry";

interface PointFeature {
  type: "Feature";
  properties: { kind: "clicked" | "photo" };
  geometry: { type: "Point"; coordinates: [number, number] };
}
interface Points {
  type: "FeatureCollection";
  features: PointFeature[];
}

/** A street photo source as the map's Street photos panel offers it. */
export type StreetPhotoSource = PluginStreetPhotos & { plugin: string };

/** A photo near the clicked point, as `GET /api/street-photos/<provider>/near` lists it. */
export interface StreetPhoto {
  provider: string;
  ref: string;
  lon: number;
  lat: number;
  distanceM: number;
  takenAt: string | null;
  author: string | null;
  licence: { name: string; url: string | null } | null;
  heading: number | null;
  panorama: boolean;
  pageUrl: string;
}

/** Sources the API serves now, from `GET /api/street-photos` (keyed ones only once an Admin saved the key). */
let served: ReadonlySet<string> = new Set();
let asked: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

/**
 * Purpose: ask the API which street photo sources it serves. Output: whether that changed. Without an API (the
 * static viewer) none are offered, because the API looks the photos up.
 */
export async function loadStreetPhotoSources(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  let next = new Set<string>();
  try {
    const res = await fetchImpl("/api/street-photos", { credentials: "same-origin" });
    if (res.ok) {
      const body = (await res.json()) as { available?: unknown };
      if (Array.isArray(body.available))
        next = new Set(body.available.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    // No API here: no street photos.
  }
  const changed = [...next].join() !== [...served].join();
  served = next;
  if (changed) for (const l of listeners) l();
  return changed;
}

/** Purpose: ask the API once per page (again with `again`, such as after an Admin saved a key). */
export function refreshStreetPhotoSources(again = false): Promise<boolean> {
  if (!asked || again) asked = loadStreetPhotoSources();
  return asked;
}

/** Purpose: call `f` whenever the served sources change. Output: a function that stops it. */
export function onStreetPhotoSources(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Purpose: the street photo sources of the open project's plugins that the API serves now. */
export function streetPhotoSources(plugins: readonly Plugin[] = activePlugins()): StreetPhotoSource[] {
  return pluginStreetPhotos(plugins).filter((s) => served.has(s.provider));
}

/** For tests: forget what the API said. */
export function resetStreetPhotoSources(): void {
  served = new Set();
  asked = null;
}

const SOURCE = "sp-coverage";
const LINES = "sp-coverage-lines";
const POINTS = "sp-coverage-points";
const PICKED = "sp-picked";

/**
 * Purpose: draw where the source has photos: its sequences as lines and, closer in, each photo as a dot, above
 * the project's layers while the panel is open. Replaces the coverage of another source.
 */
export function showCoverage(map: MapLibreMap, s: StreetPhotoSource): void {
  hideCoverage(map);
  const color = s.color ?? "#e2541b";
  map.addSource(SOURCE, {
    type: "vector",
    tiles: s.coverage.tiles.map((t) => (t.startsWith("/") ? `${location.origin}${t}` : t)),
    minzoom: s.coverage.minzoom,
    maxzoom: s.coverage.maxzoom,
    attribution: s.attribution.url
      ? `<a href="${escapeHtml(s.attribution.url)}" target="_blank" rel="noopener">${escapeHtml(s.attribution.text)}</a>`
      : escapeHtml(s.attribution.text),
  });
  map.addLayer({
    id: LINES,
    type: "line",
    source: SOURCE,
    "source-layer": s.coverage.lines.sourceLayer,
    minzoom: s.coverage.lines.minzoom,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-opacity": 0.8,
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1, 14, 3, 18, 5],
    },
  });
  if (s.coverage.points)
    map.addLayer({
      id: POINTS,
      type: "circle",
      source: SOURCE,
      "source-layer": s.coverage.points.sourceLayer,
      minzoom: s.coverage.points.minzoom,
      paint: {
        "circle-color": color,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2.5, 19, 5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
      },
    });
}

/** Purpose: remove the coverage and the picked photo's mark. */
export function hideCoverage(map: MapLibreMap): void {
  for (const id of [PICKED, POINTS, LINES]) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [PICKED, SOURCE]) if (map.getSource(id)) map.removeSource(id);
}

/** Purpose: mark where the photo on show was taken, with the clicked point; null clears the mark. */
export function markPicked(
  map: MapLibreMap,
  photo: StreetPhoto | null,
  clicked: [number, number] | null,
): void {
  const features: PointFeature[] = [];
  if (clicked)
    features.push({
      type: "Feature",
      properties: { kind: "clicked" },
      geometry: { type: "Point", coordinates: clicked },
    });
  if (photo)
    features.push({
      type: "Feature",
      properties: { kind: "photo" },
      geometry: { type: "Point", coordinates: [photo.lon, photo.lat] },
    });
  const data: Points = { type: "FeatureCollection", features };
  const src = map.getSource(PICKED) as { setData?: (d: Points) => void } | undefined;
  if (src?.setData) {
    src.setData(data);
    return;
  }
  if (!features.length) return;
  map.addSource(PICKED, { type: "geojson", data });
  map.addLayer({
    id: PICKED,
    type: "circle",
    source: PICKED,
    paint: {
      "circle-color": ["match", ["get", "kind"], "photo", "#1d4ed8", "#ffffff"],
      "circle-radius": ["match", ["get", "kind"], "photo", 7, 5],
      "circle-stroke-color": ["match", ["get", "kind"], "photo", "#ffffff", "#1d4ed8"],
      "circle-stroke-width": 2,
    },
  });
}

/** Purpose: the photos the API finds near a point, nearest first. Throws with the API's message on failure. */
export async function photosNear(
  provider: string,
  at: [number, number],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StreetPhoto[]> {
  const q = new URLSearchParams({ lon: at[0].toFixed(6), lat: at[1].toFixed(6) });
  const res = await fetchImpl(`/api/street-photos/${encodeURIComponent(provider)}/near?${q}`, {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
    } catch {
      // Keep the status.
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { photos?: StreetPhoto[] };
  return Array.isArray(body.photos) ? body.photos : [];
}

/** Purpose: the address of a photo's picture through the API (`thumb` small, `sd` to look at). */
export function photoUrl(p: Pick<StreetPhoto, "provider" | "ref">, size: "thumb" | "sd"): string {
  return `/api/street-photos/${encodeURIComponent(p.provider)}/photos/${encodeURIComponent(p.ref)}/${size}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

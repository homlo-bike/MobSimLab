import { tNow } from "../../i18n/i18n";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { LEGEND } from "./mapLayer";
import type { Indicator, LonLat, NoiseBuilding } from "./types";

/** Building tiles use the street tiles' zoom (about 1.5 km square at 50° N). */
export const BUILDING_TILE_ZOOM = 14;
/** At most this many building tiles for one noise map. */
export const MAX_BUILDING_TILES = 12;

/** Fetches one building tile: `{buildings: NoiseBuilding[]}` from the API. */
export type BuildingTileFetcher = (x: number, y: number) => Promise<NoiseBuilding[]>;

/** Purpose: fetch one tile of OSM building footprints from the API (cached server-side). */
export const fetchBuildingTile: BuildingTileFetcher = async (x, y) => {
  const res = await fetch(`/api/street-network/building-tiles/${BUILDING_TILE_ZOOM}/${x}/${y}`);
  if (res.status === 401) throw new Error(tNow("noise.signIn"));
  if (!res.ok) throw new Error(tNow("noise.buildingsDown"));
  return ((await res.json()) as { buildings?: NoiseBuilding[] }).buildings ?? [];
};

/**
 * Purpose: the zoom-14 tiles `[x, y]` covering points widened by `reachM`.
 * Output: all tiles, nearest the centre first (the caller decides whether there are too many).
 */
export function buildingTiles(points: LonLat[], reachM: number): [number, number][] {
  if (!points.length) return [];
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = reachM / 111_195;
  const dLon = dLat / Math.max(0.1, Math.cos((lat0 * Math.PI) / 180));
  const [w, s, e, n] = [
    Math.min(...lons) - dLon,
    Math.min(...lats) - dLat,
    Math.max(...lons) + dLon,
    Math.max(...lats) + dLat,
  ];
  const z = 2 ** BUILDING_TILE_ZOOM;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * z);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * z);
  };
  const out: [number, number][] = [];
  for (let x = tx(w); x <= tx(e); x++) for (let y = ty(n); y <= ty(s); y++) out.push([x, y]);
  const [cx, cy] = [(tx(w) + tx(e)) / 2, (ty(n) + ty(s)) / 2];
  return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
}

/** Purpose: buildings of several tiles, once each (a building on a tile edge comes in both). */
export async function loadBuildings(
  tiles: [number, number][],
  fetchTile: BuildingTileFetcher,
): Promise<NoiseBuilding[]> {
  const seen = new Map<string, NoiseBuilding>();
  for (const [x, y] of tiles) for (const b of await fetchTile(x, y)) if (!seen.has(b.id)) seen.set(b.id, b);
  return [...seen.values()];
}

export const BUILDINGS_SOURCE = "noise-buildings";
export const BUILDINGS_FILL = "noise-buildings-fill";
export const BUILDINGS_LINE = "noise-buildings-line";

/**
 * Purpose: show the buildings coloured by the level beside their most exposed side (grey where the
 * map does not reach), or remove them when `buildings` is null.
 * Side effects: adds, updates or removes the `noise-buildings` source and its two layers.
 */
export function drawBuildings(
  map: MapLibreMap,
  buildings: NoiseBuilding[] | null,
  levels: [number | null, number | null][] | undefined,
  indicator: Indicator,
  fromDb: number,
): void {
  if (!buildings) {
    removeBuildings(map);
    return;
  }
  const k = indicator === "lnight" ? 1 : 0;
  const data = {
    type: "FeatureCollection" as const,
    features: buildings.map((b, i) => ({
      type: "Feature" as const,
      properties: { level: levels?.[i]?.[k] ?? -1 },
      geometry: { type: "Polygon" as const, coordinates: [b.ring] },
    })),
  } as GeoJSONSourceSpecification["data"];
  const src = map.getSource(BUILDINGS_SOURCE) as GeoJSONSource | undefined;
  if (src) src.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
  else map.addSource(BUILDINGS_SOURCE, { type: "geojson", data });
  // Below `fromDb` (and not reached) the building is drawn grey; above, in the band's colour.
  const steps: (string | number)[] = [];
  for (const l of LEGEND) if (l.from_db >= fromDb) steps.push(l.from_db, l.color);
  const colour = ["step", ["get", "level"], "#cbd5e1", ...steps] as unknown as ExpressionSpecification;
  if (!map.getLayer(BUILDINGS_FILL))
    map.addLayer({
      id: BUILDINGS_FILL,
      type: "fill",
      source: BUILDINGS_SOURCE,
      paint: { "fill-color": colour, "fill-opacity": 0.9 },
    });
  else map.setPaintProperty(BUILDINGS_FILL, "fill-color", colour);
  if (!map.getLayer(BUILDINGS_LINE))
    map.addLayer({
      id: BUILDINGS_LINE,
      type: "line",
      source: BUILDINGS_SOURCE,
      paint: { "line-color": "#475569", "line-width": 0.5 },
    });
}

/** Purpose: remove the buildings layer. */
export function removeBuildings(map: MapLibreMap): void {
  for (const id of [BUILDINGS_LINE, BUILDINGS_FILL]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(BUILDINGS_SOURCE)) map.removeSource(BUILDINGS_SOURCE);
}

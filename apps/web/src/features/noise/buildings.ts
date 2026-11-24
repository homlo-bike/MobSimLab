import { tNow } from "../../i18n/i18n";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { LEGEND } from "./mapLayer";
import type { Indicator, LonLat, NoiseBuilding } from "./types";
import { noteSource, withProject } from "../../geodata/projectData";
import type { Corridor } from "./corridor";

/** Building tiles use the street tiles' zoom (about 1.5 km square at 50° N). */
export const BUILDING_TILE_ZOOM = 14;
/**
 * At most this many building tiles for one noise map: the tiles along a whole city's lines (Damascus's 13 lines
 * take about 100), as for a road run. Only the buildings near the lines are kept from each tile.
 */
export const MAX_BUILDING_TILES = 320;
/** Building tiles asked for at the same time. */
const PARALLEL_TILES = 4;
/**
 * How long to wait before asking again for a tile the API could not give (502/503/504, or no answer), ms. Tiles
 * outside the project's OpenStreetMap import come from the public Overpass API, which turns some away when a city's
 * worth of tiles is asked for at once; the API keeps a tile it got late, so the next try is usually quick.
 */
export const TILE_RETRY_MS = [5_000, 15_000, 30_000];

/** A building tile the API could not give; `retry` when asking again later may work. */
export class BuildingTileError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

/** Fetches one building tile: `{buildings: NoiseBuilding[]}` from the API. */
export type BuildingTileFetcher = (x: number, y: number) => Promise<NoiseBuilding[]>;

/** Purpose: fetch one tile of OSM building footprints from the API (cached server-side). */
export const fetchBuildingTile: BuildingTileFetcher = async (x, y) => {
  let res: Response;
  try {
    res = await fetch(withProject(`/api/street-network/building-tiles/${BUILDING_TILE_ZOOM}/${x}/${y}`));
  } catch {
    // No answer at all (the connection dropped): worth asking again.
    throw new BuildingTileError(tNow("noise.buildingsDown"), true);
  }
  noteSource(res);
  if (res.status === 401) throw new Error(tNow("noise.signIn"));
  if (!res.ok)
    throw new BuildingTileError(tNow("noise.buildingsDown"), res.status === 429 || res.status >= 500);
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

/**
 * Purpose: the zoom-14 tiles `[x, y]` the corridor along the lines touches, nearest the centre of their box
 * first. Lines that fan out across a city take the tiles along them, not the empty land between them.
 */
export function corridorTiles(corridor: Corridor): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const [w, s, e, n] of corridor.boxes()) {
    const [x0, y0, x1, y1] = [tileX(w), tileY(n), tileX(e), tileY(s)];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) seen.set(`${x}/${y}`, [x, y]);
  }
  const out = [...seen.values()];
  if (!out.length) return out;
  const xs = out.map((t) => t[0]);
  const ys = out.map((t) => t[1]);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return out.sort(
    (a, b) =>
      Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy) || a[1] - b[1] || a[0] - b[0],
  );
}

/** Purpose: the zoom-14 tile column of a longitude. */
function tileX(lon: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** BUILDING_TILE_ZOOM);
}

/** Purpose: the zoom-14 tile row of a latitude. */
function tileY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** BUILDING_TILE_ZOOM);
}

/**
 * Purpose: buildings of several tiles, once each (a building on a tile edge comes in both), in the order of the
 * tiles. A few tiles are asked for at a time.
 * Inputs: the tiles, the fetcher, and optionally a callback after each tile (tiles done, tiles in all), a
 * signal that stops before the next tile (throwing the signal's reason), which buildings to keep (all by
 * default; a city's tiles are kept to the buildings near the lines), and the waits before asking again for a
 * tile the API could not give (`TILE_RETRY_MS`). A tile that still fails after the last wait fails the whole load.
 */
export async function loadBuildings(
  tiles: [number, number][],
  fetchTile: BuildingTileFetcher,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  keep: (b: NoiseBuilding) => boolean = () => true,
  retryMs: readonly number[] = TILE_RETRY_MS,
): Promise<NoiseBuilding[]> {
  const fetchWithRetry = async (x: number, y: number): Promise<NoiseBuilding[]> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchTile(x, y);
      } catch (e) {
        if (failed || !(e instanceof BuildingTileError && e.retry) || attempt >= retryMs.length) throw e;
        await wait(retryMs[attempt]!, signal);
      }
    }
  };
  const got: NoiseBuilding[][] = new Array(tiles.length);
  let [next, done] = [0, 0];
  // Once a tile has failed for good the load has failed: the other workers stop asking.
  let failed = false;
  const worker = async () => {
    while (next < tiles.length && !failed) {
      signal?.throwIfAborted();
      const i = next++;
      const [x, y] = tiles[i]!;
      try {
        got[i] = (await fetchWithRetry(x, y)).filter(keep);
      } catch (e) {
        failed = true;
        throw e;
      }
      onProgress?.(++done, tiles.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_TILES, tiles.length) }, worker));
  signal?.throwIfAborted();
  const seen = new Map<string, NoiseBuilding>();
  for (const list of got) for (const b of list) if (!seen.has(b.id)) seen.set(b.id, b);
  return [...seen.values()];
}

/** Purpose: wait `ms`, or throw the signal's reason as soon as it is aborted. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
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

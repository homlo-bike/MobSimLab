/**
 * Location data for the benefit tables (ADR-0040), through the MobSimLab API: World Bank country figures,
 * WorldPop population of station catchments, OpenStreetMap buildings and places (schools, universities,
 * hospitals, clinics) by zoom-14 tile, and the OpenStreetMap areas a region can be imported from.
 */
import { BUILDING_TILE_ZOOM, buildingTiles } from "../noise/buildings";
import type { BuildingIn, CountryFigures, PlaceIn } from "./model";
import type { LonLat } from "./regions";

/** World Bank figures as the API answers them (benefits.service.ts). */
export interface BenefitIndicators {
  iso3: string;
  gdpPerCapita: { year: number; value: number } | null;
  employmentRatio: { year: number; value: number } | null;
  under15Share: { year: number; value: number } | null;
  population: { year: number; value: number } | null;
  populationWorldPopYear: { year: number; value: number } | null;
  source: { name: string; licence: string; url: string };
}

export interface PopulationAnswer {
  year: number;
  populations: Record<string, number | null>;
  failed: number;
  source: { name: string; licence: string; url: string };
}

export interface OsmArea {
  id: string;
  name: string;
  kind: string;
  adminLevel: number | null;
  ring: LonLat[];
  areaKm2: number;
}

/** The calls the benefit tables and the region tool make; tests pass their own. */
export interface BenefitsApi {
  indicators(code: string): Promise<BenefitIndicators>;
  population(areas: { id: string; ring: LonLat[] }[]): Promise<PopulationAnswer>;
  buildingTile(x: number, y: number): Promise<BuildingIn[]>;
  placeTile(x: number, y: number): Promise<PlaceIn[]>;
  osmAreas(at: LonLat): Promise<OsmArea[]>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { message?: string }) => j.message)
      .catch(() => undefined);
    throw new Error(msg ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Purpose: the benefit API over HTTP, with answers kept for the session. */
export function benefitsApi(fetchImpl: typeof fetch = (...a) => fetch(...a)): BenefitsApi {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, f: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit) return hit as Promise<T>;
    const p = f();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    return p;
  };
  const get = <T>(path: string) =>
    once(path, () => fetchImpl(path, { credentials: "same-origin" }).then((r) => json<T>(r)));
  return {
    indicators: (code) => get<BenefitIndicators>(`/api/benefits/indicators?code=${encodeURIComponent(code)}`),
    population: (areas) =>
      once(`pop:${JSON.stringify(areas)}`, () =>
        fetchImpl("/api/benefits/population", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ areas }),
        }).then((r) => json<PopulationAnswer>(r)),
      ),
    buildingTile: (x, y) =>
      get<{ buildings?: BuildingIn[] }>(
        `/api/street-network/building-tiles/${BUILDING_TILE_ZOOM}/${x}/${y}`,
      ).then((r) => r.buildings ?? []),
    placeTile: (x, y) =>
      get<{ places?: PlaceIn[] }>(`/api/street-network/place-tiles/${BUILDING_TILE_ZOOM}/${x}/${y}`).then(
        (r) => r.places ?? [],
      ),
    osmAreas: ([lon, lat]) =>
      get<{ areas: OsmArea[] }>(`/api/benefits/osm-areas?lon=${lon.toFixed(6)}&lat=${lat.toFixed(6)}`).then(
        (r) => r.areas,
      ),
  };
}

/** At most this many zoom-14 tiles of buildings and places for one estimate. */
export const MAX_TILES = 60;

/** Purpose: the zoom-14 tiles covering every station's catchment circle, nearest the network's centre first. */
export function catchmentTiles(stations: { at: LonLat; radius: number }[]): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const s of stations) for (const t of buildingTiles([s.at], s.radius)) seen.set(`${t[0]}/${t[1]}`, t);
  const tiles = [...seen.values()];
  if (!tiles.length) return tiles;
  const cx = tiles.reduce((a, t) => a + t[0], 0) / tiles.length;
  const cy = tiles.reduce((a, t) => a + t[1], 0) / tiles.length;
  return tiles.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
}

/** Purpose: buildings and places of the tiles, each once, four tiles at a time. Tiles that fail are counted. */
export async function loadTiles(
  api: BenefitsApi,
  tiles: [number, number][],
): Promise<{ buildings: BuildingIn[]; places: PlaceIn[]; failed: number }> {
  const b = new Map<string, BuildingIn>();
  const p = new Map<string, PlaceIn>();
  let failed = 0;
  const queue = [...tiles];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const [x, y] = t;
      const [bs, ps] = await Promise.allSettled([api.buildingTile(x, y), api.placeTile(x, y)]);
      if (bs.status === "fulfilled") for (const v of bs.value) b.set(v.id, v);
      else failed++;
      if (ps.status === "fulfilled") for (const v of ps.value) p.set(v.id, v);
      else failed++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { buildings: [...b.values()], places: [...p.values()], failed };
}

/** Purpose: the country figures the model uses, from the API's answer (percentages become shares). */
export function countryFigures(ind: BenefitIndicators | null): CountryFigures {
  const share = (v: { value: number } | null | undefined) =>
    v && Number.isFinite(v.value) ? v.value / 100 : null;
  const now = ind?.population?.value;
  const then = ind?.populationWorldPopYear?.value;
  return {
    gdpPerCapita: ind?.gdpPerCapita?.value ?? null,
    employmentRatio15: share(ind?.employmentRatio),
    under15: share(ind?.under15Share),
    popGrowth: now && then ? now / then : 1,
  };
}

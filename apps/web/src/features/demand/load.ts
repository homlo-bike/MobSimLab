/**
 * The location data a demand run's zones are estimated from, through the benefit tables' API calls:
 * WorldPop people in every zone, and OpenStreetMap buildings and places of the zoom-14 tiles under the zones.
 */
import { buildingTiles } from "../noise/buildings";
import type { BenefitsApi } from "../benefits/data";
import type { BuildingIn, PlaceIn } from "../benefits/model";
import type { LonLat } from "../benefits/regions";
import { type DemandZone, thinRing, zoneCentre, zoneKm2 } from "./zones";
import { engineErrorText } from "../../i18n/engine";

/** Most zoom-14 tiles of buildings and places loaded for one model area. */
export const MAX_ZONE_TILES = 160;
/** Areas per WorldPop request (the API takes up to 400). */
const POP_BATCH = 400;

export interface ZoneData {
  worldpop: Record<string, number | null>;
  popYear: number | null;
  /** Why some zones have no WorldPop count. */
  popReasons: string[];
  buildings: BuildingIn[];
  places: PlaceIn[];
  /** Tiles whose buildings and places were loaded, as "x/y". */
  loaded: Set<string>;
  failed: number;
  /** Tiles left out because the model area needs more than `MAX_ZONE_TILES`. */
  capped: number;
}

/** Purpose: the zoom-14 tile under a zone's centre, as "x/y". */
export function centreTile(z: DemandZone): string {
  const [t] = buildingTiles([zoneCentre(z)], 0);
  return t ? `${t[0]}/${t[1]}` : "";
}

/** Purpose: the tiles under the zones (each zone's circle of equal area), nearest the area's centre first. */
export function zoneTiles(zones: DemandZone[]): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const z of zones) {
    const r = Math.sqrt((zoneKm2(z) * 1e6) / Math.PI);
    for (const t of buildingTiles([zoneCentre(z)], r)) seen.set(`${t[0]}/${t[1]}`, t);
  }
  const tiles = [...seen.values()];
  if (!tiles.length) return tiles;
  const cx = tiles.reduce((a, t) => a + t[0], 0) / tiles.length;
  const cy = tiles.reduce((a, t) => a + t[1], 0) / tiles.length;
  return tiles.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
}

/**
 * Purpose: WorldPop people per zone and the buildings and places under the zones, four tiles at a time.
 * Tiles and WorldPop batches that fail are counted, not thrown; `onProgress` gets the share done (0–1).
 */
export async function loadZoneData(
  api: BenefitsApi,
  zones: DemandZone[],
  onProgress?: (done: number) => void,
): Promise<ZoneData> {
  const all = zoneTiles(zones);
  const tiles = all.slice(0, MAX_ZONE_TILES);
  const batches: { id: string; ring: LonLat[] }[][] = [];
  for (let i = 0; i < zones.length; i += POP_BATCH)
    batches.push(zones.slice(i, i + POP_BATCH).map((z) => ({ id: z.id, ring: thinRing(z.ring) })));
  const steps = tiles.length + batches.length || 1;
  let done = 0;
  const tick = () => onProgress?.(++done / steps);

  const worldpop: Record<string, number | null> = {};
  const reasons = new Set<string>();
  let popYear: number | null = null;
  for (const b of batches) {
    try {
      const r = await api.population(b);
      Object.assign(worldpop, r.populations);
      popYear = popYear ?? r.year;
      for (const x of r.reasons) reasons.add(x);
    } catch (e) {
      reasons.add(engineErrorText(e));
    }
    tick();
  }

  const b = new Map<string, BuildingIn>();
  const p = new Map<string, PlaceIn>();
  const loaded = new Set<string>();
  let failed = 0;
  const queue = [...tiles];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const [x, y] = t;
      const [bs, ps] = await Promise.allSettled([api.buildingTile(x, y), api.placeTile(x, y)]);
      if (bs.status === "fulfilled") for (const v of bs.value) b.set(v.id, v);
      if (ps.status === "fulfilled") for (const v of ps.value) p.set(v.id, v);
      if (bs.status === "fulfilled" && ps.status === "fulfilled") loaded.add(`${x}/${y}`);
      else failed++;
      tick();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return {
    worldpop,
    popYear,
    popReasons: [...reasons],
    buildings: [...b.values()],
    places: [...p.values()],
    loaded,
    failed,
    capped: Math.max(0, all.length - tiles.length),
  };
}

import { Injectable } from "@nestjs/common";
import { OverpassClient } from "../gateway/overpass.client";

/** Street tiles use this web-mercator zoom: about 2.4 km × 2.4 km at the equator, 1.5 km at 50° N. */
export const TILE_ZOOM = 14;
const CACHE_TILES = 256;

/** Road classes the street line router can use (see crates/street-routing `way_info`). */
const ROAD_CLASSES =
  "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|" +
  "tertiary|tertiary_link|unclassified|residential|living_street|service|road|busway|bus_guideway|pedestrian";

/** Purpose: bounding box `[south, west, north, east]` of a web-mercator tile. */
export function tileBbox(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lat(y + 1), lon(x), lat(y), lon(x + 1)];
}

/**
 * Purpose: Overpass QL for the streets of one tile: road ways with all their nodes, and the
 * turn restrictions on them. Ways are returned whole, so neighbouring tiles join up.
 */
export function streetQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:xml][timeout:90][maxsize:67108864];` +
    `way["highway"~"^(${ROAD_CLASSES})$"](${b})->.w;` +
    `node(w.w)->.n;` +
    `rel(bw.w)["type"="restriction"]->.r;` +
    `(.n;.w;.r;);out body;`
  );
}

/** Ways people may walk along (see crates/street-routing `walk::walk_way`), for walk coverage (ADR-0035). */
const WALK_CLASSES =
  "footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|" +
  "secondary|secondary_link|primary|primary_link|trunk|trunk_link|track|road|cycleway|bridleway|corridor|platform";

/**
 * Purpose: Overpass QL for the walkable ways of one tile with all their nodes (crossing and signal tags
 * included). Ways are returned whole, so neighbouring tiles join up.
 */
export function walkQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:xml][timeout:120][maxsize:134217728];` +
    `way["highway"~"^(${WALK_CLASSES})$"](${b})->.w;` +
    `node(w.w)->.n;` +
    `(.n;.w;);out body;`
  );
}

/** Railway kinds the railway design tool shows as existing infrastructure (crates/rail-design `existing`). */
const RAIL_KINDS =
  "rail|light_rail|tram|subway|narrow_gauge|monorail|funicular|construction|disused|preserved";

/**
 * Purpose: Overpass QL for the railway tracks of one tile with all their nodes (switches, buffer stops,
 * level crossings and signals carry tags). Ways are returned whole, so neighbouring tiles join up.
 */
export function railQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:xml][timeout:90][maxsize:67108864];` +
    `way["railway"~"^(${RAIL_KINDS})$"](${b})->.w;` +
    `node(w.w)->.n;` +
    `(.n;.w;);out body;`
  );
}

/**
 * Purpose: Overpass QL for the buildings of one tile (ways and multipolygons tagged `building`, not
 * `building=no`), as JSON with tags and geometry, for the noise map (ADR-0038 step N2).
 */
export function buildingQuery(z: number, x: number, y: number): string {
  const b = tileBbox(z, x, y)
    .map((v) => v.toFixed(7))
    .join(",");
  return (
    `[out:json][timeout:120][maxsize:67108864];` +
    `(way["building"]["building"!="no"](${b});` +
    `rel["building"]["building"!="no"]["type"="multipolygon"](${b}););` +
    `out tags geom;`
  );
}

/** One building as the noise map takes it: outer ring `[lon, lat]` and what OSM says of its height and use. */
export interface BuildingFootprint {
  id: string;
  ring: [number, number][];
  height_m?: number;
  levels?: number;
  /** True when tagged as housing, false when tagged as another use, absent when not said (`building=yes`). */
  homes?: boolean;
}

/** `building=*` values that are housing (OSM wiki, Key:building, "Accommodation"). */
const HOME_BUILDINGS = new Set([
  "apartments",
  "bungalow",
  "cabin",
  "detached",
  "dormitory",
  "farm",
  "ger",
  "house",
  "houseboat",
  "residential",
  "semidetached_house",
  "static_caravan",
  "stilt_house",
  "terrace",
  "tree_house",
  "trullo",
]);

/**
 * Purpose: whether a building holds homes, from its `building` value: true for housing, false
 * for any other named use (shop, office, garage, church…), undefined for `yes` and unknown values
 * used only as building parts or construction states.
 */
export function buildingHomes(tags: Record<string, string>): boolean | undefined {
  const v = (tags.building ?? "").trim().toLowerCase();
  if (HOME_BUILDINGS.has(v)) return true;
  if (v === "" || v === "yes" || v === "construction" || v === "no") return undefined;
  return false;
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

/** Purpose: a number from an OSM value such as "12", "12.5 m" or "3;4" (the first); undefined otherwise. */
export function osmNumber(v: string | undefined): number | undefined {
  const m = v?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|metres?|meters?)?(?:\s*;.*)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Purpose: the footprints in an Overpass JSON answer. Ways give one ring; multipolygons give each
 * closed outer member. Unclosed rings and underground buildings are left out.
 */
export function footprints(json: string): BuildingFootprint[] {
  const els = (JSON.parse(json) as { elements?: OverpassElement[] }).elements ?? [];
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const ring = (g: OverpassElement["geometry"]): [number, number][] | null => {
    if (!g || g.length < 4 || g.some((p) => !p)) return null;
    const pts = (g as { lat: number; lon: number }[]).map((p) => [r7(p.lon), r7(p.lat)] as [number, number]);
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    return a[0] === b[0] && a[1] === b[1] ? pts : null;
  };
  const out: BuildingFootprint[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    if (t.location === "underground" || Number(t.layer) < 0) continue;
    const height = {
      height_m: osmNumber(t.height),
      levels: osmNumber(t["building:levels"]),
      homes: buildingHomes(t),
    };
    const rings =
      e.type === "way"
        ? [ring(e.geometry)]
        : (e.members ?? [])
            .filter((m) => m.type === "way" && m.role === "outer")
            .map((m) => ring(m.geometry));
    rings.forEach((r, i) => {
      if (r) out.push({ id: `${e.type[0]}${e.id}${i ? `-${i}` : ""}`, ring: r, ...clean(height) });
    });
  }
  return out;
}

function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Purpose: the zoom-14 tiles `[x, y]` covering a bounding box `[west, south, east, north]`. */
export function tilesFor(bbox: [number, number, number, number], z = TILE_ZOOM): [number, number][] {
  const n = 2 ** z;
  const tx = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const ty = (lat: number) => {
    const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  };
  const out: [number, number][] = [];
  for (let x = tx(bbox[0]); x <= tx(bbox[2]); x++)
    for (let y = ty(bbox[3]); y <= ty(bbox[1]); y++) out.push([x, y]);
  return out;
}

/**
 * Streets for the street line editor, fetched tile by tile from OSM through the gateway's
 * Overpass client and cached in memory. Replaced by the project's imported OSM network in Phase 2.
 * Data © OpenStreetMap contributors, ODbL.
 */
@Injectable()
export class StreetNetworkService {
  private readonly cache = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly overpass: OverpassClient) {}

  /** Purpose: OSM XML for the streets of tile x/y at TILE_ZOOM. Side effects: may call Overpass. */
  tile(x: number, y: number): Promise<string> {
    return this.cached(`road/${x}/${y}`, () => streetQuery(TILE_ZOOM, x, y));
  }

  /** Purpose: OSM XML for the railway tracks of tile x/y at TILE_ZOOM. Side effects: may call Overpass. */
  railTile(x: number, y: number): Promise<string> {
    return this.cached(`rail/${x}/${y}`, () => railQuery(TILE_ZOOM, x, y));
  }

  /** Purpose: OSM XML for the walkable ways of tile x/y at TILE_ZOOM. Side effects: may call Overpass. */
  walkTile(x: number, y: number): Promise<string> {
    return this.cached(`walk/${x}/${y}`, () => walkQuery(TILE_ZOOM, x, y));
  }

  /**
   * Purpose: the building footprints of tile x/y at TILE_ZOOM as JSON `{buildings: BuildingFootprint[]}`.
   * Side effects: may call Overpass.
   */
  buildingTile(x: number, y: number): Promise<string> {
    return this.cached(
      `building/${x}/${y}`,
      () => buildingQuery(TILE_ZOOM, x, y),
      (json) => JSON.stringify({ buildings: footprints(json) }),
    );
  }

  private async cached(
    key: string,
    query: () => string,
    convert: (body: string) => string = (b) => b,
  ): Promise<string> {
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    let p = this.pending.get(key);
    if (!p) {
      p = this.overpass
        .run(query())
        .then(convert)
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    const xml = await p;
    this.cache.set(key, xml);
    while (this.cache.size > CACHE_TILES) this.cache.delete(this.cache.keys().next().value as string);
    return xml;
  }
}

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

  /** Purpose: OSM XML for the walkable ways of tile x/y at TILE_ZOOM. Side effects: may call Overpass. */
  walkTile(x: number, y: number): Promise<string> {
    return this.cached(`walk/${x}/${y}`, () => walkQuery(TILE_ZOOM, x, y));
  }

  private async cached(key: string, query: () => string): Promise<string> {
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    let p = this.pending.get(key);
    if (!p) {
      p = this.overpass.run(query()).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    const xml = await p;
    this.cache.set(key, xml);
    while (this.cache.size > CACHE_TILES) this.cache.delete(this.cache.keys().next().value as string);
    return xml;
  }
}

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
  async tile(x: number, y: number): Promise<string> {
    const key = `${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    let p = this.pending.get(key);
    if (!p) {
      p = this.overpass.run(streetQuery(TILE_ZOOM, x, y)).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    const xml = await p;
    this.cache.set(key, xml);
    while (this.cache.size > CACHE_TILES) this.cache.delete(this.cache.keys().next().value as string);
    return xml;
  }
}

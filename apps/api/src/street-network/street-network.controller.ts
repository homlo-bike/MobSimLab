import { BadRequestException, Controller, Get, Header, HttpException, Param, Query } from "@nestjs/common";
import { OverpassError } from "../gateway/overpass.client";
import { Requires } from "../iam/requires";
import { StreetNetworkService, TILE_ZOOM } from "./street-network.service";
import { type Bbox, MAX_WATER_SPAN_DEG } from "./water";

/**
 * Street tiles for the map editor. Read-only public OSM data, but members only: each uncached tile
 * costs a request to the Overpass service.
 */
@Controller("api/street-network")
export class StreetNetworkController {
  constructor(private readonly streets: StreetNetworkService) {}

  /**
   * Purpose: OSM XML with the streets of one web-mercator tile at zoom 14.
   * Inputs: tile x and y. Output: `application/xml`; 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`tiles/${TILE_ZOOM}/:x/:y`)
  @Requires("instance.read")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async tile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const [x, y] = parseTile(xs, ys);
    try {
      return await this.streets.tile(x, y);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap streets are unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: OSM XML with the ways people may walk or cycle in one web-mercator tile at zoom 14 (roads,
   * cycleways, paths, tracks and footways), for the cargo bike plugin's routes (plugins/cargo-bike).
   * Inputs: tile x and y. Output: `application/xml`; 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`walk-tiles/${TILE_ZOOM}/:x/:y`)
  @Requires("instance.read")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async walkTile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const [x, y] = parseTile(xs, ys);
    try {
      return await this.streets.walkTile(x, y);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap streets are unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: OSM XML with the railway tracks of one web-mercator tile at zoom 14, for the railway
   * design tool (existing railways new track can join).
   * Inputs: tile x and y. Output: `application/xml`; 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`rail-tiles/${TILE_ZOOM}/:x/:y`)
  @Requires("instance.read")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async railTile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const [x, y] = parseTile(xs, ys);
    try {
      return await this.streets.railTile(x, y);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap railways are unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: the building footprints of one web-mercator tile at zoom 14, for the noise map in the GIS
   * tab: JSON `{buildings: [{id, ring: [[lon, lat], …], height_m?, levels?}]}`.
   * Inputs: tile x and y. Output: 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`building-tiles/${TILE_ZOOM}/:x/:y`)
  @Requires("instance.read")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async buildingTile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const [x, y] = parseTile(xs, ys);
    try {
      return await this.streets.buildingTile(x, y);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap buildings are unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: the schools, universities, hospitals and clinics of one web-mercator tile at zoom 14, for the
   * benefit tables: JSON `{places: [{id, kind, lonlat, name?}]}`.
   * Inputs: tile x and y. Output: 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`place-tiles/${TILE_ZOOM}/:x/:y`)
  @Requires("instance.read")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async placeTile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const [x, y] = parseTile(xs, ys);
    try {
      return await this.streets.placeTile(x, y);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap places are unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: sea, lakes and rivers from OSM inside a box, simplified, for the Schematic tab's network map:
   * JSON `{areas, rivers, sea}` (water.ts). Inputs: `bbox=west,south,east,north`, at most 1° a side.
   * Output: 400 for an invalid box, 502/504 when OSM is unavailable.
   */
  @Get("water")
  @Requires("instance.read")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async water(@Query("bbox") bbox: string | undefined): Promise<string> {
    const b = parseBbox(bbox);
    try {
      return await this.streets.water(b);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap water is unavailable right now", e.status);
      throw e;
    }
  }

  /**
   * Purpose: the bicycle charging points and the secure or cargo bike parkings of one zoom-14 tile, for the
   * cargo bike plugin: JSON `{amenities: [{id, kind, lonlat, name?, hours?, fee?, capacity?}]}`.
   * Inputs: tile x and y. Output: 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`bike-amenity-tiles/${TILE_ZOOM}/:x/:y`)
  @Requires("instance.read")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Cache-Control", "private, max-age=86400")
  async bikeAmenityTile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const [x, y] = parseTile(xs, ys);
    try {
      return await this.streets.bikeAmenityTile(x, y);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap bike parkings are unavailable right now", e.status);
      throw e;
    }
  }
}

/**
 * Purpose: a water box from `west,south,east,north`, rounded outward to 0.01° so nearby requests share the
 * cache; a 400 when it is not a valid box or larger than MAX_WATER_SPAN_DEG on a side.
 */
export function parseBbox(v: string | undefined): Bbox {
  const n = (v ?? "").split(",").map((x) => (/^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : NaN));
  const [w, s, e, nn] = n;
  if (
    n.length !== 4 ||
    n.some((x) => !Number.isFinite(x)) ||
    w! < -180 ||
    e! > 180 ||
    s! < -85 ||
    nn! > 85 ||
    w! >= e! ||
    s! >= nn! ||
    e! - w! > MAX_WATER_SPAN_DEG ||
    nn! - s! > MAX_WATER_SPAN_DEG
  )
    throw new BadRequestException(
      `bbox must be west,south,east,north and at most ${MAX_WATER_SPAN_DEG}° on a side`,
    );
  const down = (x: number) => Math.floor(x * 100) / 100;
  const up = (x: number) => Math.ceil(x * 100) / 100;
  return [down(w!), down(s!), up(e!), up(nn!)];
}

/** Purpose: tile x and y from the path, or a 400 for an invalid tile. */
function parseTile(xs: string, ys: string): [number, number] {
  const max = 2 ** TILE_ZOOM;
  const [x, y] = [xs, ys].map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  if (!Number.isInteger(x) || !Number.isInteger(y) || x! >= max || y! >= max) {
    throw new BadRequestException("Invalid tile");
  }
  return [x!, y!];
}

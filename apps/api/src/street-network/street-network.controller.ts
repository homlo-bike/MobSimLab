import { BadRequestException, Controller, Get, Header, HttpException, Param } from "@nestjs/common";
import { OverpassError } from "../gateway/overpass.client";
import { Requires } from "../iam/requires";
import { StreetNetworkService, TILE_ZOOM } from "./street-network.service";

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

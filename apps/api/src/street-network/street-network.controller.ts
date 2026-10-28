import { BadRequestException, Controller, Get, Header, HttpException, Param } from "@nestjs/common";
import { OverpassError } from "../gateway/overpass.client";
import { StreetNetworkService, TILE_ZOOM } from "./street-network.service";

/** Street tiles for the map editor. Read-only; the data is public OSM data. */
@Controller("api/street-network")
export class StreetNetworkController {
  constructor(private readonly streets: StreetNetworkService) {}

  /**
   * Purpose: OSM XML with the streets of one web-mercator tile at zoom 14.
   * Inputs: tile x and y. Output: `application/xml`; 400 for an invalid tile, 502/504 when OSM is unavailable.
   */
  @Get(`tiles/${TILE_ZOOM}/:x/:y`)
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=86400")
  async tile(@Param("x") xs: string, @Param("y") ys: string): Promise<string> {
    const max = 2 ** TILE_ZOOM;
    const [x, y] = [xs, ys].map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
    if (!Number.isInteger(x) || !Number.isInteger(y) || x! >= max || y! >= max) {
      throw new BadRequestException("Invalid tile");
    }
    try {
      return await this.streets.tile(x!, y!);
    } catch (e) {
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap streets are unavailable right now", e.status);
      throw e;
    }
  }
}

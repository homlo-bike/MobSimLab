import { BadRequestException, Controller, Get, HttpException, Query } from "@nestjs/common";
import { z } from "zod";
import { GeocoderError, PhotonClient } from "../gateway/photon.client";
import { Requires } from "../iam/requires";

/** Where the place names come from, shown under the results (C-09). */
export const PLACES_SOURCE = {
  name: "Photon (komoot)",
  url: "https://photon.komoot.io",
  licence: "Data © OpenStreetMap contributors, ODbL",
} as const;

const searchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  lang: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-89.999).max(89.999).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

/**
 * The map's place search: towns, streets, stations and addresses from OpenStreetMap through the Photon
 * geocoder. Members only: uncached searches cost requests to the provider.
 */
@Controller("api/places")
export class PlacesController {
  constructor(private readonly photon: PhotonClient) {}

  /**
   * Purpose: places matching a text, best first, nearer the map centre when given.
   * Inputs: ?q=&lang=&lon=&lat=&limit=. Output: { places: [{ name, context, kind, lonLat, bbox }], source }.
   */
  @Get("search")
  @Requires("instance.read")
  async search(@Query() query: unknown) {
    const r = searchQuery.safeParse(query);
    if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
    const { q, lang, lon, lat, limit } = r.data;
    const near: [number, number] | undefined =
      lon !== undefined && lat !== undefined ? [lon, lat] : undefined;
    try {
      return { places: await this.photon.search(q, { lang, near, limit }), source: PLACES_SOURCE };
    } catch (e) {
      if (e instanceof GeocoderError)
        throw new HttpException("Place search is unavailable right now", e.status);
      throw e;
    }
  }
}

import { BadRequestException, Controller, Get, HttpException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { Requires } from "../iam/requires";
import { PhotoError } from "./outbound";
import { isPhotoProvider, type PhotoProvider, StreetPhotosService } from "./street-photos.service";
import { PHOTO_SIZES, type PhotoSize } from "./types";

const nearQuery = z.strictObject({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-85.06).max(85.06),
  /** Metres around the point; 30 m unless asked. */
  radius: z.coerce.number().int().min(5).max(200).default(30),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

function rethrow(e: unknown): never {
  if (e instanceof PhotoError) throw new HttpException(e.message, e.status);
  throw e;
}

/**
 * Street-level photos (docs/architecture/06-gis.md §8.1): members click a point on the map and see the photos
 * taken near it. The API asks the source and passes the pictures on without storing them.
 */
@Controller("api/street-photos")
export class StreetPhotosController {
  constructor(private readonly photos: StreetPhotosService) {}

  private provider(v: string): PhotoProvider {
    if (!isPhotoProvider(v)) throw new BadRequestException("no such street photo source");
    return v;
  }

  /** Purpose: the street photo sources members can use now (`["panoramax"]`). */
  @Get()
  @Requires("instance.read")
  async available() {
    return { available: await this.photos.available() };
  }

  /** Purpose: the photos near a point, nearest first. Query: `lon`, `lat`, `radius` (metres, 5 to 200). */
  @Get(":provider/near")
  @Requires("instance.read")
  async near(@Param("provider") p: string, @Query() query: unknown) {
    const provider = this.provider(p);
    const q = parse(nearQuery, query);
    try {
      return { photos: await this.photos.near(provider, [q.lon, q.lat], q.radius) };
    } catch (e) {
      rethrow(e);
    }
  }

  /** Purpose: one picture of a photo (`thumb` or `sd`), fetched from the source and not stored. */
  @Get(":provider/photos/:ref/:size")
  @Requires("instance.read")
  async image(
    @Param("provider") p: string,
    @Param("ref") ref: string,
    @Param("size") size: string,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.provider(p);
    if (!(PHOTO_SIZES as readonly string[]).includes(size)) throw new BadRequestException("no such size");
    if (!this.photos.validRef(provider, ref)) throw new BadRequestException("no such photo");
    try {
      const img = await this.photos.image(provider, ref, size as PhotoSize);
      res.setHeader("Content-Type", img.contentType);
      res.setHeader("Cache-Control", `private, max-age=${img.maxAgeS}`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(img.body);
    } catch (e) {
      rethrow(e);
    }
  }
}

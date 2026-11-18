import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { type MslRequest, SessionService } from "../auth/session.service";
import { Requires } from "../iam/requires";
import type { ProjectActor } from "../projects/projects.service";
import { BasemapsService } from "./basemaps.service";
import { TileError, validTile } from "./esri.client";
import { MapLayersService } from "./map-layers.service";

const esriBody = z.strictObject({
  // ArcGIS API keys are long tokens of letters, digits and a few signs.
  apiKey: z
    .string()
    .trim()
    .min(20, "the ArcGIS API key is too short")
    .max(1000, "the ArcGIS API key is too long")
    .regex(/^[A-Za-z0-9._~+/=-]+$/, "the ArcGIS API key has characters a key does not have"),
  acceptTerms: z.literal(true, { error: "accept Esri's terms of use to save the key" }),
});
const tileNumber = z.coerce.number().int();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

/**
 * Keyed basemaps (docs/architecture/06-gis.md §8): Admins save the ArcGIS key for Esri World Imagery after
 * accepting Esri's terms; members get the tiles through the API, which keeps the key on the server.
 */
@Controller("api")
export class BasemapsController {
  constructor(
    private readonly basemaps: BasemapsService,
    private readonly mapLayers: MapLayersService,
    private readonly sessions: SessionService,
  ) {}

  private actor(req: MslRequest): ProjectActor {
    const s = req.session;
    if (!s) throw new ForbiddenException();
    return {
      userId: s.actor.userId,
      role: s.actor.role,
      ipHash: this.sessions.ipHash(req.ip),
      requestId: req.requestId ?? null,
    };
  }

  /** Purpose: whether the Esri key is saved, its last four characters and who accepted the terms. */
  @Get("admin/basemaps")
  @Requires("plugins.manage")
  async adminStatus() {
    return { esri: await this.basemaps.esriStatus() };
  }

  /** Purpose: save the ArcGIS key. Body: `{ apiKey, acceptTerms: true }`. The key is never sent back. */
  @Put("admin/basemaps/esri")
  @Requires("plugins.manage")
  async setEsri(@Body() body: unknown, @Req() req: MslRequest) {
    const b = parse(esriBody, body);
    return { esri: await this.basemaps.setEsriKey(this.actor(req), b.apiKey) };
  }

  /** Purpose: remove the ArcGIS key; Esri imagery is no longer offered. */
  @Delete("admin/basemaps/esri")
  @Requires("plugins.manage")
  async removeEsri(@Req() req: MslRequest) {
    await this.basemaps.removeEsriKey(this.actor(req));
    return { esri: await this.basemaps.esriStatus() };
  }

  /**
   * Purpose: the keyed basemaps members can pick (`["esri"]` once an Admin has saved the key), and the WMS and
   * WMTS layers Admins added (`layers`, tiles through `/api/map-layers/`).
   */
  @Get("basemaps")
  @Requires("instance.read")
  async available() {
    const [available, layers] = await Promise.all([this.basemaps.available(), this.mapLayers.offers()]);
    return { available, layers };
  }

  /** Purpose: one Esri World Imagery tile, fetched with the saved key and not stored. */
  @Get("basemaps/esri/tiles/:z/:y/:x")
  @Requires("instance.read")
  async esriTile(
    @Param("z") zs: string,
    @Param("y") ys: string,
    @Param("x") xs: string,
    @Res() res: Response,
  ): Promise<void> {
    const [z, y, x] = [zs, ys, xs].map((v) => parse(tileNumber, v)) as [number, number, number];
    if (!validTile(z, x, y)) throw new BadRequestException("no such tile");
    try {
      const tile = await this.basemaps.esriTile(z, x, y);
      res.setHeader("Content-Type", tile.contentType);
      res.setHeader("Cache-Control", tile.maxAgeS > 0 ? `private, max-age=${tile.maxAgeS}` : "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(tile.body);
    } catch (e) {
      if (e instanceof TileError) throw new HttpException(e.message, e.status);
      throw e;
    }
  }
}

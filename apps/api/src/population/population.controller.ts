import { BadRequestException, Body, Controller, HttpCode, HttpException, Post } from "@nestjs/common";
import { z } from "zod";
import { OverpassError } from "../gateway/overpass.client";
import { WorldPopError } from "../gateway/worldpop.client";
import { Requires } from "../iam/requires";
import { type Bbox, PopulationService } from "./population.service";

const gridBody = z.object({
  bbox: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-89.999).max(89.999),
    z.number().min(-180).max(180),
    z.number().min(-89.999).max(89.999),
  ]),
});

/**
 * People per 100 m cell (WorldPop) for the noise map's population exposure (ADR-0038 step N2).
 * Members only: a new area costs an Overpass request and a new country a download from WorldPop.
 */
@Controller("api/population")
export class PopulationController {
  constructor(private readonly population: PopulationService) {}

  /**
   * Purpose: people per cell over a box.
   * Inputs: { bbox: [west, south, east, north] }, at most 0.3° on a side.
   * Output: { status: "ready", grid: { x0, y0, dx, dy, nx, ny, people }, source } or
   * { status: "loading", reason, countries } or { status: "unavailable", reason }; 502/504 when OpenStreetMap cannot place the area.
   */
  @Post("grid")
  @HttpCode(200)
  @Requires("instance.read")
  async grid(@Body() body: unknown) {
    const r = gridBody.safeParse(body);
    if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
    try {
      return await this.population.grid(r.data.bbox as Bbox);
    } catch (e) {
      if (e instanceof RangeError) throw new BadRequestException(e.message);
      if (e instanceof OverpassError)
        throw new HttpException("OpenStreetMap cannot place the area right now", e.status);
      if (e instanceof WorldPopError) throw new HttpException("WorldPop is unavailable right now", e.status);
      throw e;
    }
  }
}

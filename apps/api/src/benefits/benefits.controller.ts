import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { OverpassError } from "../gateway/overpass.client";
import { WorldBankError } from "../gateway/worldbank.client";
import { Requires } from "../iam/requires";
import { BenefitsService, OSM_AREA_SOURCE } from "./benefits.service";

const codeQuery = z.object({ code: z.string().regex(/^[A-Za-z]{2,3}$/) });
const atQuery = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-89.999).max(89.999),
});
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const populationBody = z.object({
  areas: z
    .array(z.object({ id: z.string().min(1).max(100), ring: z.array(lonLat).min(4).max(200) }))
    .min(1)
    .max(400),
});

/**
 * Location data for the benefit tables (ADR-0040): World Bank country figures, WorldPop population of
 * station catchments, and the OpenStreetMap areas a region can be imported from. Members only: uncached
 * answers cost requests to the providers.
 */
@Controller("api/benefits")
export class BenefitsController {
  constructor(private readonly benefits: BenefitsService) {}

  /**
   * Purpose: GDP per capita (local currency), employment ratio, share aged 0–14 and population of a country.
   * Inputs: ?code=FRA. Output: BenefitIndicators (benefits.service.ts).
   */
  @Get("indicators")
  @Requires("instance.read")
  async indicators(@Query() q: unknown) {
    const { code } = parse(codeQuery, q);
    return upstream(() => this.benefits.indicators(code));
  }

  /**
   * Purpose: WorldPop population inside each area (station catchments).
   * Inputs: `{areas: [{id, ring: [[lon, lat], …]}]}`, up to 400 areas of up to 200 points.
   * Output: `{year, populations: {id: people | null}, failed, source}`.
   */
  @Post("population")
  @HttpCode(200)
  @Requires("instance.read")
  async population(@Body() body: unknown) {
    const { areas } = parse(populationBody, body);
    return this.benefits.population(areas as { id: string; ring: [number, number][] }[]);
  }

  /**
   * Purpose: the OpenStreetMap areas (administrative boundaries, neighbourhoods, named places) that contain a
   * point, smallest first, with their outline, for importing a region in the GIS tab.
   * Inputs: ?lon=&lat=. Output: `{areas: OsmArea[], source}`.
   */
  @Get("osm-areas")
  @Requires("instance.read")
  async osmAreas(@Query() q: unknown) {
    const { lon, lat } = parse(atQuery, q);
    return { areas: await upstream(() => this.benefits.areasAt(lon, lat)), source: OSM_AREA_SOURCE };
  }
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
  return r.data;
}

async function upstream<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WorldBankError)
      throw new HttpException(
        e.status === 404 ? e.message : "World Bank data is unavailable right now",
        e.status === 400 ? 400 : e.status,
      );
    if (e instanceof OverpassError)
      throw new HttpException("OpenStreetMap areas are unavailable right now", e.status);
    throw e;
  }
}

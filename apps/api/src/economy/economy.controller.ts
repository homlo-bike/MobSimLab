import { BadRequestException, Controller, Get, HttpException, Query } from "@nestjs/common";
import { z } from "zod";
import { OverpassError } from "../gateway/overpass.client";
import { WorldBankError } from "../gateway/worldbank.client";
import { Requires } from "../iam/requires";
import { COUNTRY_SOURCE, EconomyService } from "./economy.service";

const atQuery = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-89.999).max(89.999),
});
const economyQuery = z.object({
  code: z.string().regex(/^[A-Za-z]{2,3}$/),
  base: z.coerce.number().int().min(1960).max(2100).default(2023),
});

/**
 * Country price levels and exchange rates for the cost tables (ADR-0039): the country of the project's
 * location from the OpenStreetMap boundaries, and the World Bank's indicators for it. Members only:
 * uncached answers cost requests to the providers.
 */
@Controller("api/economy")
export class EconomyController {
  constructor(private readonly economy: EconomyService) {}

  /**
   * Purpose: the country a point lies in.
   * Inputs: ?lon=&lat=. Output: { iso3, iso2, name (null codes at sea), source }.
   */
  @Get("country-at")
  @Requires("instance.read")
  async countryAt(@Query() q: unknown) {
    const { lon, lat } = parse(atQuery, q);
    return { ...(await upstream(() => this.economy.countryAt(lon, lat))), source: COUNTRY_SOURCE };
  }

  /** Purpose: the countries the World Bank has data for. Output: { countries: [{ iso3, iso2, name }] }. */
  @Get("countries")
  @Requires("instance.read")
  async countries() {
    return { countries: await upstream(() => this.economy.countries()) };
  }

  /**
   * Purpose: a country's PPP conversion factor, exchange rate and the US GDP deflator.
   * Inputs: ?code=DEU (ISO alpha-2 or alpha-3)&base=2023 (price base year of the unit costs).
   * Output: CountryEconomy (economy.service.ts).
   */
  @Get("indicators")
  @Requires("instance.read")
  async indicators(@Query() q: unknown) {
    const { code, base } = parse(economyQuery, q);
    return upstream(() => this.economy.economy(code, base));
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
      throw new HttpException("OpenStreetMap country boundaries are unavailable right now", e.status);
    throw e;
  }
}

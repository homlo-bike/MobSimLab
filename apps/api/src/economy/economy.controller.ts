import { BadRequestException, Controller, Get, HttpException, Optional, Query, Req } from "@nestjs/common";
import type { MslRequest } from "../auth/session.service";
import { ProjectGate } from "../geodata/project-gate";
import { factKey, keptFact, ProjectDataCache } from "../projects/data-cache";
import { z } from "zod";
import { OverpassError } from "../gateway/overpass.client";
import { WorldBankError } from "../gateway/worldbank.client";
import { Requires } from "../iam/requires";
import { COUNTRY_SOURCE, EconomyService } from "./economy.service";

const atQuery = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-89.999).max(89.999),
  project: z.string().optional(),
});
const economyQuery = z.object({
  code: z.string().regex(/^[A-Za-z]{2,3}$/),
  base: z.coerce.number().int().min(1960).max(2100).default(2023),
  project: z.string().optional(),
});
const projectQuery = z.object({ project: z.string().optional() });

/**
 * Country price levels and exchange rates for the cost tables (ADR-0039): the country of the project's
 * location from the OpenStreetMap boundaries, and the World Bank's indicators for it. Members only:
 * uncached answers cost requests to the providers.
 */
@Controller("api/economy")
export class EconomyController {
  constructor(
    private readonly economy: EconomyService,
    @Optional() private readonly gate?: ProjectGate,
    @Optional() private readonly kept?: ProjectDataCache,
  ) {}

  /**
   * Purpose: the country a point lies in.
   * Inputs: ?lon=&lat=. Output: { iso3, iso2, name (null codes at sea), source }.
   */
  @Get("country-at")
  @Requires("instance.read")
  async countryAt(@Query() q: unknown, @Req() req: MslRequest) {
    const { lon, lat, project } = parse(atQuery, q);
    const live = () => upstream(() => this.economy.countryAt(lon, lat));
    // Kept for the project (`?project=`), so it is looked up once (#140 step 3).
    const projectId = await this.gate?.readable(req, project);
    const place =
      projectId && this.kept
        ? (JSON.parse(
            (
              await this.kept.through(projectId, "facts", factKey.countryAt(lon, lat), async () =>
                JSON.stringify(await live()),
              )
            ).body,
          ) as Awaited<ReturnType<typeof live>>)
        : await live();
    return { ...place, source: COUNTRY_SOURCE };
  }

  /** Purpose: the countries the World Bank has data for. Output: { countries: [{ iso3, iso2, name }] }. */
  @Get("countries")
  @Requires("instance.read")
  async countries(@Query() q: unknown, @Req() req: MslRequest) {
    const { project } = parse(projectQuery, q);
    const countries = await keptFact(this.gate, this.kept, req, project, factKey.economyCountries, () =>
      upstream(() => this.economy.countries()),
    );
    return { countries };
  }

  /**
   * Purpose: a country's PPP conversion factor, exchange rate and the US GDP deflator.
   * Inputs: ?code=DEU (ISO alpha-2 or alpha-3)&base=2023 (price base year of the unit costs).
   * Output: CountryEconomy (economy.service.ts).
   */
  @Get("indicators")
  @Requires("instance.read")
  async indicators(@Query() q: unknown, @Req() req: MslRequest) {
    const { code, base, project } = parse(economyQuery, q);
    // Kept for the project (`?project=`), so the cost tables read the same figures every time.
    return keptFact(this.gate, this.kept, req, project, factKey.economy(code, base), () =>
      upstream(() => this.economy.economy(code, base)),
    );
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

import { BadRequestException, Controller, Get, HttpException, Optional, Query, Req } from "@nestjs/common";
import type { MslRequest } from "../auth/session.service";
import { ProjectGate } from "../geodata/project-gate";
import { factKey, ProjectDataCache } from "../projects/data-cache";
import { z } from "zod";
import { NagerClient, NagerError } from "../gateway/nager.client";
import { OpenMeteoClient, OpenMeteoError } from "../gateway/openmeteo.client";
import { Requires } from "../iam/requires";

const holidaysQuery = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/),
  year: z.coerce.number().int().min(1900).max(2200),
  project: z.string().optional(),
});

const climateQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  project: z.string().optional(),
});

/** Where the climate comes from, for the source note: the data is CC BY 4.0 and must be credited. */
export const CLIMATE_SOURCE = {
  name: "Open-Meteo",
  url: "https://open-meteo.com/",
  licence: "CC BY 4.0",
};

/** Where the public holidays come from, for the calendar's source note. */
export const HOLIDAY_SOURCE = { name: "Nager.Date", url: "https://date.nager.at/" };

/**
 * Public holidays and the climate for the project calendar (ADR-0020): each year's days off of a country from
 * Nager.Date, and the monthly temperatures at the project's location from Open-Meteo. The project keeps its own
 * copy and the planner's changes in its preferences. Members only: uncached answers cost requests to the
 * providers.
 */
@Controller("api/calendar")
export class CalendarController {
  constructor(
    private readonly nager: NagerClient,
    private readonly openMeteo: OpenMeteoClient,
    @Optional() private readonly gate?: ProjectGate,
    @Optional() private readonly kept?: ProjectDataCache,
  ) {}

  /** Purpose: an answer kept for the project (`?project=`), else fetched live and kept (#140 step 3). */
  private async through<T>(
    req: MslRequest,
    project: string | undefined,
    key: string,
    live: () => Promise<T>,
  ): Promise<T> {
    const projectId = await this.gate?.readable(req, project);
    if (!projectId || !this.kept) return live();
    const r = await this.kept.through(projectId, "facts", key, async () => JSON.stringify(await live()));
    return JSON.parse(r.body) as T;
  }

  /**
   * Purpose: the monthly climate (1991–2020) at the project's location, for weather day types.
   * Inputs: ?lat=52.52&lon=13.41 (rounded to 0.1° before the request).
   * Output: { lat, lon, from_year, to_year, months: [{ mean_c, max_c, min_c, max_sd_c, min_sd_c }] ×12, source }.
   */
  @Get("climate")
  @Requires("instance.read")
  async climate(@Query() q: unknown, @Req() req: MslRequest) {
    const r = climateQuery.safeParse(q);
    if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
    try {
      const { lat, lon, project } = r.data;
      const climate = await this.through(req, project, factKey.climate(lat, lon), () =>
        this.openMeteo.climate(lat, lon),
      );
      return { ...climate, source: CLIMATE_SOURCE };
    } catch (e) {
      if (e instanceof OpenMeteoError)
        throw new HttpException(
          e.status === 400 ? e.message : "The climate is unavailable right now",
          e.status,
        );
      throw e;
    }
  }

  /**
   * Purpose: a country's public holidays in a year.
   * Inputs: ?country=DE (ISO alpha-2)&year=2027.
   * Output: { country, year, holidays: [{ date, localName, name, regions }], source }.
   */
  @Get("holidays")
  @Requires("instance.read")
  async holidays(@Query() q: unknown, @Req() req: MslRequest) {
    const r = holidaysQuery.safeParse(q);
    if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
    const country = r.data.country.toUpperCase();
    try {
      const holidays = await this.through(req, r.data.project, factKey.holidays(country, r.data.year), () =>
        this.nager.holidays(country, r.data.year),
      );
      return { country, year: r.data.year, holidays, source: HOLIDAY_SOURCE };
    } catch (e) {
      if (e instanceof NagerError)
        throw new HttpException(
          e.status === 404 || e.status === 400 ? e.message : "Public holidays are unavailable right now",
          e.status,
        );
      throw e;
    }
  }
}

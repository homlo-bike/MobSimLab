import { BadRequestException, Controller, Get, HttpException, Query } from "@nestjs/common";
import { z } from "zod";
import { NagerClient, NagerError } from "../gateway/nager.client";
import { Requires } from "../iam/requires";

const holidaysQuery = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/),
  year: z.coerce.number().int().min(1900).max(2200),
});

/** Where the public holidays come from, for the calendar's source note. */
export const HOLIDAY_SOURCE = { name: "Nager.Date", url: "https://date.nager.at/" };

/**
 * Public holidays for the project calendar (ADR-0020): each year's days off of a country from Nager.Date. The
 * project keeps its own copy and the planner's changes in its preferences. Members only: uncached answers cost
 * requests to the provider.
 */
@Controller("api/calendar")
export class CalendarController {
  constructor(private readonly nager: NagerClient) {}

  /**
   * Purpose: a country's public holidays in a year.
   * Inputs: ?country=DE (ISO alpha-2)&year=2027.
   * Output: { country, year, holidays: [{ date, localName, name, regions }], source }.
   */
  @Get("holidays")
  @Requires("instance.read")
  async holidays(@Query() q: unknown) {
    const r = holidaysQuery.safeParse(q);
    if (!r.success) throw new BadRequestException(z.prettifyError(r.error));
    const country = r.data.country.toUpperCase();
    try {
      const holidays = await this.nager.holidays(country, r.data.year);
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

import { Injectable } from "@nestjs/common";
import { OverpassClient, OverpassError } from "../gateway/overpass.client";
import {
  type IndicatorValue,
  WorldBankClient,
  WorldBankError,
  type WbCountry,
} from "../gateway/worldbank.client";

/** World Bank indicators the cost tables use (ADR-0039). */
export const INDICATORS = {
  /** PPP conversion factor, GDP (local currency units per international $). */
  ppp: "PA.NUS.PPP",
  /** Official exchange rate (local currency units per US$, period average). */
  fx: "PA.NUS.FCRF",
  /** GDP deflator (base year varies by country); the US series scales base-year dollars to today. */
  deflator: "NY.GDP.DEFL.ZS",
} as const;

export const ECONOMY_SOURCE = {
  name: "World Bank World Development Indicators",
  note: "PPP conversion factor (PA.NUS.PPP), official exchange rate (PA.NUS.FCRF) and the US GDP deflator (NY.GDP.DEFL.ZS), latest year available.",
  licence: "CC BY 4.0",
  url: "https://data.worldbank.org/",
} as const;

export const COUNTRY_SOURCE = {
  name: "OpenStreetMap country boundaries",
  licence: "© OpenStreetMap contributors, ODbL 1.0",
  url: "https://www.openstreetmap.org/copyright",
} as const;

/** The country a point lies in. */
export interface PlaceCountry {
  iso3: string | null;
  iso2: string | null;
  name: string | null;
}

/** What the cost tables need of a country's economy. */
export interface CountryEconomy {
  country: WbCountry;
  ppp: IndicatorValue | null;
  fx: IndicatorValue | null;
  /** US GDP deflator in the price base year and in the latest year available. */
  usDeflator: { base: IndicatorValue | null; latest: IndicatorValue | null };
  source: typeof ECONOMY_SOURCE;
}

/**
 * Purpose: Overpass QL for the country (admin level 2 area) a point lies in, with its ISO codes and name.
 */
export function countryQuery(lon: number, lat: number): string {
  const f = (x: number) => x.toFixed(6);
  return `[out:json][timeout:25];is_in(${f(lat)},${f(lon)})->.a;area.a["admin_level"="2"]["boundary"="administrative"];out tags;`;
}

/** Purpose: the country in an Overpass `is_in` answer, or null codes when the point is in none (open sea). */
export function parseCountry(body: string): PlaceCountry {
  let doc: { elements?: Array<{ tags?: Record<string, string> }> };
  try {
    doc = JSON.parse(body) as typeof doc;
  } catch {
    throw new OverpassError("Overpass answered something other than JSON", 502);
  }
  for (const e of doc.elements ?? []) {
    const t = e.tags ?? {};
    const iso3 = t["ISO3166-1:alpha3"] ?? null;
    const iso2 = t["ISO3166-1:alpha2"] ?? t["ISO3166-1"] ?? null;
    if (iso3 || iso2) return { iso3, iso2, name: t["name:en"] ?? t.name ?? null };
  }
  return { iso3: null, iso2: null, name: null };
}

@Injectable()
export class EconomyService {
  constructor(
    private readonly worldBank: WorldBankClient,
    private readonly overpass: OverpassClient,
  ) {}

  /** Purpose: the country a point lies in, from the OpenStreetMap boundaries. */
  async countryAt(lon: number, lat: number): Promise<PlaceCountry> {
    return parseCountry(await this.overpass.run(countryQuery(lon, lat)));
  }

  /** Purpose: the World Bank's countries, for the planner to choose another one. */
  countries(): Promise<WbCountry[]> {
    return this.worldBank.countries();
  }

  /**
   * Purpose: a country's PPP conversion factor and exchange rate, latest year, and the US GDP deflator in
   * the price base year and the latest year.
   * Inputs: ISO 3166-1 alpha-2 or alpha-3 code; price base year of the unit costs.
   */
  async economy(code: string, baseYear: number): Promise<CountryEconomy> {
    const all = await this.worldBank.countries();
    const c = code.toUpperCase();
    const country = all.find((x) => x.iso3 === c || x.iso2 === c);
    if (!country) throw new WorldBankError("The World Bank has no data for this country", 404);
    const thisYear = new Date().getUTCFullYear();
    const [ppp, fx, deflator] = await Promise.all([
      this.worldBank.latest(country.iso3, INDICATORS.ppp),
      this.worldBank.latest(country.iso3, INDICATORS.fx),
      this.worldBank.range("USA", INDICATORS.deflator, baseYear, thisYear),
    ]);
    return {
      country,
      ppp,
      // The United States has no official exchange rate in WDI: 1 US$ per US$.
      fx: fx ?? (country.iso3 === "USA" ? { year: ppp?.year ?? thisYear, value: 1 } : null),
      usDeflator: {
        base: deflator.find((d) => d.year === baseYear) ?? null,
        latest: deflator[deflator.length - 1] ?? null,
      },
      source: ECONOMY_SOURCE,
    };
  }
}

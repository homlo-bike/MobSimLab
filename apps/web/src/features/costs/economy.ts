/**
 * Country price levels and exchange rates for the cost tables (ADR-0039): the API reads the country of a
 * point from the OpenStreetMap boundaries and the World Bank's indicators for it (apps/api/src/economy).
 */
import { currencyOf } from "./currencies";

export type LonLat = [number, number];

export interface IndicatorValue {
  year: number;
  value: number;
}

export interface WbCountry {
  iso3: string;
  iso2: string;
  name: string;
}

export interface CountryEconomy {
  country: WbCountry;
  /** PPP conversion factor, GDP: local currency units per international $. */
  ppp: IndicatorValue | null;
  /** Official exchange rate: local currency units per US$. */
  fx: IndicatorValue | null;
  usDeflator: { base: IndicatorValue | null; latest: IndicatorValue | null };
  source: { name: string; note: string; licence: string; url: string };
}

export interface PlaceCountry {
  iso3: string | null;
  iso2: string | null;
  name: string | null;
}

/** The project's own values for the conversion, as preference ids. */
export const PRICE_PREFS = {
  ppp: "cost.country.ppp",
  fx: "cost.country.fx",
  escalation: "cost.country.escalation",
} as const;

/** How base-year unit costs become today's prices in the project's currency. */
export interface Prices {
  /** ISO 4217 code, or null when the currency of the country is not known (shown as "local currency"). */
  currency: string | null;
  /** Local currency units per international $ (construction and operation). */
  ppp: number;
  /** Local currency units per US$ (vehicles, and the US$ column). */
  fx: number;
  /** Price base year to today: US GDP deflator latest ÷ base year. */
  escalation: number;
  /** The year the escalation reaches. */
  year: number | null;
  /** Each value from the World Bank (false) or the project (true). */
  own: { ppp: boolean; fx: boolean; escalation: boolean };
}

/** Prices when no country is known: international dollars of the base year, unchanged. */
export const BASE_PRICES: Prices = {
  currency: "USD",
  ppp: 1,
  fx: 1,
  escalation: 1,
  year: null,
  own: { ppp: false, fx: false, escalation: false },
};

/**
 * Purpose: the conversion the tables use: the World Bank's values, each replaced by the project's own
 * where it set one. Without a country the unit costs stay in base-year international dollars.
 */
export function pricesFrom(econ: CountryEconomy | null, prefs: Record<string, number> | undefined): Prices {
  const own = (id: string) => {
    const v = prefs?.[id];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const wbPpp = econ?.ppp?.value;
  const wbFx = econ?.fx?.value;
  const base = econ?.usDeflator.base?.value;
  const latest = econ?.usDeflator.latest?.value;
  const wbEsc = base && latest ? latest / base : undefined;
  const ppp = own(PRICE_PREFS.ppp);
  const fx = own(PRICE_PREFS.fx);
  const escalation = own(PRICE_PREFS.escalation);
  const currency = econ ? currencyOf(econ.country.iso3) : "USD";
  return {
    currency,
    ppp: ppp ?? wbPpp ?? (econ ? (wbFx ?? 1) : 1),
    fx: fx ?? wbFx ?? (econ ? (wbPpp ?? 1) : 1),
    escalation: escalation ?? wbEsc ?? 1,
    year: econ?.usDeflator.latest?.year ?? null,
    own: { ppp: ppp !== undefined, fx: fx !== undefined, escalation: escalation !== undefined },
  };
}

async function getJson<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(path, { credentials: "same-origin" });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { message?: string }) => j.message)
      .catch(() => undefined);
    throw new Error(msg ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** The calls the cost tables make; tests pass their own. */
export interface EconomyApi {
  countryAt(at: LonLat): Promise<PlaceCountry>;
  countries(): Promise<WbCountry[]>;
  indicators(code: string, baseYear: number): Promise<CountryEconomy>;
}

/** Purpose: the economy API over HTTP, with answers kept for the session. */
export function economyApi(fetchImpl: typeof fetch = (...a) => fetch(...a)): EconomyApi {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(path: string): Promise<T> => {
    const hit = cache.get(path);
    if (hit) return hit as Promise<T>;
    const p = getJson<T>(path, fetchImpl);
    p.catch(() => cache.delete(path));
    cache.set(path, p);
    return p;
  };
  return {
    countryAt: ([lon, lat]) =>
      once<PlaceCountry>(`/api/economy/country-at?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}`),
    countries: () => once<{ countries: WbCountry[] }>("/api/economy/countries").then((r) => r.countries),
    indicators: (code, baseYear) =>
      once<CountryEconomy>(`/api/economy/indicators?code=${encodeURIComponent(code)}&base=${baseYear}`),
  };
}

/**
 * The project's currency (Project preferences): every amount of money in the project is shown in it,
 * converted with the World Bank's official exchange rate, or the project's own rate where it set one.
 * Rates are quoted per US$, as the World Bank gives them, so any currency converts to any other.
 */
import { useEffect, useState } from "react";
import type { PreferencesDoc } from "../../workspace/preferences";
import { countryOfCurrency, CURRENCY_CODES } from "./currencies";
import type { EconomyApi, IndicatorValue } from "./economy";
import { libraryValue } from "./params";

/** Preference id of the project's own rate: units of the project's currency per US$. */
export const RATE_PREF = "currency.per_usd";

const BASE_YEAR = libraryValue("cost.price_base_year", "*")[1];

/** Purpose: the currency the project chose, or null when each tool shows the country's own currency. */
export function chosenCurrency(doc: PreferencesDoc | null | undefined): string | null {
  const c = doc?.currency;
  return typeof c === "string" && (c === "USD" || CURRENCY_CODES.includes(c)) ? c : null;
}

/** Purpose: the preferences with another currency (null: the country's own); its own rate goes with the old one. */
export function withCurrency(doc: PreferencesDoc | null | undefined, code: string | null): PreferencesDoc {
  const values = { ...(doc?.values ?? {}) };
  delete values[RATE_PREF];
  const next: PreferencesDoc = { ...(doc ?? {}), values };
  if (code) next.currency = code;
  else delete next.currency;
  return next;
}

/** The project's currency and how many of its units make one US$. */
export interface ProjectCurrency {
  code: string;
  perUsd: number;
  /** The year of the World Bank rate, or null for the project's own rate. */
  year: number | null;
  own: boolean;
}

/** What the project's currency choice comes to, for the tools and Project preferences. */
export interface CurrencyState {
  /** The currency to show money in, or null to keep each tool's country currency. */
  currency: ProjectCurrency | null;
  /** The code the project chose (also while its rate loads or is missing). */
  chosen: string | null;
  /** The World Bank's official exchange rate for the chosen currency, per US$. */
  worldBank: IndicatorValue | null;
  /** "loading" while the rate is asked for; "missing" when there is no rate to convert with. */
  status: "ok" | "loading" | "missing";
}

export const NO_CURRENCY: CurrencyState = { currency: null, chosen: null, worldBank: null, status: "ok" };

/**
 * Purpose: an amount's currency and the factor to the project's currency.
 * Inputs: the project's currency (null: none chosen), the amount's currency (null: unknown local currency)
 * and its units per US$ (null: unknown).
 * Output: the currency to show and the factor to multiply amounts by (1 when nothing changes).
 */
export function convertTo(
  to: ProjectCurrency | null,
  from: string | null,
  fromPerUsd: number | null | undefined,
): { currency: string | null; rate: number } {
  if (!to || to.code === from) return { currency: from, rate: 1 };
  if (!fromPerUsd || !Number.isFinite(fromPerUsd) || fromPerUsd <= 0) return { currency: from, rate: 1 };
  return { currency: to.code, rate: to.perUsd / fromPerUsd };
}

/**
 * Purpose: the project's currency with its rate per US$: the project's own rate, else the World Bank's
 * official exchange rate of the country that uses the currency (the US$ is 1).
 * Side effects: asks the economy API for that country's indicators.
 */
export function useProjectCurrency(doc: PreferencesDoc | null | undefined, api: EconomyApi): CurrencyState {
  const chosen = chosenCurrency(doc);
  const ownRaw = doc?.values?.[RATE_PREF];
  const own = typeof ownRaw === "number" && Number.isFinite(ownRaw) && ownRaw > 0 ? ownRaw : null;
  const [wb, setWb] = useState<{ code: string; value: IndicatorValue | null } | null>(null);
  useEffect(() => {
    if (!chosen || chosen === "USD") return;
    const country = countryOfCurrency(chosen);
    if (!country) {
      setWb({ code: chosen, value: null });
      return;
    }
    let live = true;
    api
      .indicators(country, BASE_YEAR)
      .then((e) => live && setWb({ code: chosen, value: e.fx }))
      .catch(() => live && setWb({ code: chosen, value: null }));
    return () => {
      live = false;
    };
  }, [chosen, api]);
  if (!chosen) return NO_CURRENCY;
  if (chosen === "USD")
    return {
      currency: { code: "USD", perUsd: 1, year: null, own: false },
      chosen,
      worldBank: null,
      status: "ok",
    };
  const worldBank = wb?.code === chosen ? wb.value : null;
  if (own)
    return {
      currency: { code: chosen, perUsd: own, year: null, own: true },
      chosen,
      worldBank,
      status: "ok",
    };
  if (worldBank && worldBank.value > 0)
    return {
      currency: { code: chosen, perUsd: worldBank.value, year: worldBank.year, own: false },
      chosen,
      worldBank,
      status: "ok",
    };
  return { currency: null, chosen, worldBank: null, status: wb?.code === chosen ? "missing" : "loading" };
}

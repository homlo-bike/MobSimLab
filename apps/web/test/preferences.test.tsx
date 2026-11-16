import { describe, expect, it } from "vitest";
import {
  DESIGN_RULES,
  delaysFrom,
  designValuesFrom,
  prefValue,
  withPref,
} from "../src/workspace/preferences";
import { chosenCurrency, convertTo, RATE_PREF, withCurrency } from "../src/features/costs/currency";
import { countryOfCurrency, CURRENCY_CODES } from "../src/features/costs/currencies";

describe("project preferences", () => {
  it("uses the library's delays unless the project changes them", () => {
    expect(delaysFrom(null)).toEqual({ mixed_traffic: 0.25, bus_lane: 0.08 });
    const doc = withPref(null, "street.mixed_traffic_delay_share", 0.4);
    expect(delaysFrom(doc)).toEqual({ mixed_traffic: 0.4, bus_lane: 0.08 });
    expect(prefValue(doc, "street.bus_lane_delay_share")).toBeUndefined();
    // Removing the value brings the library's back; nonsense is clamped.
    expect(delaysFrom(withPref(doc, "street.mixed_traffic_delay_share", null)).mixed_traffic).toBe(0.25);
    expect(delaysFrom({ values: { "street.bus_lane_delay_share": -1 } }).bus_lane).toBe(0);
  });

  it("passes the project's design rules to the rail engine per mode", () => {
    expect(designValuesFrom(null)).toEqual({});
    const radius = DESIGN_RULES.find((r) => r.field === "min_radius_m")!;
    expect(radius.modes.tram?.values[1]).toBe(20);
    const cant = DESIGN_RULES.find((r) => r.field === "max_cant_mm")!;
    // Tram and light rail take cant from their own library entry.
    expect(cant.modes.tram?.key).toBe("curve.cant_tram_mm");
    expect(cant.modes.metro?.key).toBe("curve.cant_rail_mm");
    const doc = withPref(withPref(null, "mode.min_curve_radius_m.tram", 25), "curve.cant_rail_mm.metro", 120);
    expect(designValuesFrom(doc)).toEqual({ "tram.min_radius_m": 25, "metro.max_cant_mm": 120 });
    // A value for a key of another mode, or nonsense, is not passed on.
    expect(
      designValuesFrom({ values: { "curve.cant_rail_mm.tram": 99, "mode.min_curve_radius_m.metro": -1 } }),
    ).toEqual({});
  });

  it("keeps one project currency and converts any amount to it through the US dollar", () => {
    expect(chosenCurrency(null)).toBeNull();
    expect(chosenCurrency({ values: {}, currency: "nonsense" })).toBeNull();
    const doc = withCurrency(withPref(null, RATE_PREF, 0.9), "CHF");
    // A new currency drops the old one's own rate.
    expect(doc).toEqual({ values: {}, currency: "CHF" });
    expect(chosenCurrency(doc)).toBe("CHF");
    expect(withCurrency(doc, null)).toEqual({ values: {} });
    // 0.9 CHF per US$ and 0.92 EUR per US$: 1 EUR is about 0.978 CHF.
    const chf = { code: "CHF", perUsd: 0.9, year: 2024, own: false };
    expect(convertTo(chf, "EUR", 0.92).currency).toBe("CHF");
    expect(convertTo(chf, "EUR", 0.92).rate).toBeCloseTo(0.9 / 0.92);
    expect(convertTo(chf, "CHF", 0.9)).toEqual({ currency: "CHF", rate: 1 });
    // No currency chosen, or no rate for the amount's: nothing changes.
    expect(convertTo(null, "EUR", 0.92)).toEqual({ currency: "EUR", rate: 1 });
    expect(convertTo(chf, "EUR", null)).toEqual({ currency: "EUR", rate: 1 });
    // Shared currencies take their main country's rate; the list has each code once.
    expect(countryOfCurrency("EUR")).toBe("DEU");
    expect(countryOfCurrency("JPY")).toBe("JPN");
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    expect(CURRENCY_CODES).toContain("USD");
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReasonField } from "../src/workspace/ReasonField";
import {
  DESIGN_RULES,
  delaysFrom,
  designValuesFrom,
  LIBRARY_SAME_NAME_M,
  type PreferencesDoc,
  prefValue,
  usedVehicles,
  vehiclesOffFrom,
  switchChoiceFrom,
  withDefaultTurnout,
  SAME_NAME_PREF,
  sameNameStationM,
  withPref,
  withReason,
  reasonOf,
  withSwitches,
  withVehicles,
  LIBRARY_DEFAULT_TURNOUT,
  LIBRARY_PARAMS,
  PARAM_GROUPS,
  choiceValue,
  paramLibrary,
  paramPrefId,
  withChoice,
} from "../src/workspace/preferences";
import { addLine, trainsFor } from "../src/features/railways/serviceLines";
import type { Network } from "../src/features/railways/types";
import { effectiveDefault } from "../src/workspace/SwitchChoice";
import { StationsSection } from "../src/workspace/StationsSection";
import { chosenCurrency, convertTo, RATE_PREF, withCurrency } from "../src/features/costs/currency";
import { countryOfCurrency, CURRENCY_CODES } from "../src/features/costs/currencies";

afterEach(cleanup);

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

  it("keeps a reason with a changed value until the value changes again", () => {
    const id = "street.mixed_traffic_delay_share";
    const doc = withReason(withPref(null, id, 0.4), id, "  Survey of 2026 ");
    expect(reasonOf(doc, id)).toBe("Survey of 2026");
    // The same number again keeps the reason; another number or a reset drops it.
    expect(reasonOf(withPref(doc, id, 0.4), id)).toBe("Survey of 2026");
    expect(withPref(doc, id, 0.5).reasons).toBeUndefined();
    expect(withPref(doc, id, null)).toEqual({ values: {} });
    // A value changed elsewhere (for example in the cost tables) leaves other reasons alone.
    expect(reasonOf(withPref(doc, "street.bus_lane_delay_share", 0.1), id)).toBe("Survey of 2026");
    expect(withReason(doc, id, " ").reasons).toBeUndefined();
    expect(reasonOf(withReason(doc, id, "x".repeat(600)), id)).toHaveLength(500);
  });

  it("asks for a reason only for the project's own values, and saves it when the field is left", () => {
    const id = "street.mixed_traffic_delay_share";
    const onPreferences = vi.fn();
    const { rerender } = render(
      <ReasonField valueId={id} preferences={null} editable onPreferences={onPreferences} />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    const doc = withPref(null, id, 0.4);
    rerender(<ReasonField valueId={id} preferences={doc} editable onPreferences={onPreferences} />);
    const box = screen.getByRole("textbox", { name: "Reason for this value (optional)" });
    fireEvent.change(box, { target: { value: "Survey of 2026" } });
    expect(onPreferences).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onPreferences).toHaveBeenCalledWith(withReason(doc, id, "Survey of 2026"));
    // Read-only: the reason as text.
    rerender(
      <ReasonField
        valueId={id}
        preferences={withReason(doc, id, "Survey of 2026")}
        editable={false}
        onPreferences={onPreferences}
      />,
    );
    expect(screen.getByText(/Survey of 2026/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("uses one same-name station distance: the project's, else the library's", () => {
    expect(SAME_NAME_PREF).toBe("journey.same_name_station_m");
    expect(sameNameStationM(undefined)).toBe(LIBRARY_SAME_NAME_M);
    expect(sameNameStationM(withPref(null, SAME_NAME_PREF, 250).values)).toBe(250);
    expect(sameNameStationM({ [SAME_NAME_PREF]: -5 })).toBe(LIBRARY_SAME_NAME_M);
  });

  it("lets the project change the same-name station distance and go back to the library's", () => {
    let doc: PreferencesDoc | null = null;
    const onPreferences = vi.fn((d: PreferencesDoc) => (doc = d));
    const view = () => <StationsSection preferences={doc} editable onPreferences={onPreferences} />;
    const { rerender } = render(view());
    const field = screen.getByRole("spinbutton", { name: /same-name stops/i });
    expect((field as HTMLInputElement).value).toBe(String(LIBRARY_SAME_NAME_M));
    fireEvent.change(field, { target: { value: "300" } });
    expect(prefValue(doc, SAME_NAME_PREF)).toBe(300);
    rerender(view());
    fireEvent.click(screen.getByRole("button", { name: /library value/i }));
    expect(prefValue(doc, SAME_NAME_PREF)).toBeUndefined();
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

  it("passes every rail engine value set in All parameters, for every mode or for one", () => {
    const doc = withPref(
      withPref(withPref(null, "track.centre_distance_m", 3.6), "track.centre_distance_m.metro", 3.8),
      "mode.min_curve_radius_m",
      30,
    );
    const v = designValuesFrom(doc);
    // A value for every mode reaches each rail mode; one for the mode wins.
    expect(v["tram.track_centre_m"]).toBe(3.6);
    expect(v["metro.track_centre_m"]).toBe(3.8);
    expect(v["regional_rail.min_radius_m"]).toBe(30);
    // A design rule set for the mode still wins over the value for every mode.
    expect(designValuesFrom(withPref(doc, "mode.min_curve_radius_m.tram", 25))["tram.min_radius_m"]).toBe(25);
    // Values for other tools do not reach the rail engine.
    expect(Object.keys(designValuesFrom(withPref(null, "mode.dwell_s", 40)))).toEqual([]);
  });

  it("keeps the catalogue vehicles the project leaves out, and offers the rest", () => {
    const doc = withVehicles(withPref(null, "x", 1), ["a", "b"], false);
    expect(doc).toEqual({ values: { x: 1 }, vehiclesOff: ["a", "b"] });
    expect([...vehiclesOffFrom(doc)]).toEqual(["a", "b"]);
    // Using every vehicle again removes the list.
    expect(withVehicles(doc, ["a", "b"], true)).toEqual({ values: { x: 1 } });
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const off = vehiclesOffFrom(doc);
    expect(usedVehicles(list, off).map((v) => v.id)).toEqual(["c"]);
    // A line's own vehicle stays on offer; a list with none in use offers all.
    expect(usedVehicles(list, off, "a").map((v) => v.id)).toEqual(["a", "c"]);
    expect(usedVehicles(list.slice(0, 2), off).map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("gives a new rail line a train the project uses", () => {
    const doc = {
      origin: [0, 0],
      mode: "metro",
      stations: [],
      tracks: [],
      switches: [],
    } as unknown as Network;
    const metros = trainsFor("metro");
    const [first] = addLine(doc, 1000, { empty: true });
    const suggested = first.lines![0]!.vehicle;
    const off = new Set(metros.map((t) => t.id).filter((id) => id !== metros[0]!.id || id === suggested));
    const [d] = addLine(doc, 1000, { empty: true, vehiclesOff: off });
    expect(off.has(d.lines![0]!.vehicle)).toBe(false);
  });

  it("keeps the switches the project leaves out and its default turnouts", () => {
    expect(switchChoiceFrom(null)).toEqual({ off: [], default_turnout: {} });
    let doc = withSwitches(null, ["tram-r25", "db-dkw-190-1-9"], false);
    doc = withDefaultTurnout(doc, "tram", "tram-r100");
    expect(doc.switches).toEqual({
      off: ["db-dkw-190-1-9", "tram-r25"],
      default_turnout: { tram: "tram-r100" },
    });
    // Choosing the library's default, and using all again, removes the choice.
    doc = withDefaultTurnout(doc, "tram", LIBRARY_DEFAULT_TURNOUT.tram!);
    expect(withSwitches(doc, ["tram-r25", "db-dkw-190-1-9"], true)).toEqual({ values: {} });
    // The default the editor uses: the project's, else the library's, else the first in use.
    const turnouts = ["tram-r25", "tram-r50", "tram-r100"].map((id) => ({ id }) as never);
    expect(effectiveDefault("tram", turnouts, new Set(), "tram-r100")).toBe("tram-r100");
    expect(effectiveDefault("tram", turnouts, new Set(["tram-r100"]), "tram-r100")).toBe("tram-r50");
    expect(effectiveDefault("tram", turnouts, new Set(["tram-r50"]), undefined)).toBe("tram-r25");
  });

  it("lists every library parameter with its values per mode and traction", () => {
    expect(LIBRARY_PARAMS.length).toBeGreaterThan(200);
    expect(PARAM_GROUPS[0]).toBe("Modes");
    // The Switches section sets the default turnout.
    expect(LIBRARY_PARAMS.some((p) => p.id === "switch.default_turnout")).toBe(false);
    const dwell = LIBRARY_PARAMS.find((p) => p.id === "mode.dwell_s")!;
    expect(paramLibrary(dwell, "tram")).toEqual([15, 25, 45]);
    expect(paramLibrary(dwell, "bus")).toEqual([15, 30, 60]);
    const refuel = LIBRARY_PARAMS.find((p) => p.id === "operations.refuel_time_min")!;
    expect(paramLibrary(refuel, "*", "hydrogen")).toEqual([7, 10, 20]);
    expect(paramPrefId("mode.dwell_s", "*")).toBe("mode.dwell_s");
    expect(paramPrefId("mode.dwell_s", "tram")).toBe("mode.dwell_s.tram");
    expect(paramPrefId("operations.refuel_time_min", "*", "cng")).toBe("operations.refuel_time_min.cng");
  });

  it("keeps enum and text values apart from numbers, and removes them again", () => {
    const doc = withChoice(withPref(null, "mode.dwell_s", 40), "mode.right_of_way.tram", "A");
    expect(choiceValue(doc, "mode.right_of_way.tram")).toBe("A");
    expect(prefValue(doc, "mode.dwell_s")).toBe(40);
    const back = withChoice(doc, "mode.right_of_way.tram", null);
    expect(back.choices).toBeUndefined();
    expect(back.values).toEqual({ "mode.dwell_s": 40 });
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

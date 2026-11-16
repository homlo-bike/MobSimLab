import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptable,
  DEMAND_PARAMS,
  DEMAND_STEPS,
  demandParam,
  demandValue,
  demandValues,
} from "../src/features/demand/params";
import { DemandParamsSection } from "../src/workspace/DemandParams";
import { withPref } from "../src/workspace/preferences";

afterEach(cleanup);

describe("demand model values", () => {
  it("has every step and the library's values, with the project's on top", () => {
    expect(DEMAND_STEPS).toEqual([
      "zones",
      "generation",
      "periods",
      "distribution",
      "mode_choice",
      "catchment",
      "assignment",
    ]);
    for (const s of DEMAND_STEPS) expect(DEMAND_PARAMS.some((p) => p.step === s)).toBe(true);
    for (const p of DEMAND_PARAMS)
      expect(p.values[0] <= p.values[1] && p.values[1] <= p.values[2]).toBe(true);
    expect(demandValue("demand.area_buffer_m", null)).toBe(2000);
    expect(demandValue("demand.walk_speed_kmh", null)).toBe(4.5);
    const doc = withPref(null, "demand.area_buffer_m", 3000);
    expect(demandValue("demand.area_buffer_m", doc)).toBe(3000);
    expect(demandValues(doc)["demand.area_buffer_m"]).toBe(3000);
    expect(Object.keys(demandValues(null))).toHaveLength(DEMAND_PARAMS.length);
    expect(() => demandParam("demand.nonsense")).toThrow();
  });

  it("refuses values outside what a parameter can take", () => {
    expect(acceptable(demandParam("demand.mode.ivt.hbw"), -0.03)).toBe(true);
    expect(acceptable(demandParam("demand.area_buffer_m"), -1)).toBe(false);
    expect(acceptable(demandParam("demand.mode.car_availability"), 1.2)).toBe(false);
    expect(acceptable(demandParam("demand.mode.car_availability"), Number.NaN)).toBe(false);
  });

  it("lists the values by step in Project preferences and saves the project's own", () => {
    const onPreferences = vi.fn();
    render(<DemandParamsSection preferences={{ values: {} }} editable onPreferences={onPreferences} />);
    expect(screen.getByRole("heading", { name: "Demand model" })).toBeTruthy();
    const buffer = screen.getByLabelText(/Model area: distance around/);
    fireEvent.change(buffer, { target: { value: "3000" } });
    expect(onPreferences).toHaveBeenCalledWith({ values: { "demand.area_buffer_m": 3000 } });
    // Nonsense is not saved.
    onPreferences.mockClear();
    fireEvent.change(buffer, { target: { value: "-5" } });
    expect(onPreferences).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Model step"), { target: { value: "mode_choice" } });
    expect(screen.getByLabelText(/utility of one minute in a vehicle for home–work/)).toBeTruthy();
    expect(screen.queryByLabelText(/Model area: distance around/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Model step"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Search the values"), { target: { value: "BPR" } });
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search the values"), { target: { value: "zzz" } });
    expect(screen.getByText("No value matches.")).toBeTruthy();
  });

  it("shows a changed value with a way back to the library's", () => {
    const onPreferences = vi.fn();
    const doc = withPref(null, "demand.area_buffer_m", 3000);
    render(<DemandParamsSection preferences={doc} editable onPreferences={onPreferences} />);
    expect(screen.getByLabelText("Model step").textContent).toContain("1 changed");
    fireEvent.click(screen.getByRole("button", { name: "Use the library value" }));
    expect(onPreferences).toHaveBeenCalledWith({ values: {} });
  });
});

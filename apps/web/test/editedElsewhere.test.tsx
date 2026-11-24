import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hasOwnSection } from "../src/workspace/editedElsewhere";
import { ParametersSection, shownParams } from "../src/workspace/Parameters";
import { PLUGINS } from "../src/plugins/registry";
import { LIBRARY_PARAMS, type PreferencesDoc } from "../src/workspace/preferences";

afterEach(cleanup);

describe("each library value is set in one place", () => {
  it("knows the values set in a section of their own", () => {
    for (const id of [
      "demand.mode.wait_weight",
      "street.mixed_traffic_delay_share",
      "road.off_peak_traffic_share",
      "cost.vehicle_each",
      "benefit.ridership.saturday_share",
      "appraisal.discount.financial",
      "energy.grid_kg_co2e_per_kwh",
      "timetable.max_terminal_wait_min",
      "mode.spare_share",
      "journey.same_name_station_m",
      "appraisal.mca.weight.jobs",
    ])
      expect(hasOwnSection(id), id).toBe(true);
    // Used by the cost model without a row of its own in the cost tables: still in All parameters.
    expect(hasOwnSection("cost.single_track_share")).toBe(false);
    expect(hasOwnSection("noise.grid_spacing_m")).toBe(false);
  });

  it("leaves them out of All parameters, with groups that are left empty", () => {
    render(<ParametersSection preferences={null} editable onPreferences={() => undefined} />);
    const groups = screen.getByLabelText("Group") as HTMLSelectElement;
    const names = [...groups.options].map((o) => o.value);
    expect(names).not.toContain("Appraisal");
    expect(names).not.toContain("Benefits");
    expect(names).toContain("Noise");
    const shown = LIBRARY_PARAMS.filter((p) => !hasOwnSection(p.id));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(LIBRARY_PARAMS.length);
  });

  it("lists the cable car, ferry and on-demand bus values while their plugins are on, and saves a change", () => {
    let saved: PreferencesDoc | null = null;
    render(
      <ParametersSection
        preferences={null}
        editable
        onPreferences={(d) => {
          saved = d;
        }}
      />,
    );
    const groups = screen.getByLabelText("Group") as HTMLSelectElement;
    const names = [...groups.options].map((o) => o.value);
    for (const g of ["Cable cars", "Ferries", "Energy and emissions"]) expect(names).toContain(g);
    // Their prices are set in Tables → Costs.
    expect(names).not.toContain("Cable car costs");
    expect(hasOwnSection("ropeway.cost.station_each")).toBe(true);
    const modes = [...(screen.getByLabelText("Mode") as HTMLSelectElement).options].map((o) => o.value);
    expect(modes).toEqual(expect.arrayContaining(["cable_car", "aerial_tramway", "ferry", "on_demand_bus"]));
    fireEvent.change(groups, { target: { value: "Cable cars" } });
    const span = screen.getByLabelText("Span between supports, maximum");
    fireEvent.change(span, { target: { value: "250" } });
    expect(saved!.values["ropeway.max_span_m"]).toBe(250);
    expect(screen.getByLabelText("Station approach, length")).toBeTruthy();
  });

  it("leaves a plugin's values out when the project has turned it off", () => {
    expect(shownParams(PLUGINS).some((p) => p.id === "ropeway.max_span_m")).toBe(true);
    const off = PLUGINS.filter((p) => p.id !== "org.mobsimlab.aerial-lift");
    expect(shownParams(off).some((p) => p.id.startsWith("ropeway."))).toBe(false);
    expect(shownParams(off).some((p) => p.id.startsWith("ferry."))).toBe(true);
  });
});

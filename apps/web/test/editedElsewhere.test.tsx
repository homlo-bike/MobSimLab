import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hasOwnSection } from "../src/workspace/editedElsewhere";
import { ParametersSection } from "../src/workspace/Parameters";
import { LIBRARY_PARAMS } from "../src/workspace/preferences";

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
});

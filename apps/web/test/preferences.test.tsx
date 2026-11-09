import { describe, expect, it } from "vitest";
import { delaysFrom, prefValue, withPref } from "../src/workspace/preferences";

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
});

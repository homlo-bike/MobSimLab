import { describe, expect, it } from "vitest";
import { type AccessRules, accessRules, judge, lineAccess } from "../src/features/railways/platformAccess";
import type { CatalogueTrain, Network, ServiceLine } from "../src/features/railways/types";

const rules: AccessRules = {
  level_gap_horizontal_mm: 75,
  level_gap_vertical_mm: 50,
  step_gap_horizontal_mm: 200,
  step_above_platform_mm: 230,
  step_below_platform_mm: 160,
  vehicle_floor_height_mm: 780,
  platform_height_mm: 760,
  platform_edge_offset_m: 1.45,
  stopping_tolerance_m: 5,
};

describe("judge (TSI PRM step and gap)", () => {
  it("gives level access within 50 mm and 75 mm", () => {
    expect(judge(20, 50, rules)).toBe("level");
    expect(judge(-50, 75, rules)).toBe("level");
  });
  it("gives step access within the step limits", () => {
    expect(judge(230, 200, rules)).toBe("step");
    expect(judge(-160, 100, rules)).toBe("step");
    expect(judge(20, 150, rules)).toBe("step");
  });
  it("needs a boarding aid beyond them", () => {
    expect(judge(231, 100, rules)).toBe("aid");
    expect(judge(-161, 100, rules)).toBe("aid");
    expect(judge(20, 240, rules)).toBe("aid");
  });
  it("flags a train wider than the platform edge allows", () => {
    expect(judge(0, -20, rules)).toBe("clash");
  });
  it("judges the step alone when the width is unknown", () => {
    expect(judge(20, null, rules)).toBe("level");
  });
});

const train = (over: Partial<CatalogueTrain> = {}): CatalogueTrain => ({
  id: "t",
  name: "T",
  mode: "regional_rail",
  length_m: 60,
  top_speed_kmh: 160,
  power_kw: null,
  empty_mass_t: null,
  capacity: 300,
  width_m: 2.8,
  floor_height_mm: 780,
  ...over,
});

const doc = {
  mode: "regional_rail",
  stations: [
    {
      id: 1,
      name: "A",
      x: 0,
      y: 0,
      rotation_deg: 0,
      level: "street",
      side_platforms: 2,
      island_platforms: 0,
      platform_length_m: 170,
    },
    {
      id: 2,
      name: "B",
      x: 900,
      y: 0,
      rotation_deg: 0,
      level: "street",
      side_platforms: 2,
      island_platforms: 0,
      platform_length_m: 100,
    },
  ],
} as unknown as Network;
const line = { id: "l", stations: [1, 2, 99], units: 2 } as unknown as ServiceLine;

describe("lineAccess", () => {
  it("checks every stop that exists, with the gap from the edge offset and half the width", () => {
    const out = lineAccess(doc, line, train(), () => rules);
    expect(out.map((s) => s.station)).toEqual([1, 2]);
    expect(out[0]).toMatchObject({
      vertical_mm: 20,
      horizontal_mm: 50,
      access: "level",
      floor_assumed: false,
    });
    expect(out[0]!.needed_length_m).toBe(125);
    expect(out[1]!.platform_length_m < out[1]!.needed_length_m).toBe(true);
  });
  it("uses the mode's default floor height, and says so, when the train has none", () => {
    const out = lineAccess(doc, line, train({ floor_height_mm: null }), (m) =>
      m === "regional_rail" ? { ...rules, vehicle_floor_height_mm: 1250 } : rules,
    );
    expect(out[0]).toMatchObject({
      floor_height_mm: 1250,
      floor_assumed: true,
      vertical_mm: 490,
      access: "aid",
    });
  });
});

describe("accessRules", () => {
  it("takes the library's values, and the project's where it set them", () => {
    expect(accessRules(null, "regional_rail")).toMatchObject({
      level_gap_horizontal_mm: 75,
      level_gap_vertical_mm: 50,
      platform_height_mm: 760,
      platform_edge_offset_m: 1.65,
      stopping_tolerance_m: 5,
      vehicle_floor_height_mm: 780,
    });
    const own = accessRules(
      { "regional_rail.platform_height_mm": 550, "tram.step_above_platform_mm": 1 },
      "regional_rail",
    );
    expect(own.platform_height_mm).toBe(550);
    expect(own.step_above_platform_mm).toBe(230);
  });
});

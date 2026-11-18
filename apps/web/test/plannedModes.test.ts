import { describe, expect, it } from "vitest";
import { offeredModes, plansRail, plansStreet } from "../src/projects/plannedModes";
import { RAIL_MODES } from "../src/features/railways/modes";

const STREET = ["bus", "brt", "trolleybus", "intercity_bus"];
const id = (m: string) => m;

describe("the modes the project plans to use", () => {
  it("offers every mode until the project narrows them down", () => {
    expect(offeredModes(STREET, id, [])).toEqual(STREET);
    expect(plansStreet([])).toBe(true);
    expect(plansRail([])).toBe(true);
  });

  it("offers only the planned modes, in the editor's order, and keeps the one in use", () => {
    expect(offeredModes(STREET, id, ["tram", "bus"])).toEqual(["bus"]);
    // A line drawn as BRT before the plan changed still shows BRT.
    expect(offeredModes(STREET, id, ["tram", "bus"], "brt")).toEqual(["bus", "brt"]);
    expect(offeredModes(RAIL_MODES, (m) => m.id, ["bus", "tram"]).map((m) => m.id)).toEqual(["tram"]);
  });

  it("matches the project's intercity rail to the railway editor's long distance rail", () => {
    expect(offeredModes(RAIL_MODES, (m) => m.id, ["intercity_rail"]).map((m) => m.id)).toEqual([
      "long_distance_rail",
    ]);
  });

  it("tells whether the plan has street or rail modes", () => {
    expect(plansStreet(["tram"])).toBe(false);
    expect(plansRail(["tram"])).toBe(true);
    expect(plansStreet(["bus"])).toBe(true);
    expect(plansRail(["bus"])).toBe(false);
  });
});

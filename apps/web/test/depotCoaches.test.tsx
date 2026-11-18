import { describe, expect, it } from "vitest";
import { depotInput, newDepot, typicalVehicle } from "../src/features/depots/model";

describe("own slots for a mode's typical vehicle", () => {
  it("names the typical coach like a street line without a catalogue vehicle", () => {
    expect(typicalVehicle("intercity_bus")).toMatchObject({ key: "mode:intercity_bus:13", length_m: 13 });
    expect(typicalVehicle("bus")).toMatchObject({ key: "mode:bus:12", length_m: 12 });
  });

  it("sends the typical coach to the layout only when a zone is sized for it", () => {
    const d = { ...newDepot("Depot"), modes: ["bus", "intercity_bus"] as ("bus" | "intercity_bus")[] };
    const zone = {
      id: "z1",
      kind: "parking" as const,
      ring: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
      ] as [number, number][],
      angle_deg: 90 as const,
      vehicles_per_lane: null,
      vehicle: null as string | null,
      aisle_width_m: null,
      heading_deg: null,
    };
    expect(depotInput({ ...d, zones: [zone] }, [], undefined).vehicles).toEqual([]);
    const coaches = depotInput(
      { ...d, zones: [{ ...zone, vehicle: "mode:intercity_bus:13" }] },
      [],
      undefined,
    );
    expect(coaches.vehicles.map((v) => v.key)).toEqual(["mode:intercity_bus:13"]);
  });
});

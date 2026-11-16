import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as wasm from "../src/wasm/energy/energy_wasm.js";
import { loadWasmEnergy } from "../src/features/energy/engine";
import { EnergySection, energyInputs } from "../src/features/energy/EnergySection";
import { ELECTRIC_SHARE, energyInTables, energyValues, GRID } from "../src/features/energy/params";
import type { LineFact } from "../src/features/tables/lineFacts";
import type { PreferencesDoc } from "../src/workspace/preferences";

afterEach(cleanup);

beforeAll(async () => {
  // Built by tools/wasm/build-energy.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/energy/energy_wasm_bg.wasm");
  await wasm.default({ module_or_path: readFileSync(file) });
});

/** A line fact with only what the energy estimate reads. */
function fact(id: string, mode: string, kmPerYear: number, places: number): LineFact {
  return { id, name: id, mode, kmPerYear, placesPerVehicle: places } as unknown as LineFact;
}

describe("energy plugin values", () => {
  it("is offered in the Tables tab and resolves values per mode with the project's on top", () => {
    expect(energyInTables()).toBe(true);
    const bus = energyValues("bus", {});
    expect(bus["energy.diesel_l_per_vkm"]).toBe(0.39);
    expect(bus[ELECTRIC_SHARE]).toBe(0);
    expect(energyValues("tram", {})["energy.electric_wh_per_place_km"]).toBe(15);
    expect(energyValues("tram", {})[ELECTRIC_SHARE]).toBe(1);
    // A value for one mode wins over one for every mode.
    const prefs = { [GRID]: 0.05, [`${ELECTRIC_SHARE}.bus`]: 0.5 };
    expect(energyValues("bus", prefs)[GRID]).toBe(0.05);
    expect(energyValues("bus", prefs)[ELECTRIC_SHARE]).toBe(0.5);
    expect(energyValues("brt", prefs)[ELECTRIC_SHARE]).toBe(0);
  });

  it("estimates a diesel bus and a tram line in WebAssembly", async () => {
    const engine = await loadWasmEnergy();
    const e = engine.estimate(
      energyInputs([fact("Bus 1", "bus", 1_000_000, 80), fact("T1", "tram", 500_000, 200)], {}),
    );
    const [bus, tram] = e.lines;
    // 0.39 L/km and (2.66 + 0.61) kg CO2e per litre.
    expect(bus!.diesel_l).toBeCloseTo(390_000);
    expect(bus!.co2e_kg).toBeCloseTo(390_000 * 3.27);
    // 15 Wh per place-km × 200 places = 3 kWh per tram-km, at 0.2 kg CO2e/kWh.
    expect(tram!.kwh_per_vkm).toBeCloseTo(3);
    expect(tram!.co2e_kg).toBeCloseTo(1_500_000 * 0.2);
    expect(e.total.co2e_kg).toBeCloseTo(bus!.co2e_kg + tram!.co2e_kg);
    expect(Object.keys(e.by_mode).sort()).toEqual(["bus", "tram"]);
  });
});

describe("energy section", () => {
  it("shows the lines and saves the grid intensity and battery bus share as project values", async () => {
    const onPreferences = vi.fn<(d: PreferencesDoc) => void>();
    render(
      <EnergySection
        facts={[fact("Bus 1", "bus", 1_000_000, 80), fact("T1", "tram", 500_000, 200)]}
        preferences={{ values: {} }}
        onPreferences={onPreferences}
        loadEngine={loadWasmEnergy}
      />,
    );
    const table = await screen.findByRole("region", { name: "Energy and emissions per line" });
    expect(within(table).getByText("1,275 t")).toBeTruthy();
    expect(within(table).getByText("300 t")).toBeTruthy();
    expect(within(table).getByText("All lines")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Grid electricity, kg CO2e per kWh"), {
      target: { value: "0.05" },
    });
    expect(onPreferences).toHaveBeenLastCalledWith({ values: { [GRID]: 0.05 } });
    fireEvent.change(screen.getByLabelText("Bus: battery electric, %"), { target: { value: "40" } });
    expect(onPreferences).toHaveBeenLastCalledWith({ values: { [`${ELECTRIC_SHARE}.bus`]: 0.4 } });
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkVehicle,
  EMPTY_FLEET,
  fleetFrom,
  type FleetDoc,
  nextNumber,
  ownCapacity,
  readVehicleFile,
  withNewUnits,
  withOwnVehicles,
  withoutOwnVehicle,
} from "../src/features/fleet/model";
import { railVehicles, setOwnVehicles, streetVehicles } from "../src/features/fleet/registry";
import { trainById, trainsFor } from "../src/features/railways/serviceLines";
import { vehicleById, vehiclesFor } from "../src/features/street-lines/service";
import { lineVehicle } from "../src/features/depots/model";
import type { SavedStreetLine } from "../src/features/street-lines/saved";
import { OwnVehiclesSection } from "../src/workspace/OwnVehicles";
import { FleetSection } from "../src/workspace/Fleet";
import type { SavedDepot } from "../src/features/depots/types";

const ROOT = `${__dirname}/../../..`;

/** A tram in the research format (vehicle-catalogue/research-prompt.md). */
const RESEARCH = {
  id: "siemens-avenio-munich-4-car",
  mode: "tram",
  name: "Avenio",
  variant: "Munich TZ 4-car",
  producer: "Siemens",
  dimensions: { lengthM: 36.85, widthM: 2.3, emptyWeightT: 45 },
  consist: { cars: 4 },
  capacity: { seated: 60, standing: 159, total: 219, standingDensityPersM2: 4 },
  performance: { maxSpeedKmh: 70, tractionPowerKw: 600 },
  energy: { supply: "overhead_wire", supplySystems: ["dc_750"] },
  sources: [{ url: "https://example.org/avenio" }],
};

/** A battery bus in the research format, as created in a project. */
const BUS = {
  id: "volvo-7900-electric",
  mode: "bus",
  name: "7900 Electric",
  producer: "Volvo",
  dimensions: { lengthM: 12, widthM: 2.55, turningCircleM: 21.9 },
  capacity: { seated: 30, total: 95 },
  performance: { maxSpeedKmh: 70 },
  energy: { supply: "battery" },
};

afterEach(() => {
  cleanup();
  setOwnVehicles([]);
});

describe("own vehicles", () => {
  it("reads the research format", () => {
    const [r] = readVehicleFile("avenio.json", JSON.stringify(RESEARCH));
    expect(r && "vehicle" in r).toBe(true);
    if (!r || !("vehicle" in r)) return;
    expect(r.vehicle).toMatchObject({
      id: "own-siemens-avenio-munich-4-car",
      name: "Siemens Avenio (Munich TZ 4-car)",
      mode: "tram",
      length_m: 36.85,
      width_m: 2.3,
      seats: 60,
      standing: 159,
      top_speed_kmh: 70,
      energy: "overhead-dc",
      power_kw: 600,
      cars: 4,
      sources: ["https://example.org/avenio"],
      origin: "upload",
    });
    // 60 seats plus 159 standing places at the quoted 4 pers/m², counted at the tram's 4 pers/m².
    expect(ownCapacity(r.vehicle)).toBe(219);
  });

  it("reads the catalogue format, and the same capacity as the catalogue's list", () => {
    const text = readFileSync(`${ROOT}/vehicles/tram/alstom_citadis-401-luas.json`, "utf8");
    const [r] = readVehicleFile("citadis.json", text);
    if (!r || !("vehicle" in r)) throw new Error("not read");
    expect(r.vehicle.id).toBe("own-alstom-citadis-401-luas");
    expect(r.vehicle.mode).toBe("tram");
    const catalogue = trainById("alstom_citadis-401-luas");
    expect(ownCapacity(r.vehicle)).toBe(catalogue?.capacity);
  });

  it("reads a list of vehicles from one file", () => {
    const out = readVehicleFile("two.json", JSON.stringify([RESEARCH, BUS]));
    expect(out.map((r) => "vehicle" in r)).toEqual([true, true]);
  });

  it("rejects a vehicle without a core value, and says which", () => {
    const noSize = { ...RESEARCH, dimensions: { lengthM: 36.85 }, capacity: { total: 219 } };
    const [r] = readVehicleFile("x.json", JSON.stringify(noSize));
    expect(r && "rejected" in r && r.rejected).toEqual({
      missing: ["width", "seats", "standing"],
      invalid: [],
    });
    const [u] = readVehicleFile("x.json", JSON.stringify({ ...BUS, energy: { supply: "steam" } }));
    expect(u && "rejected" in u && u.rejected.missing).toEqual(["energy"]);
    expect(readVehicleFile("x.json", "not json")).toEqual([
      { file: "x.json", label: "x.json", unreadable: true },
    ]);
  });

  it("rejects values out of range, such as millimetres for metres", () => {
    const c = checkVehicle({
      name: "Bus",
      mode: "bus",
      length_m: 12000,
      width_m: 2.5,
      seats: 30,
      standing: 60,
      top_speed_kmh: 80,
      energy: "diesel",
      height_m: -3,
    });
    expect("rejected" in c && c.rejected).toEqual({ missing: [], invalid: ["length", "height_m"] });
  });

  it("joins the catalogue's vehicles for the line tools and the depots", () => {
    const [tram] = readVehicleFile("a.json", JSON.stringify(RESEARCH));
    const [bus] = readVehicleFile("b.json", JSON.stringify(BUS));
    if (!tram || !("vehicle" in tram) || !bus || !("vehicle" in bus)) throw new Error("not read");
    const before = streetVehicles().length;
    setOwnVehicles([tram.vehicle, bus.vehicle]);
    expect(streetVehicles().length).toBe(before + 1);
    expect(vehiclesFor("bus").some((v) => v.id === "own-volvo-7900-electric")).toBe(true);
    expect(trainsFor("tram").some((t) => t.id === "own-siemens-avenio-munich-4-car")).toBe(true);
    expect(trainById("own-siemens-avenio-munich-4-car")?.capacity).toBe(219);
    expect(vehicleById("own-volvo-7900-electric")?.energy).toBe("battery");
    const line = { profile: { mode: "bus", length_m: 12 }, vehicle: "own-volvo-7900-electric" };
    expect(lineVehicle(line as unknown as SavedStreetLine)).toMatchObject({
      key: "own-volvo-7900-electric",
      width_m: 2.55,
      turning_circle_m: 21.9,
      battery: true,
    });
    setOwnVehicles([]);
    expect(railVehicles().some((t) => t.id.startsWith("own-"))).toBe(false);
  });
});

describe("fleet", () => {
  it("numbers new vehicles up from the first number", () => {
    expect(nextNumber("101", 2)).toBe("103");
    expect(nextNumber("T-009", 1)).toBe("T-010");
    expect(nextNumber("A12b", 3)).toBe("A15b");
    const doc = withNewUnits(EMPTY_FLEET, {
      vehicle: "v",
      count: 3,
      first: "0998",
      depot: "d1",
      year: 2024,
      status: "reserve",
    });
    expect(doc.units.map((u) => u.number)).toEqual(["0998", "0999", "1000"]);
    expect(doc.units.every((u) => u.depot === "d1" && u.year === 2024 && u.status === "reserve")).toBe(true);
  });

  it("drops an own vehicle's fleet vehicles with it, and keeps a saved document usable", () => {
    const [r] = readVehicleFile("b.json", JSON.stringify(BUS));
    if (!r || !("vehicle" in r)) throw new Error("not read");
    let doc = withOwnVehicles(EMPTY_FLEET, [r.vehicle]);
    doc = withNewUnits(doc, {
      vehicle: r.vehicle.id,
      count: 2,
      first: "1",
      depot: null,
      year: null,
      status: "active",
    });
    doc = withNewUnits(doc, {
      vehicle: "other",
      count: 1,
      first: "9",
      depot: null,
      year: null,
      status: "active",
    });
    // Uploading the same vehicle again replaces it.
    expect(withOwnVehicles(doc, [{ ...r.vehicle, seats: 31 }]).vehicles).toHaveLength(1);
    expect(withoutOwnVehicle(doc, r.vehicle.id).units.map((u) => u.vehicle)).toEqual(["other"]);
    const saved = fleetFrom(JSON.parse(JSON.stringify(doc)));
    expect(saved).toEqual(doc);
    expect(fleetFrom({ vehicles: [{ id: "own-x", name: "broken" }], units: [{ id: "u" }] })).toEqual(
      EMPTY_FLEET,
    );
  });
});

/** Own vehicles and fleet sections with their document kept in state, as Project preferences keeps it. */
function Harness({ depots = [] }: { depots?: SavedDepot[] }) {
  const [fleet, setFleet] = useState<FleetDoc>(EMPTY_FLEET);
  setOwnVehicles(fleet.vehicles);
  return (
    <>
      <OwnVehiclesSection fleet={fleet} editable onFleet={setFleet} />
      <FleetSection
        fleet={fleet}
        preferences={null}
        projectModes={["bus"]}
        depots={depots}
        editable
        onFleet={setFleet}
      />
      <pre data-testid="doc">{JSON.stringify(fleet)}</pre>
    </>
  );
}

const docOf = () => JSON.parse(screen.getByTestId("doc").textContent ?? "{}") as FleetDoc;

describe("own vehicles and fleet in Project preferences", () => {
  it("uploads files, adding the good vehicles and saying why others are not added", async () => {
    render(<Harness />);
    const good = new File([JSON.stringify(BUS)], "bus.json", { type: "application/json" });
    const bad = new File([JSON.stringify({ ...BUS, id: "x", dimensions: {} })], "bad.json");
    fireEvent.change(screen.getByTestId("fleet-upload"), { target: { files: [good, bad] } });
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Added: Volvo 7900 Electric.");
    expect(status.textContent).toContain("Not added: 7900 Electric. Missing: Length (m), Width (m).");
    expect(docOf().vehicles.map((v) => v.id)).toEqual(["own-volvo-7900-electric"]);
    expect(screen.getByText("Uploaded")).toBeTruthy();
  });

  it("creates a vehicle with the form, and needs its core values", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Create vehicle" }));
    const form = screen.getByRole("form", { name: "New vehicle" });
    const q = within(form);
    fireEvent.change(q.getByLabelText("Name *"), { target: { value: "Town minibus" } });
    fireEvent.change(q.getByLabelText("Length (m) *"), { target: { value: "8,5" } });
    fireEvent.click(q.getByRole("button", { name: "Save vehicle" }));
    expect(q.getByRole("alert").textContent).toBe(
      "Missing: Width (m), Seats, Standing places, Top speed (km/h), Energy source.",
    );
    fireEvent.change(q.getByLabelText("Width (m) *"), { target: { value: "2.3" } });
    fireEvent.change(q.getByLabelText("Seats *"), { target: { value: "20" } });
    fireEvent.change(q.getByLabelText("Standing places *"), { target: { value: "25" } });
    fireEvent.change(q.getByLabelText("Top speed (km/h) *"), { target: { value: "80" } });
    fireEvent.change(q.getByLabelText("Energy source *"), { target: { value: "battery" } });
    fireEvent.click(q.getByRole("button", { name: "Save vehicle" }));
    expect(docOf().vehicles).toEqual([
      expect.objectContaining({
        id: "own-town-minibus",
        length_m: 8.5,
        origin: "created",
        energy: "battery",
      }),
    ]);
    expect(screen.queryByRole("form", { name: "New vehicle" })).toBeNull();
    expect(screen.getByText("Created")).toBeTruthy();
  });

  it("adds fleet vehicles of a type with a home depot, then changes one", async () => {
    const depot = { id: "d1", name: "North depot", modes: ["bus"] } as unknown as SavedDepot;
    render(<Harness depots={[depot]} />);
    const add = screen.getByRole("form", { name: "Add vehicles" });
    const q = within(add);
    const bus = vehiclesFor("bus")[0]!;
    fireEvent.change(q.getByLabelText("Vehicle"), { target: { value: bus.id } });
    fireEvent.change(q.getByLabelText("How many"), { target: { value: "3" } });
    fireEvent.change(q.getByLabelText("First fleet number"), { target: { value: "201" } });
    fireEvent.change(q.getByLabelText("Home depot"), { target: { value: "d1" } });
    fireEvent.change(q.getByLabelText("Year in service"), { target: { value: "2022" } });
    fireEvent.click(q.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(docOf().units).toHaveLength(3));
    expect(docOf().units.map((u) => [u.number, u.vehicle, u.depot, u.year, u.status])).toEqual([
      ["201", bus.id, "d1", 2022, "active"],
      ["202", bus.id, "d1", 2022, "active"],
      ["203", bus.id, "d1", 2022, "active"],
    ]);
    expect(screen.getByText(/3 in total \(3 active\)/)).toBeTruthy();
    const list = screen.getByRole("list", { name: "Fleet" });
    fireEvent.change(within(list).getAllByLabelText("Status")[1]!, { target: { value: "maintenance" } });
    expect(docOf().units[1]?.status).toBe("maintenance");
    fireEvent.click(within(list).getByRole("button", { name: "Delete fleet vehicle 203" }));
    expect(docOf().units.map((u) => u.number)).toEqual(["201", "202"]);
  });

  it("refuses to add nonsense", () => {
    render(<Harness />);
    const q = within(screen.getByRole("form", { name: "Add vehicles" }));
    fireEvent.change(q.getByLabelText("How many"), { target: { value: "0" } });
    fireEvent.click(q.getByRole("button", { name: "Add" }));
    expect(q.getByRole("alert").textContent).toBe("Add 1 to 500 vehicles at a time.");
    expect(docOf().units).toHaveLength(0);
  });
});

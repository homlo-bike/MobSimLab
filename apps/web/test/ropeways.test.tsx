import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BASE_PRICES } from "../src/features/costs/economy";
import { estimate, perLine } from "../src/features/costs/model";
import { lineFacts } from "../src/features/tables/lineFacts";
import { NetworkTables } from "../src/features/tables/NetworkTables";
import { ropewayLines } from "../src/features/tables/ropeways";
import { TimetableTables } from "../src/features/timetables/TimetableTables";
import type { SavedPluginLine } from "../src/kits/saved";
import { PLUGINS, setActivePlugins, type Plugin } from "../src/plugins/registry";

afterEach(() => {
  cleanup();
  setActivePlugins(PLUGINS);
});

const A: [number, number] = [36.28259731274355, 33.524927584792195];
const B: [number, number] = [36.27780268725678, 33.53073318576979];

/** The Damascus test's cable car as the project saved it: 785 m, two stations, a cabin every 12 s. */
function gondola(): Record<string, SavedPluginLine> {
  return {
    "cable-car": {
      kit: "straight-spans",
      doc: { mode: "cable_car", system: "mgd", lineSpeed: null },
      line: {
        id: "cable-car",
        mode: "cable_car",
        name: "C1 Qasioun cable car",
        color: "#7c3aed",
        stops: [
          { name: "Muhajreen", lonlat: A },
          { name: "Qasioun viewpoint", lonlat: B },
        ],
        headwayS: 60,
        directions: [
          [
            { stop: 0, run_s: 0, dwell_s: 0 },
            { stop: 1, run_s: 130.8, dwell_s: 0 },
          ],
          [
            { stop: 1, run_s: 0, dwell_s: 0 },
            { stop: 0, run_s: 130.8, dwell_s: 0 },
          ],
        ],
      },
      noise: {
        kit: "straight-spans",
        mode: "cable_car",
        system: "mgd",
        operation: "continuous",
        headway_s: 12,
        trip_time_s: 130.8,
        stations: [
          { lonlat: A, kind: "intermediate" },
          { lonlat: B, kind: "intermediate" },
        ],
        station_height_m: 8,
        towers: [],
      },
    },
  };
}

const DAY = { firstS: 5 * 3600, lastS: 24 * 3600, peaks: [] as [number, number][] };

/** The bundled cable car plugin with cost values, so the tests do not depend on the library's numbers. */
function withCosts(): Plugin[] {
  return PLUGINS.map((p) => {
    if (!p.defaults.cable_car) return p;
    const cost = {
      "ropeway.cost.station_each": { low: 8, central: 10, high: 20 },
      "ropeway.cost.line_per_km": { low: 10, central: 20, high: 30 },
      "ropeway.cost.cabin_each": { low: 0.05, central: 0.1, high: 0.2 },
      "ropeway.cost.station_hour": { low: 100, central: 200, high: 300 },
    };
    return {
      ...p,
      parameters: {
        ...p.parameters,
        "ropeway.cost.station_each": {
          label: "Cable car station",
          unit: "US$ million per station (2023, PPP)",
        },
        "ropeway.cost.line_per_km": {
          label: "Rope, towers and drives",
          unit: "US$ million per km (2023, PPP)",
        },
        "ropeway.cost.cabin_each": { label: "Cabin", unit: "US$ million each (2023, market)" },
        "ropeway.cost.station_hour": { label: "Station staff and energy", unit: "US$ per hour (2023, PPP)" },
      },
      defaults: {
        ...p.defaults,
        cable_car: Object.fromEntries(
          Object.entries(p.defaults.cable_car).map(([k, v]) => [k, { ...v, ...cost }]),
        ),
      },
    };
  });
}

describe("cable car lines in the tables", () => {
  it("works out the service, cabins and capacity from the saved line", () => {
    const [r] = ropewayLines(gondola(), DAY);
    expect(r).toMatchObject({
      id: "plugin:cable-car",
      name: "C1 Qasioun cable car",
      stations: 2,
      headwayS: 12,
    });
    expect(r!.lengthKm).toBeCloseTo(0.785, 2);
    // 2 × 785 m of rope at 6 m/s with a cabin every 12 s: 72 m apart, 22 cabins, plus 10 % reserve.
    expect(r!.inService).toBe(22);
    expect(r!.fleet).toBe(24);
    // 19 hours, a cabin every 12 s each way.
    expect(r!.tripsPerDay).toBe(2 * (19 * 300 + 1));
    expect(r!.placesPerCabin).toBe(10);
    // Lines that are not cable cars, or not finished, are left out.
    expect(ropewayLines({ x: { ...gondola()["cable-car"]!, noise: null } }, DAY)).toEqual([]);
  });

  it("lists the cable car among the lines, with its fleet and capacity", () => {
    const ropeways = ropewayLines(gondola(), DAY);
    const facts = lineFacts({ railway: null, view: null, reports: {}, streetLines: [], prefs: {}, ropeways });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: "plugin:cable-car",
      kind: "ropeway",
      mode: "cable_car",
      stops: 2,
      fleet: 24,
      inService: 22,
      capacityPerHour: 3000,
      serviceHours: 19,
    });
    expect(facts[0]!.hoursPerYear).toBeGreaterThan(0);
  });

  it("prices stations, rope, cabins and staff when the plugin has cost values", () => {
    const ropeways = ropewayLines(gondola(), DAY);
    const none = estimate({
      railway: null,
      view: null,
      reports: {},
      streetLines: [],
      prefs: {},
      prices: BASE_PRICES,
      ropeways,
    });
    expect(none.lines.map((l) => l.id)).toEqual(["plugin:cable-car"]);

    setActivePlugins(withCosts());
    const e = estimate({
      railway: null,
      view: null,
      reports: {},
      streetLines: [],
      prefs: { "ropeway.cost.station_each.cable_car": 20 },
      prices: BASE_PRICES,
      ropeways,
    });
    const item = (param: string) => e.items.find((x) => x.param === param)!;
    // The project's own value doubles the station cost, low and high in proportion.
    expect(item("ropeway.cost.station_each")).toMatchObject({ category: "stations", quantity: 2 });
    expect(item("ropeway.cost.station_each").rate[1] / item("ropeway.cost.station_each").rate[0]).toBeCloseTo(
      20 / 16,
    );
    expect(item("ropeway.cost.station_each").library?.values).toEqual([8, 10, 20]);
    expect(item("ropeway.cost.line_per_km")).toMatchObject({ category: "systems" });
    expect(item("ropeway.cost.line_per_km").quantity).toBeCloseTo(0.785, 2);
    expect(item("ropeway.cost.cabin_each")).toMatchObject({ category: "vehicles", quantity: 24 });
    expect(item("ropeway.cost.station_hour")).toMatchObject({ category: "service" });
    // Design, contingency, upkeep and overheads follow as for the other modes, all on the cable car.
    expect(e.items.filter((x) => x.mode === "cable_car").map((x) => x.category)).toEqual(
      expect.arrayContaining(["engineering", "contingency", "maintenance", "overheads"]),
    );
    const own = perLine(e).get("plugin:cable-car")!;
    expect(own.construction[1]).toBeGreaterThan(0);
    expect(own.operating[1]).toBeGreaterThan(0);
  });

  it("shows the cable car in the summary and the service table", () => {
    render(<NetworkTables railway={null} streetLines={null} pluginLines={gondola()} preferences={null} />);
    expect(screen.queryByText(/Nothing to measure yet/)).toBeNull();
    const summary = screen.getByRole("region", { name: "Summary" });
    // The 785 m line and its two stations count in the totals.
    expect(within(summary).getByText(/0\.78 km cable cars/)).toBeTruthy();
    const service = screen.getByRole("region", { name: "Service and fleet per line" });
    expect(within(service).getByText("C1 Qasioun cable car")).toBeTruthy();
    expect(within(service).getByText("12 s")).toBeTruthy();
    expect(within(service).getByText("per cabin")).toBeTruthy();
  });

  it("lists the cable car in the timetables on every day type, without vehicle blocks", () => {
    render(<TimetableTables railway={null} streetLines={null} pluginLines={gondola()} preferences={null} />);
    expect(screen.queryByText(/Nothing to list/i)).toBeNull();
    const blocks = screen.getAllByRole("table")[0]!;
    const row = within(blocks).getAllByRole("row")[1]!;
    expect(row.textContent).toContain("C1 Qasioun cable car");
    expect(row.querySelectorAll("td")[3]!.textContent).toBe("24");
    expect(screen.getAllByText(/A cabin leaves every 12 s in each direction/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("combobox", { name: "Day type" }), { target: { value: "sunday" } });
    expect(within(screen.getAllByRole("table")[0]!).getAllByRole("row")[1]!.textContent).toContain(
      "C1 Qasioun cable car",
    );
  });
});

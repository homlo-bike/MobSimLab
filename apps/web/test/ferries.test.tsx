import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { uncostedLines } from "../src/features/appraisal/inputs";
import type { AppraisalLine } from "../src/features/appraisal/model";
import { BASE_PRICES } from "../src/features/costs/economy";
import { estimate, perLine } from "../src/features/costs/model";
import { energyValues } from "../src/features/energy/params";
import { ferryLines } from "../src/features/tables/ferries";
import { lineFacts } from "../src/features/tables/lineFacts";
import { NetworkTables } from "../src/features/tables/NetworkTables";
import { TimetableTables } from "../src/features/timetables/TimetableTables";
import type { SavedPluginLine } from "../src/kits/saved";
import { PLUGINS, setActivePlugins } from "../src/plugins/registry";

afterEach(() => {
  cleanup();
  setActivePlugins(PLUGINS);
});

const BEIRUT: [number, number] = [35.4955, 33.9006];
const JOUNIEH: [number, number] = [35.6178, 33.9808];

/**
 * A two-pier catamaran line: 15 km in 20 min, a departure every 30 min each way and 10 min at each end, so a
 * round trip is 60 min and two vessels run it.
 */
function ferry(key = "ferry", name = "F1 Beirut – Jounieh"): Record<string, SavedPluginLine> {
  return {
    [key]: {
      kit: "water-route",
      doc: { mode: "ferry", vessel: "catamaran" },
      line: {
        id: key,
        mode: "ferry",
        name,
        color: "#0284c7",
        stops: [
          { name: "Beirut – Zaitunay Bay", lonlat: BEIRUT },
          { name: "Jounieh port", lonlat: JOUNIEH },
        ],
        headwayS: 1800,
        directions: [
          [
            { stop: 0, run_s: 0, dwell_s: 0 },
            { stop: 1, run_s: 1200, dwell_s: 0 },
          ],
          [
            { stop: 1, run_s: 0, dwell_s: 0 },
            { stop: 0, run_s: 1200, dwell_s: 0 },
          ],
        ],
      },
      noise: {
        kit: "water-route",
        mode: "ferry",
        vessel: "catamaran",
        headway_s: 1800,
        legs: [{ path: [BEIRUT, JOUNIEH], length_m: 15000, time_s: 1200 }],
        berths: [
          { lonlat: BEIRUT, name: "Beirut – Zaitunay Bay", docked_s: 600 },
          { lonlat: JOUNIEH, name: "Jounieh port", docked_s: 600 },
        ],
      },
    },
  };
}

const DAY = { firstS: 6 * 3600, lastS: 22 * 3600, peaks: [] as [number, number][] };
const noFerry = () => PLUGINS.filter((p) => !p.defaults.ferry);

describe("ferry lines in the tables", () => {
  it("works out the service, vessels and capacity from the saved line", () => {
    const tools = { ...ferry(), ...ferry("ferry-2", "F2 Express") };
    const [f, g] = ferryLines(tools, DAY);
    expect(f).toMatchObject({
      id: "plugin:ferry",
      name: "F1 Beirut – Jounieh",
      vessel: "catamaran",
      piers: 2,
      lengthKm: 15,
      tripS: 1200,
      cycleS: 3600,
      inService: 2,
      // A reserve of 20 % on two vessels is one more.
      fleet: 3,
      placesPerVessel: 300,
    });
    // 16 hours, a departure every 30 min each way.
    expect(f!.tripsPerDay).toBe(2 * 33);
    expect(f!.vesselHoursPerDay).toBe(32);
    // A second ferry line of the project is listed under its own key.
    expect(g!.id).toBe("plugin:ferry-2");
    // With the ferry plugin turned off, its lines are left out; so are lines that are not finished.
    expect(ferryLines(tools, DAY, noFerry())).toEqual([]);
    expect(ferryLines({ x: { ...ferry().ferry!, noise: null } }, DAY)).toEqual([]);
  });

  it("lists the ferry among the lines, with its fleet and capacity", () => {
    const ferries = ferryLines(ferry(), DAY);
    const facts = lineFacts({ railway: null, view: null, reports: {}, streetLines: [], prefs: {}, ferries });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: "plugin:ferry",
      kind: "ferry",
      mode: "ferry",
      stops: 2,
      inService: 2,
      fleet: 3,
      capacityPerHour: 600,
      tripMin: 20,
      speedKmh: 45,
    });
    expect(facts[0]!.kmPerYear).toBeGreaterThan(0);
  });

  it("prices piers, vessels and vessel-hours from the ferry plugin's values", () => {
    const ferries = ferryLines(ferry(), DAY);
    const e = estimate({
      railway: null,
      view: null,
      reports: {},
      streetLines: [],
      prefs: { "ferry.cost.vessel_each.ferry": 30 },
      prices: BASE_PRICES,
      ferries,
    });
    const item = (param: string) => e.items.find((x) => x.param === param)!;
    expect(item("ferry.cost.pier_each")).toMatchObject({ category: "stations", quantity: 2 });
    expect(item("ferry.cost.pier_each").rate[1] / 1e6).toBeCloseTo(
      4 * BASE_PRICES.ppp * BASE_PRICES.escalation,
    );
    // The catamaran's own vessel price, doubled by the project's own value.
    expect(item("ferry.cost.vessel_each")).toMatchObject({ category: "vehicles", quantity: 3 });
    expect(item("ferry.cost.vessel_each").library?.values).toEqual([8, 15, 20]);
    expect(item("ferry.cost.vessel_each").rate[1] / 1e6).toBeCloseTo(
      30 * BASE_PRICES.fx * BASE_PRICES.escalation,
    );
    expect(item("ferry.cost.vessel_hour")).toMatchObject({ category: "service" });
    expect(e.items.filter((x) => x.mode === "ferry").map((x) => x.category)).toEqual(
      expect.arrayContaining(["engineering", "contingency", "maintenance", "overheads"]),
    );
    const own = perLine(e).get("plugin:ferry")!;
    expect(own.construction[1]).toBeGreaterThan(0);
    expect(own.operating[1]).toBeGreaterThan(0);
  });

  it("gives ferries their own fuel use in the energy section", () => {
    const v = energyValues("ferry", undefined);
    expect(v["energy.electric_share"]).toBe(0);
    expect(v["energy.diesel_l_per_vkm"]).toBe(10);
    expect(v["energy.diesel_kwh_per_l"]).toBeGreaterThan(0);
  });

  it("shows the ferry in the summary and the service table", () => {
    render(<NetworkTables railway={null} streetLines={null} pluginLines={ferry()} preferences={null} />);
    expect(screen.queryByText(/Nothing to measure yet/)).toBeNull();
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText(/15 km ferries/)).toBeTruthy();
    const service = screen.getByRole("region", { name: "Service and fleet per line" });
    expect(within(service).getByText("F1 Beirut – Jounieh")).toBeTruthy();
    expect(within(service).getByText("per vessel")).toBeTruthy();
  });

  it("lists the ferry in the timetables with its departures and vessels", () => {
    render(<TimetableTables railway={null} streetLines={null} pluginLines={ferry()} preferences={null} />);
    const blocks = screen.getAllByRole("table")[0]!;
    const row = within(blocks).getAllByRole("row")[1]!;
    expect(row.textContent).toContain("F1 Beirut – Jounieh");
    expect(row.querySelectorAll("td")[3]!.textContent).toBe("3");
    expect(screen.getAllByText(/2 vessels shuttle back and forth/).length).toBeGreaterThan(0);
  });

  it("hides the ferry everywhere in Tables when its plugin is off", () => {
    setActivePlugins(noFerry());
    render(<NetworkTables railway={null} streetLines={null} pluginLines={ferry()} preferences={null} />);
    expect(screen.getByText(/Nothing to measure yet/)).toBeTruthy();
    cleanup();
    render(<TimetableTables railway={null} streetLines={null} pluginLines={ferry()} preferences={null} />);
    expect(screen.queryByText("F1 Beirut – Jounieh")).toBeNull();
  });
});

describe("appraisal lines without costs", () => {
  const zero: [number, number, number] = [0, 0, 0];
  const line = (id: string, spent: number, riders: number): AppraisalLine => ({
    id,
    name: id,
    mode: "people_mover",
    color: "#000",
    shown: true,
    spending: { civil: [spent, spent, spent], systems: zero, vehicles: zero, operating: zero },
    annual: [riders, riders, riders],
    gdp: zero,
    userDay: null,
    carKmDay: null,
    days: 300,
    growth: 0,
  });

  it("names the lines that carry riders but no costs", () => {
    const out = uncostedLines([line("P1", 0, 1000), line("T1", 5, 1000), line("X", 0, 0)]);
    expect(out.map((l) => l.id)).toEqual(["P1"]);
  });
});

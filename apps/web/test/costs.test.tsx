import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostTables, fmtMoney } from "../src/features/costs/CostTables";
import { currencyOf } from "../src/features/costs/currencies";
import { type CountryEconomy, type EconomyApi, pricesFrom } from "../src/features/costs/economy";
import { CAR_M, estimate, perLine, structureOf, sum } from "../src/features/costs/model";
import { libraryValue, paramValue } from "../src/features/costs/params";
import type { LineReport, Network, RailEngine, RailView, TrackView } from "../src/features/railways/types";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import type { LineView } from "../src/features/street-lines/types";

afterEach(cleanup);

const METRO_TRAIN = "alstom_metropolis-amsterdam-m5-6-car"; // 116.2 m

/** A metro line: 0.5 km at street level, a 0.2 km ramp, then 1.3 km on the second underground level. */
function railway(extra: Partial<Network["tracks"][number]> = {}): Network {
  return {
    origin: [4.9, 52.37],
    mode: "metro",
    stations: [
      {
        id: 1,
        name: "West",
        x: 0,
        y: 0,
        rotation_deg: 0,
        level: "street",
        side_platforms: 2,
        island_platforms: 0,
        platform_length_m: 120,
      },
      {
        id: 2,
        name: "East",
        x: 2000,
        y: 0,
        rotation_deg: 0,
        level: "underground2",
        side_platforms: 0,
        island_platforms: 1,
        platform_length_m: 120,
      },
    ],
    tracks: [
      {
        id: 10,
        name: "Main",
        start: { type: "station", station: 1, end: 1, tracks: [0, 1] },
        end: { type: "station", station: 2, end: 0, tracks: [0, 1] },
        points: [],
        tracks: 2,
        level: "street",
        power: "auto",
        use: "running",
        bed: "auto",
        lead_start_m: 30,
        lead_end_m: 30,
        ...extra,
      },
    ],
    switches: [],
    lines: [
      {
        id: "M1",
        name: "M1",
        color: "#0055aa",
        stations: [1, 2],
        vehicle: METRO_TRAIN,
        units: 1,
        first_min: 300,
        last_min: 1440,
        peak_headway_min: 5,
        offpeak_headway_min: 10,
      },
    ],
  };
}

function railView(): RailView {
  const track = {
    id: 10,
    length_m: 2000,
    tracks: 2,
    mode: "metro",
    levels: [
      { from_m: 0, to_m: 500, level: "street" },
      { from_m: 500, to_m: 700, level: "ramp" },
      { from_m: 700, to_m: 2000, level: "underground2" },
    ],
    centre: [],
  } as unknown as TrackView;
  return {
    tracks: [track],
    stations: [
      { id: 1, lonlat: [4.9, 52.37], mode: "metro" },
      { id: 2, lonlat: [4.929, 52.37], mode: "metro" },
    ],
    switches: [{ id: 1, track: 10 }],
  } as unknown as RailView;
}

const REPORT: LineReport = {
  id: "M1",
  trips: 200,
  outbound_s: 240,
  return_s: 240,
  trains: 4,
  issues: [],
  stations: [],
  shifted: [],
  unplaced: [],
};

function streetView(): LineView {
  const points = (["end_stop", "stop", "end_stop"] as const).map((kind, seq) => ({
    id: seq + 1,
    seq,
    kind,
    name: `P${seq + 1}`,
    lonlat: [7 + seq * 0.01, 50] as [number, number],
    status: "ok" as const,
    message: null,
    bearing_deg: 90,
    bay: null,
  }));
  return {
    points,
    legs: [{ index: 0 }, { index: 1 }],
    length_m: 6000,
    time_s: 1500,
    bus_lane_m: 2000,
  } as unknown as LineView;
}

const STREET: StreetLinesDoc = {
  lines: [
    {
      name: "Route 7",
      profile: {
        mode: "trolleybus",
        height_m: 3.4,
        weight_t: 19,
        length_m: 12,
        max_speed_kmh: 70,
        battery_range_m: 0,
        doors_both_sides: false,
      },
      timing: { headwayMin: 10, dwellS: 20, layoverMin: 5 },
      points: [],
      depot: null,
      depotStops: {},
      view: streetView(),
    },
  ],
} as unknown as StreetLinesDoc;

const ECON: CountryEconomy = {
  country: { iso3: "NLD", iso2: "NL", name: "Netherlands" },
  ppp: { year: 2024, value: 0.8 },
  fx: { year: 2024, value: 0.92 },
  usDeflator: { base: { year: 2023, value: 100 }, latest: { year: 2025, value: 110 } },
  source: { name: "World Bank", note: "", licence: "CC BY 4.0", url: "https://data.worldbank.org/" },
};

const UNIT = {
  currency: "USD",
  ppp: 1,
  fx: 1,
  escalation: 1,
  year: null,
  own: { ppp: false, fx: false, escalation: false },
};

describe("cost parameters and prices", () => {
  it("uses the mode's library value and a project's own medium value, with low and high moving along", () => {
    expect(libraryValue("cost.civil.tbm_per_km", "metro")).toEqual(
      libraryValue("cost.civil.tbm_per_km", "*"),
    );
    const lib = libraryValue("cost.civil.at_grade_per_km", "tram");
    expect(paramValue("cost.civil.at_grade_per_km", "tram", {})).toEqual(lib);
    const own = paramValue("cost.civil.at_grade_per_km", "tram", {
      "cost.civil.at_grade_per_km.tram": lib[1] * 2,
    });
    expect(own).toEqual([lib[0] * 2, lib[1] * 2, lib[2] * 2]);
    // One value for every mode applies where the mode has none of its own.
    expect(paramValue("cost.civil.tbm_per_km", "metro", { "cost.civil.tbm_per_km": 99 })[1]).toBe(99);
  });

  it("converts with the World Bank's values unless the project sets its own", () => {
    const p = pricesFrom(ECON, {});
    expect(p).toMatchObject({ currency: "EUR", ppp: 0.8, fx: 0.92, year: 2025 });
    expect(p.escalation).toBeCloseTo(1.1);
    const q = pricesFrom(ECON, { "cost.country.ppp": 0.75, "cost.country.escalation": 1.2 });
    expect(q).toMatchObject({
      ppp: 0.75,
      fx: 0.92,
      escalation: 1.2,
      own: { ppp: true, fx: false, escalation: true },
    });
    expect(pricesFrom(null, {})).toMatchObject({ currency: "USD", ppp: 1, fx: 1, escalation: 1 });
    expect(currencyOf("deu")).toBe("EUR");
    expect(currencyOf("KEN")).toBe("KES");
    expect(fmtMoney(1.25e9, "EUR")).toBe("€1.3B");
    expect(fmtMoney(5e6, null)).toBe("5M LCU");
  });
});

describe("construction type of a stretch", () => {
  it("follows the railway editor's choice, else the level and mode", () => {
    expect(structureOf("underground", {}, "metro")).toBe("cut_and_cover");
    expect(structureOf("underground2", {}, "metro")).toBe("tbm");
    expect(structureOf("underground", { tunnel: "tbm" }, "metro")).toBe("tbm");
    expect(structureOf("underground2", { tunnel: "cut_and_cover" }, "tram")).toBe("cut_and_cover");
    expect(structureOf("elevated", {}, "tram")).toBe("elevated");
    expect(structureOf("elevated2", {}, "high_speed_rail")).toBe("viaduct");
    expect(structureOf("elevated", { structure: "bridge" }, "metro")).toBe("bridge");
    expect(structureOf("street", { structure: "bridge" }, "metro")).toBe("at_grade");
    expect(structureOf("ramp", {}, "metro")).toBe("ramp");
  });
});

describe("estimate", () => {
  const rail = () =>
    estimate({
      railway: railway(),
      view: railView(),
      reports: { M1: REPORT },
      streetLines: [],
      prefs: {},
      prices: UNIT,
    });

  it("costs each stretch by its construction type, the systems, switches and stations", () => {
    const e = rail();
    const amount = (cat: string) => sum(e.items.filter((x) => x.category === cat).map((x) => x.amount));
    const v = (key: string) => libraryValue(key, "metro");
    expect(amount("at_grade")[1]).toBeCloseTo(0.5 * v("cost.civil.at_grade_per_km")[1] * 1e6);
    expect(amount("ramp")[1]).toBeCloseTo(0.2 * v("cost.civil.ramp_per_km")[1] * 1e6);
    expect(amount("tbm")[1]).toBeCloseTo(1.3 * v("cost.civil.tbm_per_km")[1] * 1e6);
    expect(amount("cut_and_cover")[1]).toBe(0);
    expect(amount("systems")[1]).toBeCloseTo(2 * v("cost.systems_per_km")[1] * 1e6);
    expect(amount("switches")[1]).toBeCloseTo(v("cost.switch_each")[1] * 1e6);
    expect(amount("stations")[1]).toBeCloseTo(
      (v("cost.station.at_grade")[1] + v("cost.station.underground_deep")[1]) * 1e6,
    );
    for (const x of e.items) expect(x.amount[0]).toBeLessThanOrEqual(x.amount[2]);
  });

  it("takes the railway editor's tunnel method", () => {
    const e = estimate({
      railway: railway({ tunnel: "cut_and_cover" }),
      view: railView(),
      reports: { M1: REPORT },
      streetLines: [],
      prefs: {},
      prices: UNIT,
    });
    expect(e.items.some((x) => x.category === "cut_and_cover")).toBe(true);
    expect(e.items.some((x) => x.category === "tbm")).toBe(false);
  });

  it("sizes the fleet, depot and service of a rail line", () => {
    const e = rail();
    const line = e.lines.find((l) => l.id === "rail:M1")!;
    expect(line.inService).toBe(4);
    expect(line.lengthKm).toBeGreaterThan(1.9);
    const days = libraryValue("cost.days_per_year", "*")[1];
    expect(line.hoursPerYear).toBeCloseTo(((200 * 240) / 3600) * days);
    const veh = e.items.find((x) => x.category === "vehicles")!;
    const spare = libraryValue("mode.spare_share", "metro")[1];
    expect(veh.quantity).toBe(Math.ceil(4 * (1 + spare)));
    expect(veh.rate[1]).toBeCloseTo(libraryValue("cost.vehicle_per_train_m", "metro")[1] * 1e6 * 116.2);
    const carKm = e.items.find((x) => x.param === "cost.opex.car_km")!;
    expect(carKm.quantity).toBeCloseTo(line.kmPerYear * (116.2 / CAR_M));
    expect(e.items.some((x) => x.category === "engineering")).toBe(true);
    expect(e.items.some((x) => x.category === "overheads")).toBe(true);
  });

  it("converts to the country's currency: PPP for construction, the exchange rate for vehicles", () => {
    const base = rail();
    const local = estimate({
      railway: railway(),
      view: railView(),
      reports: { M1: REPORT },
      streetLines: [],
      prefs: {},
      prices: pricesFrom(ECON, {}),
    });
    const tbm = (e: typeof base) => e.items.find((x) => x.category === "tbm")!.amount[1];
    const veh = (e: typeof base) => e.items.find((x) => x.category === "vehicles")!.amount[1];
    expect(tbm(local) / tbm(base)).toBeCloseTo(0.8 * 1.1);
    expect(veh(local) / veh(base)).toBeCloseTo(0.92 * 1.1);
  });

  it("costs a street line: stops, bus lanes, trolley wires, vehicles and service", () => {
    const e = estimate({
      railway: null,
      view: null,
      reports: {},
      streetLines: STREET.lines,
      prefs: {},
      prices: UNIT,
    });
    expect(e.modes).toEqual(["trolleybus"]);
    const line = e.lines[0]!;
    expect(line).toMatchObject({ name: "Route 7", lengthKm: 3 });
    // Cycle: 25 min running + 3 × 20 s dwell + 2 × 5 min layover = 36 min; every 10 min → 4 vehicles.
    expect(line.inService).toBe(4);
    const wires = e.items.find((x) => x.label === "Trolley wires")!;
    expect(wires.quantity).toBe(3);
    const lanes = e.items.find((x) => x.category === "street_works" && x.unit === "lane-km")!;
    expect(lanes.quantity).toBe(2);
    expect(e.items.filter((x) => x.category === "stations")[0]!.quantity).toBe(3);
    const totals = perLine(e).get("street:0")!;
    expect(totals.construction[1]).toBeGreaterThan(0);
    expect(totals.operating[1]).toBeGreaterThan(0);
  });

  it("splits shared infrastructure between rail lines by train-km, and keeps unused track apart", () => {
    const e = rail();
    const t = perLine(e);
    const all = sum(
      e.items
        .filter((x) => x.mode === "metro" && !["service", "maintenance", "overheads"].includes(x.category))
        .map((x) => x.amount),
    );
    expect(t.get("rail:M1")!.construction[1]).toBeCloseTo(all[1]);
    const noLines = estimate({
      railway: { ...railway(), lines: [] },
      view: railView(),
      reports: {},
      streetLines: [],
      prefs: {},
      prices: UNIT,
    });
    expect(perLine(noLines).has(":metro")).toBe(true);
    expect(noLines.notes.join(" ")).toContain("no service lines");
  });
});

function fakeApi(): EconomyApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    countryAt: async (at) => {
      calls.push(`at ${at.join(",")}`);
      return { iso3: "NLD", iso2: "NL", name: "Nederland" };
    },
    countries: async () => [
      { iso3: "DEU", iso2: "DE", name: "Germany" },
      { iso3: "NLD", iso2: "NL", name: "Netherlands" },
    ],
    indicators: async (code) => {
      calls.push(`ind ${code}`);
      return code === "DEU"
        ? { ...ECON, country: { iso3: "DEU", iso2: "DE", name: "Germany" }, ppp: { year: 2024, value: 0.73 } }
        : ECON;
    },
  };
}

const loadRail = async () =>
  ({
    build: () => railView(),
    publishLines: () => ({ timetable: {}, lines: [REPORT], notes: [] }),
    dispose: () => {},
  }) as unknown as RailEngine;

describe("cost tables", () => {
  it("shows the totals per mode and per line in the country's currency, and saves edits to the project", async () => {
    const api = fakeApi();
    const onPreferences = vi.fn();
    const onCosts = vi.fn();
    render(
      <CostTables
        railway={railway()}
        streetLines={STREET}
        preferences={{ values: {} }}
        onPreferences={onPreferences}
        costs={null}
        onCosts={onCosts}
        loadRail={loadRail}
        api={api}
      />,
    );
    const byMode = await screen.findByRole("region", { name: "Per mode" });
    await waitFor(() => expect(within(byMode).getByText("Metro")).toBeTruthy());
    expect(within(byMode).getByText("Trolleybus")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/€/).length).toBeGreaterThan(3));
    expect(api.calls).toContain("ind NLD");
    const byLine = screen.getByRole("region", { name: "Per line" });
    expect(within(byLine).getByText("M1")).toBeTruthy();
    expect(within(byLine).getByText("Route 7")).toBeTruthy();
    const build = screen.getByRole("region", { name: "Construction by infrastructure type" });
    expect(within(build).getByText("Tunnel, bored (TBM)")).toBeTruthy();
    expect(within(build).getByText("Ramp between levels")).toBeTruthy();

    // US$ at the market rate.
    fireEvent.click(screen.getByRole("tab", { name: "US$" }));
    await waitFor(() => expect(screen.getAllByText(/\$/).length).toBeGreaterThan(3));

    // A project's own unit cost.
    const field = screen.getByRole("textbox", { name: /Bored tunnel \(TBM\), double track, Metro/ });
    fireEvent.change(field, { target: { value: "120" } });
    fireEvent.blur(field);
    expect(onPreferences).toHaveBeenCalledWith({ values: { "cost.civil.tbm_per_km.metro": 120 } });

    // Another country.
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "DEU" } });
    expect(onCosts).toHaveBeenCalledWith({ country: "DEU" });
  });

  it("draws the charts, sorts lines and opens and closes groups", async () => {
    render(
      <CostTables
        railway={railway()}
        streetLines={STREET}
        preferences={{ values: {} }}
        costs={null}
        loadRail={loadRail}
        api={fakeApi()}
      />,
    );
    const chart = await screen.findByRole("figure", { name: "Construction cost by mode and cost group" });
    await waitFor(() => expect(within(chart).getAllByRole("img").length).toBeGreaterThan(3));
    fireEvent.focus(within(chart).getAllByRole("img")[0]!);
    expect(screen.getByRole("tooltip").textContent).toContain("Track and structures");
    expect(screen.getByRole("figure", { name: "Construction cost by infrastructure type" })).toBeTruthy();

    // Sort lines by name: A–Z, then Z–A.
    const byLine = screen.getByRole("region", { name: "Per line" });
    const names = () =>
      within(byLine)
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.querySelector("td")!.textContent);
    fireEvent.click(within(byLine).getByRole("button", { name: /^Line/ }));
    expect(names()).toEqual(["M1", "Route 7"]);
    fireEvent.click(within(byLine).getByRole("button", { name: /^Line/ }));
    expect(names()).toEqual(["Route 7", "M1"]);

    // Item lists start closed; a group opens on its own and with "Expand all"; a mode closes.
    const build = screen.getByRole("region", { name: "Construction by infrastructure type" });
    expect(within(build).queryByText("Main, double track")).toBeNull();
    fireEvent.click(within(build).getByRole("button", { name: /Tunnel, bored \(TBM\)/ }));
    expect(within(build).getByText("Main, double track")).toBeTruthy();
    fireEvent.click(within(build).getByRole("button", { name: "Expand all" }));
    expect(within(build).getAllByText("Main, double track").length).toBeGreaterThan(1);
    fireEvent.click(within(build).getByRole("button", { name: "Collapse all" }));
    expect(within(build).queryByText("Main, double track")).toBeNull();
    fireEvent.click(within(build).getByRole("button", { name: /^Metro/ }));
    expect(within(build).queryByRole("button", { name: /Tunnel, bored/ })).toBeNull();
    fireEvent.click(within(build).getByRole("button", { name: "Largest first" }));
    expect(within(build).getByRole("button", { name: "Largest first" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("says when there is nothing to cost", async () => {
    render(
      <CostTables
        railway={null}
        streetLines={null}
        preferences={null}
        costs={null}
        loadRail={loadRail}
        api={fakeApi()}
      />,
    );
    expect(await screen.findByText(/Nothing to cost yet/)).toBeTruthy();
  });
});

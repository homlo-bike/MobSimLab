import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("maplibre-gl", () => ({
  Marker: class {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    on() {
      return this;
    }
    getLngLat() {
      return { lng: 0, lat: 0 };
    }
    remove() {}
  },
}));

import { CargoBikeTab } from "../src/features/cargo-bike/CargoBikeTab";
import type { CargoBikeEngine } from "../src/features/cargo-bike/engine";
import { TripError } from "../src/features/cargo-bike/engine";
import { rangePolygon } from "../src/features/cargo-bike/mapLayer";
import {
  amenitiesAlong,
  type BikeAmenity,
  conversionFrom,
  corridorTiles,
  destinationPoint,
  distanceM,
  type Kit,
  type Leg,
  type LonLat,
  MAX_TILES,
  type ParamDefault,
  rayEnds,
  type Route,
  routeTiles,
  type Savings,
  thin,
  tileOf,
  type Trip,
} from "../src/features/cargo-bike/model";
import type { CountryEconomy, EconomyApi } from "../src/features/costs/economy";
import { pluginTabs } from "../src/plugins/registry";
import { parseRoute, TABS } from "../src/shell/route";

const KOBLENZ: LonLat = [7.6, 50.36];

describe("cargo bike model", () => {
  it("finds tiles, distances and bearings", () => {
    expect(tileOf([0, 0])).toEqual([8192, 8192]);
    const p = destinationPoint(KOBLENZ, 90, 10_000);
    expect(distanceM(KOBLENZ, p)).toBeCloseTo(10_000, -1);
    const ends = rayEnds(KOBLENZ, 5000, 24);
    expect(ends).toHaveLength(24);
    expect(ends[6]!.bearing).toBe(90);
    for (const e of ends) expect(distanceM(KOBLENZ, e.end)).toBeCloseTo(5000, -1);
  });

  it("loads a corridor of tiles round the straight line, and too many for a far destination", () => {
    const near = corridorTiles(KOBLENZ, destinationPoint(KOBLENZ, 45, 5000));
    expect(near.length).toBeGreaterThan(1);
    expect(near.length).toBeLessThan(MAX_TILES);
    expect(new Set(near.map((t) => t.join("/"))).size).toBe(near.length);
    expect(near).toContainEqual(tileOf(KOBLENZ));
    expect(corridorTiles(KOBLENZ, destinationPoint(KOBLENZ, 45, 120_000)).length).toBeGreaterThan(MAX_TILES);
  });

  it("thins a line and keeps both ends", () => {
    const line: LonLat[] = Array.from({ length: 101 }, (_, i) => [i, 0]);
    const out = thin(line, 10);
    expect(out.length).toBeLessThanOrEqual(11);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([100, 0]);
    expect(thin(line, 500)).toBe(line);
  });

  it("converts German prices by exchange rate and by price level", () => {
    const econ = (fx: number, ppp: number) => ({ fx: { value: fx }, ppp: { value: ppp } }) as CountryEconomy;
    const c = conversionFrom(econ(100, 40), econ(0.9, 0.7));
    expect(c!.fx).toBeCloseTo(100 / 0.9);
    expect(c!.ppp).toBeCloseTo(40 / 0.7);
    expect(conversionFrom(null, econ(0.9, 0.7))).toBeNull();
  });

  it("finds the parkings near a route in order along it, and the tiles round it", () => {
    const line: LonLat[] = [KOBLENZ, destinationPoint(KOBLENZ, 90, 2000)];
    const at = (d: number, off: number) => destinationPoint(destinationPoint(KOBLENZ, 90, d), 0, off);
    const a = (id: string, p: LonLat): BikeAmenity => ({ id, kind: "charging", lonlat: p });
    const near = amenitiesAlong(line, [
      a("far", at(500, 400)),
      a("b", at(1500, 50)),
      a("a", at(300, -20)),
      a("a", at(300, -20)),
    ]);
    expect(near.map((n) => n.amenity.id)).toEqual(["a", "b"]);
    expect(near[0]!.alongM).toBeCloseTo(300, -1);
    expect(near[1]!.offM).toBeCloseTo(50, 0);
    const tiles = routeTiles(line);
    expect(tiles).toContainEqual(tileOf(KOBLENZ));
    expect(new Set(tiles.map((t) => t.join("/"))).size).toBe(tiles.length);
  });

  it("closes the range polygon in bearing order", () => {
    const reach = [180, 0, 90, 270].map((b) => ({
      bearing_deg: b,
      straight_m: 1,
      street_m: 1,
      at: [b, 0] as LonLat,
      beyond: false,
    }));
    const ring = (rangePolygon(reach).geometry.coordinates as LonLat[][])[0]!;
    expect(ring.map((p) => p[0])).toEqual([0, 90, 180, 270, 0]);
  });
});

describe("cargo bike tab in the shell", () => {
  it("is a plugin tab with its own route", () => {
    expect(pluginTabs().map((t) => t.id)).toEqual(["cargo-bike"]);
    expect(TABS).toContain("cargo-bike");
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseRoute(`/projects/${id}/cargo-bike`)).toMatchObject({ page: "project", tab: "cargo-bike" });
  });
});

const DEFAULTS_FILE = JSON.parse(
  readFileSync(resolve(__dirname, "../../../crates/cargo-bike/data/defaults.json"), "utf8"),
) as { params: Record<string, ParamDefault>; default_kit: string; kits: Kit[] };
const DEFAULTS = DEFAULTS_FILE.params;

function leg(m: number, wh: number): Leg {
  return {
    distance_m: m,
    climb_m: 40,
    descent_m: 40,
    battery_wh: wh,
    rider_wh: wh / 2,
    time_s: m / 5,
    class_m: [m / 2, m / 4, m / 4, 0],
    stops: 3,
    steep_m: 0,
    max_grade_pct: 4,
    profile: [
      [0, 100, 0],
      [m, 120, wh],
    ],
  };
}

const TRIP: Trip = {
  go: leg(6000, 50),
  back: leg(6000, 40),
  distance_m: 12_000,
  battery_wh: 90,
  usable_wh: 810,
  battery_share: 90 / 810,
  remaining_wh: 720,
  feasible: true,
  wh_per_km: 7.5,
  range_km: 108,
  time_s: 2400,
  rider_wh: 45,
};

const SAVINGS: Savings = {
  km_per_year: 2760,
  lines: [
    { id: "purchase", car: 1750, bike: 500, saving: 1250 },
    { id: "parking", car: 400, bike: 0, saving: 400 },
  ],
  car_total: 2150,
  bike_total: 500,
  saving_total: 1650,
  saving_lifetime: 13_200,
  payback_years: 2.4,
  fuel_l_per_year: 179,
  electricity_kwh_per_year: 24,
  impact: {
    car_co2_kg: 477,
    bike_co2_kg: 8,
    co2_saved_kg: 469,
    kcal_per_trip: 176,
    kcal_per_year: 40_480,
    active_min_per_week: 200,
    active_share: 200 / 150,
  },
  values: {
    "savings.bike_lifetime_years": 8,
    "savings.bike_price_eur": 4000,
    "savings.active_min_week_target": 150,
  },
};

const TRIP_ROUTE: LonLat[] = [KOBLENZ, [7.605, 50.365], [7.61, 50.37]];

function setup(over: Partial<CargoBikeEngine> = {}) {
  const route: Route = {
    coords: [KOBLENZ, [7.605, 50.365], [7.61, 50.37]],
    classes: ["lane", "mixed"],
    length_m: 6000,
    signals: 1,
    stop_signs: 0,
    gaps: [{ from: 1, to: 2, length_m: 660, name: "Hauptstraße", highway: "primary" }],
  };
  const parking: BikeAmenity = {
    id: "w2",
    kind: "secure_parking",
    lonlat: [7.6051, 50.365],
    name: "Radstation",
    capacity: "40",
    fee: "yes",
  };
  const engine: CargoBikeEngine = {
    defaults: vi.fn(async () => DEFAULTS),
    kits: vi.fn(async () => ({ default: DEFAULTS_FILE.default_kit, kits: DEFAULTS_FILE.kits })),
    trip: vi.fn(async () => ({ trip: TRIP, go: route, back: route, snapM: [5, 5] as [number, number] })),
    rangeMap: vi.fn(async () => ({ reach: [] })),
    savings: vi.fn(async () => SAVINGS),
    amenities: vi.fn(async () => [{ amenity: parking, offM: 7, alongM: 650 }]),
    ...over,
  };
  const economy: EconomyApi = {
    countryAt: vi.fn(async () => ({ iso3: "DEU", iso2: "DE", name: "Germany" })),
    countries: vi.fn(async () => []),
    indicators: vi.fn(async () => ({ fx: { value: 0.92 }, ppp: { value: 0.74 } }) as CountryEconomy),
  };
  const onDoc = vi.fn();
  render(
    <CargoBikeTab
      map={null}
      panel={null}
      doc={{ start: KOBLENZ, destination: [7.65, 50.38] }}
      onDoc={onDoc}
      setups={[]}
      engine={engine}
      economy={economy}
    />,
  );
  return { engine, economy, onDoc };
}

describe("cargo bike tab", () => {
  it("rides the round trip and shows whether it fits in one charge", async () => {
    const { engine } = setup();
    await screen.findByRole("combobox", { name: /Kit/ });
    fireEvent.click(screen.getByRole("button", { name: "Calculate the trip there and back" }));
    const result = await screen.findByRole("region", { name: /trip/i });
    expect(within(result).getByText(/Fits in one charge/)).toBeTruthy();
    expect(within(result).getByText("12.0 km")).toBeTruthy();
    expect(engine.trip).toHaveBeenCalledWith(
      KOBLENZ,
      [7.65, 50.38],
      { bike_mass_kg: 35, battery_wh: 900, "savings.bike_price_eur": 4000 },
      [],
      expect.any(Function),
    );
  });

  it("explains a destination that is too far", async () => {
    setup({ trip: vi.fn(async () => Promise.reject(new TripError("too_far"))) });
    fireEvent.click(screen.getByRole("button", { name: "Calculate the trip there and back" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/far/i);
  });

  it("keeps the project's own battery size and uses it for the trip", async () => {
    const { engine, onDoc } = setup();
    const field = await screen.findByLabelText("Battery capacity");
    fireEvent.change(field, { target: { value: "1200" } });
    fireEvent.blur(field);
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ values: { battery_wh: 1200 } }));
    fireEvent.click(screen.getByRole("button", { name: "Calculate the trip there and back" }));
    await waitFor(() =>
      expect(engine.trip).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ battery_wh: 1200, bike_mass_kg: 35 }),
        [],
        expect.any(Function),
      ),
    );
  });

  it("shows the savings in the start point's country", async () => {
    const { engine, economy } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Calculate the trip there and back" }));
    await screen.findByRole("region", { name: /trip/i });
    fireEvent.click(screen.getByRole("tab", { name: "Savings" }));
    const section = await screen.findByRole("region", { name: "Savings against a car" });
    expect(economy.countryAt).toHaveBeenCalledWith(KOBLENZ);
    expect(engine.savings).toHaveBeenCalledWith(
      { km: 12, whPerKm: 7.5, riderWh: 45, timeS: 2400 },
      { bike_mass_kg: 35, battery_wh: 900, "savings.bike_price_eur": 4000 },
      expect.objectContaining({ fx: 1, ppp: 1 }),
    );
    expect(within(section).getByText(/saves .*1,650/)).toBeTruthy();
    expect(within(section).getByText("Parking")).toBeTruthy();
    const impact = within(section).getByRole("region", { name: "Climate and health" });
    expect(within(impact).getByText("469 kg less CO₂ a year than by car.")).toBeTruthy();
    expect(within(impact).getByText("176 kcal")).toBeTruthy();
    expect(within(impact).getByText(/133 % of the 150 minutes/)).toBeTruthy();
  });

  it("lists the bike-lane gaps and the secure parkings along the trip", async () => {
    const { engine } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Calculate the trip there and back" }));
    const gaps = await screen.findByRole("region", { name: "Bike lane gaps" });
    // One gap on the way there and one back, both on the Hauptstraße.
    expect(within(gaps).getAllByRole("button", { name: /Hauptstraße/ })).toHaveLength(2);
    const near = await screen.findByRole("region", { name: "Charging and secure parking" });
    expect(await within(near).findByText(/Secure bike parking · Radstation/)).toBeTruthy();
    expect(within(near).getByText(/0.7 km into the trip, 7 m off the route · 40 places · fee/)).toBeTruthy();
    expect(engine.amenities).toHaveBeenCalledWith([...TRIP_ROUTE, ...TRIP_ROUTE]);
  });

  it("sets the range and the price together from a kit preset, with the project's own values on top", async () => {
    const { engine, onDoc } = setup();
    const kit = await screen.findByRole("combobox", { name: /Kit/ });
    expect((kit as HTMLSelectElement).value).toBe("trike-900");
    expect(screen.getByText(/900 Wh battery · 35 kg · €4,000/)).toBeTruthy();
    fireEvent.change(kit, { target: { value: "trike-1800" } });
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ kit: "trike-1800", values: {} }));
    expect(screen.getByText(/1800 Wh battery · 40 kg · €4,700/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Calculate the trip there and back" }));
    await waitFor(() =>
      expect(engine.trip).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        { bike_mass_kg: 40, battery_wh: 1800, "savings.bike_price_eur": 4700 },
        [],
        expect.any(Function),
      ),
    );
  });
});

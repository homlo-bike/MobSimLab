import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Estimate as BenefitEstimate } from "../src/features/benefits/model";
import { FareTables } from "../src/features/fares/FareTables";
import {
  type FareInput,
  fareDraw,
  fareEstimate,
  fareValue,
  inside,
  libraryValue,
  lineTrips,
  tripFare,
} from "../src/features/fares/model";
import type { SchematicArea } from "../src/features/schematic/common";
import { defaultOrigin, project } from "../src/features/schematic/layout";
import { schematicNetwork } from "../src/features/schematic/lines";
import { RAILWAY, STREET_LINES } from "./fixtures/schematic";

afterEach(cleanup);

const net = schematicNetwork(RAILWAY, STREET_LINES);
const origin = defaultOrigin(net);
// Geographic positions (the network map moves stations; the tests only need a consistent plane).
const pos = net.stations.map((s) => project(origin, s.lonlat));
const at = (name: string) => pos[net.stations.findIndex((s) => s.name === name)]!;
const box = (x0: number, x1: number): SchematicArea["points"] => [
  [x0, -10_000],
  [x1, -10_000],
  [x1, 10_000],
  [x0, 10_000],
];
// Zone A west of the centre, zone B east of it.
const midX = at("Centraal")[0];
const ZONES: SchematicArea[] = [
  { id: "a", name: "A", kind: "zone", color: "#ff0000", points: box(-10_000, midX - 100) },
  { id: "b", name: "B", kind: "zone", color: "#00ff00", points: box(midX - 100, 10_000) },
  { id: "old", name: "Old town", kind: "landmark", color: "#0000ff", points: box(-10_000, 10_000) },
];

/** Random numbers that give every value's central value (the triangular CDF at its mode). */
const centralOf =
  (own: Record<string, number> | undefined) =>
  (name: string): number => {
    if (name === "ridership") return 0.5;
    const t = fareValue(name.split("|")[0]!, own);
    return t[2] > t[0] ? (t[1] - t[0]) / (t[2] - t[0]) : 0.5;
  };

/** Every share that would change the fare paid set to 0, so the fare paid is the single fare. */
const PLAIN: Record<string, number> = {
  "fare.pass.trip_share": 0,
  "fare.concession.child.share": 0,
  "fare.concession.senior.share": 0,
  "fare.concession.student.share": 0,
  "fare.evasion_share": 0,
  "fare.collection_cost_share": 0,
  "fare.ridership_growth": 0,
  "fare.real_increase": 0,
};

const line = (id: string, annual: number, mode = "metro") => ({
  id,
  name: id,
  mode,
  color: "#123456",
  annual: [annual, annual, annual] as [number, number, number],
});

describe("fare parameters", () => {
  it("replaces the central value with the project's own and moves low and high with it", () => {
    const lib = libraryValue("fare.flat");
    expect(fareValue("fare.flat", undefined)).toEqual(lib);
    const own = fareValue("fare.flat", { "fare.flat": lib[1] * 2 });
    expect(own[1]).toBe(lib[1] * 2);
    expect(own[0]).toBeCloseTo(lib[0] * 2);
    expect(own[2]).toBeCloseTo(lib[2] * 2);
    // A cap of 0 (no cap) in the library: the own value is all three.
    expect(fareValue("fare.distance.max", { "fare.distance.max": 6 })).toEqual([6, 6, 6]);
    // Negative values keep low below high.
    const e = fareValue("fare.elasticity", { "fare.elasticity": -0.8 });
    expect(e[0]).toBeLessThanOrEqual(e[1]);
    expect(e[1]).toBeLessThanOrEqual(e[2]);
  });
});

describe("trips of a line", () => {
  it("spreads trips between every pair of stops, by the boardings at both ends", () => {
    const trips = lineTrips(net, pos, [], {}, undefined).get("rail:M1")!;
    // Five stops: ten pairs, equal without boardings, each in one zone without tariff zones.
    expect(trips.pairs).toHaveLength(10);
    expect(trips.pairs.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1);
    expect(trips.pairs.every((p) => p.zones === 1)).toBe(true);
    const lengthKm = net.lines.find((l) => l.id === "rail:M1")!.distM.reduce((a, b) => a + b, 0) / 1000;
    expect(Math.max(...trips.pairs.map((p) => p.km))).toBeCloseTo(lengthKm);
    // Boardings weight the pairs: a busy Westpark makes trips from it the most common.
    const busy = lineTrips(net, pos, [], { "rail:M1": { Westpark: 100, Museumplein: 1 } }, { Centraal: 50 });
    const m1 = busy.get("rail:M1")!;
    const top = [...m1.pairs].sort((a, b) => b.share - a.share)[0]!;
    // Westpark–Centraal (100 × 50) is the most common trip; the stops without boardings get no trips.
    expect(top.share).toBeCloseTo((100 * 50) / (100 * 1 + 100 * 50 + 1 * 50));
    expect(m1.pairs).toHaveLength(3);
  });

  it("counts the tariff zones a trip passes through, ignoring landmarks", () => {
    expect(inside([0, 0], box(-1, 1))).toBe(true);
    expect(inside([2, 0], box(-1, 1))).toBe(false);
    const trips = lineTrips(net, pos, ZONES, {}, undefined).get("rail:M1")!;
    // Westpark and Museumplein are in A; Centraal, Oosterdok and Amstel Oost in B.
    expect(trips.pairs.map((p) => p.zones)).toEqual([1, 2, 2, 2, 2, 2, 2, 1, 1, 1]);
    expect(trips.avgZones).toBeCloseTo(1.6);
  });
});

describe("fares", () => {
  const levels = { flat: 3, first: 2, extra: 1.5, base: 1, perKm: 0.2, max: 0 };
  it("prices a trip by the structure", () => {
    expect(tripFare("flat", levels, 12, 3)).toBe(3);
    expect(tripFare("zonal", levels, 12, 3)).toBe(5);
    expect(tripFare("distance", levels, 12, 3)).toBeCloseTo(3.4);
    expect(tripFare("distance", { ...levels, max: 3 }, 12, 3)).toBe(3);
  });
});

describe("fare revenue", () => {
  const trips = lineTrips(net, pos, ZONES, {}, undefined);
  const base: FareInput = {
    structure: "flat",
    own: PLAIN,
    perIntl: 2,
    lines: [line("rail:M1", 1000)],
    trips,
  };

  it("is boardings times the fare when nothing else changes it", () => {
    const d = fareDraw(base, 2, centralOf(PLAIN));
    const flat = libraryValue("fare.flat")[1] * 2;
    expect(d.fares["rail:M1"]).toEqual({ single: flat, paid: flat });
    expect(d.lines["rail:M1"]![0]).toEqual({
      riders: 1000,
      gross: 1000 * flat,
      collection: 0,
      net: 1000 * flat,
    });
    expect(d.lines["rail:M1"]![1]!.net).toBeCloseTo(1000 * flat);
  });

  it("takes passes, discounts, evasion and collection costs off", () => {
    const own = {
      ...PLAIN,
      "fare.pass.trip_share": 0.5,
      "fare.pass.price_in_fares": 30,
      "fare.pass.trips_per_month": 40,
      "fare.concession.child.share": 0.1,
      "fare.concession.child.discount": 0.5,
      "fare.evasion_share": 0.04,
      "fare.collection_cost_share": 0.1,
      // The same fare paid as the defaults: no elasticity effect.
      "fare.elasticity": 0,
    };
    const d = fareDraw({ ...base, own }, 1, centralOf(own));
    const flat = libraryValue("fare.flat")[1] * 2;
    const paid = flat * (0.5 + (0.5 * 30) / 40) * (1 - 0.1 * 0.5);
    expect(d.fares["rail:M1"]!.paid).toBeCloseTo(paid);
    const y = d.lines["rail:M1"]![0]!;
    expect(y.gross).toBeCloseTo(1000 * 0.96 * paid);
    expect(y.collection).toBeCloseTo(y.gross * 0.1);
    expect(y.net).toBeCloseTo(y.gross * 0.9);
  });

  it("lowers ridership when the fare is above the default, through the elasticity", () => {
    const flat = libraryValue("fare.flat")[1];
    const own = { ...PLAIN, "fare.flat": flat * 2, "fare.elasticity": -0.4 };
    const d = fareDraw({ ...base, own }, 1, centralOf(own));
    expect(d.lines["rail:M1"]![0]!.riders).toBeCloseTo(1000 * 2 ** -0.4);
  });

  it("grows ridership and fares year by year, with the elasticity on the fare change", () => {
    const own = {
      ...PLAIN,
      "fare.ridership_growth": 0.02,
      "fare.real_increase": 0.01,
      "fare.elasticity": -0.4,
    };
    const d = fareDraw({ ...base, own }, 3, centralOf(own));
    const ys = d.lines["rail:M1"]!;
    expect(ys[2]!.riders / ys[1]!.riders).toBeCloseTo(1.02 * 1.01 ** -0.4);
    expect(ys[1]!.gross / ys[1]!.riders).toBeCloseTo((ys[0]!.gross / ys[0]!.riders) * 1.01);
  });

  it("charges zonal and distance fares by the trips' zones and length", () => {
    const own = { ...PLAIN, "fare.zonal.first_zone": 1, "fare.zonal.extra_zone": 0.5, "fare.elasticity": 0 };
    const z = fareDraw({ ...base, structure: "zonal", own }, 1, centralOf(own));
    // 1.6 zones on average: 1 + 0.6 × 0.5 international dollars, times 2.
    expect(z.fares["rail:M1"]!.single).toBeCloseTo((1 + 0.6 * 0.5) * 2);
    const own2 = { ...PLAIN, "fare.distance.base": 1, "fare.distance.per_km": 0.1, "fare.elasticity": 0 };
    const dist = fareDraw({ ...base, structure: "distance", own: own2 }, 1, centralOf(own2));
    expect(dist.fares["rail:M1"]!.single).toBeCloseTo((1 + 0.1 * trips.get("rail:M1")!.avgKm) * 2);
  });

  it("gives low, medium and high per line, per mode and in total, and year by year", () => {
    const est = fareEstimate(
      {
        ...base,
        own: undefined,
        lines: [line("rail:M1", 1000), line("rail:M2", 2000), line("street:0", 500, "bus")],
      },
      30,
      60,
    );
    expect(est.rows.map((r) => r.id)).toEqual([
      "rail:M1",
      "rail:M2",
      "street:0",
      "mode:metro",
      "mode:bus",
      "total",
    ]);
    for (const r of est.rows) {
      expect(r.net[0]).toBeLessThanOrEqual(r.net[1]);
      expect(r.net[1]).toBeLessThanOrEqual(r.net[2]);
      expect(r.net[1]).toBeGreaterThan(0);
      expect(r.collection[1]).toBeGreaterThan(0);
    }
    const total = est.rows.at(-1)!;
    expect(total.estimate).toEqual([3500, 3500, 3500]);
    expect(est.years).toHaveLength(30);
    expect(est.years[0]!.net[1]).toBeCloseTo(total.net[1]);
    // The same seed gives the same numbers.
    expect(fareEstimate({ ...base, own: undefined }, 5, 40).years).toEqual(
      fareEstimate({ ...base, own: undefined }, 5, 40).years,
    );
  });
});

describe("fare revenue table", () => {
  const benefits = {
    rows: [
      {
        id: "rail:M1",
        scope: "line",
        name: "M1",
        mode: "metro",
        color: "#1d4ed8",
        values: { ridership_daily: [3000, 4000, 5000], ridership_annual: [900_000, 1_200_000, 1_500_000] },
      },
      {
        id: "total",
        scope: "total",
        name: "All lines",
        mode: null,
        color: "#0f172a",
        values: { ridership_daily: [3000, 4000, 5000], ridership_annual: [900_000, 1_200_000, 1_500_000] },
      },
    ],
    notes: [],
    draws: 40,
    stations: { "rail:M1": { Westpark: 800, Centraal: 2000 } },
  } as unknown as BenefitEstimate;

  it("waits for the ridership estimate and the prices", () => {
    render(
      <FareTables
        benefits={null}
        railway={RAILWAY}
        streetLines={STREET_LINES}
        pluginLines={[]}
        schematic={null}
        boardings={undefined}
        prices={null}
        doc={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "Fare revenue" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/ridership estimate/);
  });

  it("shows the revenue per line and year, and saves the structure and fares in international dollars", () => {
    const onDoc = vi.fn();
    render(
      <FareTables
        benefits={benefits}
        railway={RAILWAY}
        streetLines={STREET_LINES}
        pluginLines={[]}
        schematic={{ pins: {}, labels: {}, areas: [] }}
        boardings={undefined}
        prices={{ currency: "EUR", perIntl: 0.8 }}
        doc={{ structure: "zonal" }}
        onDoc={onDoc}
        draws={40}
      />,
    );
    expect(screen.getByText("Fare revenue, first year")).toBeTruthy();
    expect(screen.getAllByText("M1").length).toBeGreaterThan(0);
    expect(screen.getByText(/No tariff zones yet/)).toBeTruthy();
    const years = screen.getByRole("heading", { name: "Year by year, all lines" }).closest("section")!;
    expect(within(years).getAllByRole("row")).toHaveLength(11);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "distance" } });
    expect(onDoc).toHaveBeenLastCalledWith({ structure: "distance" });

    const first = screen.getByRole("spinbutton", { name: /Zonal fare: fare for a trip within one zone/ });
    fireEvent.change(first, { target: { value: "2.4" } });
    fireEvent.blur(first);
    expect(onDoc).toHaveBeenLastCalledWith({
      structure: "zonal",
      values: { "fare.zonal.first_zone": expect.closeTo(3, 9) },
    });
  });
});

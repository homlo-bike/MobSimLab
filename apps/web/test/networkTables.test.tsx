import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { estimate } from "../src/features/costs/model";
import { BASE_PRICES } from "../src/features/costs/economy";
import { libraryValue } from "../src/features/costs/params";
import type { LineReport, Network, RailEngine, RailView, TrackView } from "../src/features/railways/types";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import type { LineView } from "../src/features/street-lines/types";
import { lineFacts } from "../src/features/tables/lineFacts";
import { NetworkTables } from "../src/features/tables/NetworkTables";
import { quantities } from "../src/features/tables/quantities";

afterEach(cleanup);

const METRO_TRAIN = "alstom_metropolis-amsterdam-m5-6-car"; // 116.2 m, 960 places

function station(id: number, x: number, level: Network["stations"][number]["level"]) {
  return {
    id,
    name: `S${id}`,
    x,
    y: 0,
    rotation_deg: 0,
    level,
    side_platforms: 2,
    island_platforms: 0,
    platform_length_m: 120,
  };
}

/** A metro line of 2 km: street level, a ramp, then deep underground; and a single-track viaduct spur. */
function railway(): Network {
  return {
    origin: [4.9, 52.37],
    mode: "metro",
    stations: [station(1, 0, "street"), station(2, 2000, "underground2"), station(3, 3000, "elevated")],
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
      },
      {
        id: 11,
        name: "Spur",
        start: { type: "station", station: 2, end: 1, tracks: [0] },
        end: { type: "station", station: 3, end: 0, tracks: [0] },
        points: [],
        tracks: 1,
        level: "elevated",
        structure: "viaduct",
        power: "auto",
        use: "running",
        bed: "auto",
        lead_start_m: 30,
        lead_end_m: 30,
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
        units: 2,
        first_min: 300,
        last_min: 1440,
        peak_headway_min: 5,
        offpeak_headway_min: 10,
      },
    ],
  };
}

function railView(): RailView {
  const main = {
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
    elevation: { rail_min_m: 0, rail_max_m: 10, steepest_permille: -38, max_permille: 40, profile: [] },
  } as unknown as TrackView;
  const spur = {
    id: 11,
    length_m: 1000,
    tracks: 1,
    mode: "metro",
    levels: [],
    centre: [],
    elevation: { rail_min_m: 0, rail_max_m: 10, steepest_permille: 12, max_permille: 40, profile: [] },
  } as unknown as TrackView;
  return {
    tracks: [main, spur],
    stations: [
      { id: 1, lonlat: [4.9, 52.37], mode: "metro", platform_edges: 2 },
      { id: 2, lonlat: [4.929, 52.37], mode: "metro", platform_edges: 2 },
      { id: 3, lonlat: [4.944, 52.37], mode: "metro", platform_edges: 1 },
    ],
    switches: [{ id: 1, track: 10 }],
    level_crossings: [
      { id: "a", track: 10, mode: "metro", path: null },
      { id: "b", track: 10, mode: "metro", path: "foot" },
    ],
    street_running: [{ id: "r", track: 10, running: "reserved", length_m: 500 }],
    signals: [
      { id: 1, lineside: true, at: { type: "track", track: 10, line: 0, s: 10 } },
      { id: 2, lineside: false, at: { type: "track", track: 10, line: 0, s: 20 } },
    ],
  } as unknown as RailView;
}

const REPORT: LineReport = { id: "M1", trips: 200, outbound_s: 240, return_s: 240, trains: 4, issues: [] };

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
    mixed_traffic_m: 3000,
    level_crossings: [{}],
  } as unknown as LineView;
}

const STREET: StreetLinesDoc = {
  lines: [
    {
      name: "Route 7",
      profile: {
        mode: "brt",
        height_m: 3.4,
        weight_t: 19,
        length_m: 18,
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

describe("line facts", () => {
  const facts = () =>
    lineFacts({
      railway: railway(),
      view: railView(),
      reports: { M1: REPORT },
      streetLines: STREET.lines,
      prefs: {},
    });

  it("gives a rail line's length, stops, speed, service, fleet and capacity", () => {
    const m1 = facts().find((f) => f.id === "rail:M1")!;
    expect(m1.kind).toBe("rail");
    expect(m1.stops).toBe(2);
    expect(m1.lengthKm).toBeGreaterThan(1.9);
    expect(m1.spacingM).toBeCloseTo(m1.lengthKm * 1000);
    expect(m1.tripMin).toBe(4);
    expect(m1.speedKmh).toBeCloseTo(m1.lengthKm * 15);
    expect(m1.serviceHours).toBe(19);
    expect(m1.tripsPerDay).toBe(200);
    expect(m1.inService).toBe(4);
    expect(m1.placesPerVehicle).toBe(1920);
    expect(m1.capacityPerHour).toBe(12 * 1920);
    expect(m1.vehicle).toContain("× 2");
  });

  it("matches the cost estimate's fleet and vehicle-km", () => {
    const e = estimate({
      railway: railway(),
      view: railView(),
      reports: { M1: REPORT },
      streetLines: STREET.lines,
      prefs: {},
      prices: BASE_PRICES,
    });
    for (const f of facts()) {
      const s = e.lines.find((l) => l.id === f.id)!;
      expect(f.fleet).toBe(s.fleet);
      expect(f.kmPerYear).toBeCloseTo(s.kmPerYear);
    }
  });

  it("uses the library's service hours and places for street lines", () => {
    const r7 = facts().find((f) => f.id === "street:0")!;
    expect(r7.lengthKm).toBe(3);
    expect(r7.stops).toBe(3);
    expect(r7.spacingM).toBe(1500);
    expect(r7.hoursAssumed).toBe(true);
    expect(r7.serviceHours).toBe(libraryValue("cost.service_hours_per_day", "brt")[1]);
    expect(r7.placesPerVehicle).toBe(libraryValue("mode.vehicle_capacity", "brt")[1]);
    expect(r7.capacityPerHour).toBe(6 * r7.placesPerVehicle);
    expect(r7.tripsPerDay).toBe(((r7.serviceHours * 60) / 10) * 2);
    // Half the circuit's running time (25 min) and dwell (3 stops × 20 s).
    expect(r7.tripMin).toBeCloseTo((25 + 1) / 2);
  });

  it("flags a rail line that could not be published", () => {
    const f = lineFacts({ railway: railway(), view: railView(), reports: {}, streetLines: [], prefs: {} });
    expect(f[0]!.problem).toBeTruthy();
    expect(f[0]!.tripMin).toBeNull();
    expect(f[0]!.tripsPerDay).toBe(0);
  });
});

describe("infrastructure quantities", () => {
  it("measures track by construction type, stations, switches, crossings and the steepest gradient", () => {
    const q = quantities(railway(), railView(), STREET.lines);
    const metro = q.rail[0]!;
    expect(metro.routeKm).toBe(3);
    expect(metro.trackKm).toBe(5);
    expect(metro.doubleKm).toBe(2);
    expect(metro.singleKm).toBe(1);
    expect(metro.byStructure.at_grade).toBeCloseTo(0.5);
    expect(metro.byStructure.ramp).toBeCloseTo(0.2);
    expect(metro.byStructure.tbm).toBeCloseTo(1.3);
    expect(metro.byStructure.viaduct).toBeCloseTo(1);
    expect(metro.stations).toMatchObject({ street: 1, underground2: 1, elevated: 1 });
    expect(metro.platformEdges).toBe(5);
    expect(metro.switches).toBe(1);
    expect(metro.crossingsStreet).toBe(1);
    expect(metro.crossingsPath).toBe(1);
    expect(metro.street.reserved).toBeCloseTo(0.5);
    expect(metro.signals).toBe(1);
    expect(metro.steepest).toEqual({ permille: 38, track: "Main", limit: 40 });
    expect(q.street[0]).toMatchObject({ routeKm: 3, stops: 3, busLaneKm: 2, mixedKm: 3, levelCrossings: 1 });
  });
});

const loadRail = async () =>
  ({
    build: () => railView(),
    publishLines: () => ({ timetable: {}, lines: [REPORT], notes: [] }),
    dispose: () => {},
  }) as unknown as RailEngine;

describe("network tables", () => {
  it("shows the summary, the quantities and the service of each line, sortable", async () => {
    render(
      <NetworkTables
        railway={railway()}
        streetLines={STREET}
        preferences={{ values: {} }}
        loadRail={loadRail}
        fetchHeights={async (p) => p.map(() => 0)}
      />,
    );
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(within(summary).getByText("6 km")).toBeTruthy();
    expect(within(summary).getByText("1.3 km")).toBeTruthy(); // in tunnel
    const byMode = within(summary).getByRole("region", { name: "Per mode" });
    expect(within(byMode).getByText("Metro")).toBeTruthy();
    expect(within(byMode).getByText("BRT")).toBeTruthy();

    const rail = screen.getByRole("region", { name: "Railway" });
    expect(within(rail).getByText("Tunnel, bored (TBM)")).toBeTruthy();
    expect(within(rail).getByText("38 ‰")).toBeTruthy();
    expect(within(rail).queryByText("Tunnel, cut and cover")).toBeNull();
    expect(screen.getByRole("region", { name: "Street lines" })).toBeTruthy();

    const service = screen.getByRole("region", { name: "Service and fleet per line" });
    const names = () =>
      within(service)
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.querySelector(".font-medium")?.textContent);
    expect(names()).toEqual(["M1", "Route 7"]);
    fireEvent.click(within(service).getByRole("button", { name: /Every/ }));
    await waitFor(() => expect(names()).toEqual(["Route 7", "M1"]));
    expect(within(service).getByText("05:00–24:00")).toBeTruthy();
  });

  it("says when there is nothing to measure", () => {
    render(<NetworkTables railway={null} streetLines={null} preferences={null} />);
    expect(screen.getByText(/Nothing to measure yet/)).toBeTruthy();
  });
});

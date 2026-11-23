import { describe, expect, it } from "vitest";
import {
  MAX_ROAD_TILES,
  roadParams,
  roadScenario,
  roadTiles,
  tileOf,
  type RoadScenario,
} from "../src/simulation/road";

const LEG = {
  coords: [
    [8.54, 47.37],
    [8.55, 47.37],
  ] as [number, number][],
  time_s: 120,
};

function scenario(over: Partial<RoadScenario> = {}): RoadScenario {
  return {
    driving_side: "right",
    lines: [
      {
        index: 0,
        name: "Bus 1",
        mode: "bus",
        color: "#d2392c",
        vehicle: {
          length_m: 12,
          width_m: 2.55,
          max_speed_kmh: 80,
          weight_t: 19,
          energy: "battery",
          battery_kwh: 350,
          hvac_kw: 12,
        },
        dwell_s: 20,
        layover_s: 300,
        points: [
          { name: "A", kind: "end_stop", lonlat: [8.54, 47.37] },
          { name: "B", kind: "end_stop", lonlat: [8.55, 47.37] },
        ],
        legs: [LEG, { ...LEG, coords: [...LEG.coords].reverse() }],
        departures: [25200, 25800],
        pull_out: null,
        pull_in: null,
        depot: null,
      },
    ],
    depots: [],
    streets: [{ way: 110, bus_lane: true, cars_morning_peak: 900 }],
    traffic: {
      defaults: { trunk: 1500, primary: 900, secondary: 600, tertiary: 300, local: 50 },
      off_peak_share: 0.6,
      peaks: [
        [25200, 32400],
        [57600, 68400],
      ],
    },
    trolley_charge_kw: 120,
    ...over,
  };
}

describe("road run settings", () => {
  it("takes a period with warm-up and seed", () => {
    expect(roadParams.safeParse({ from_s: 25200, to_s: 32400, warmup_s: 1800, seed: 3 }).success).toBe(true);
  });

  it("refuses a period that ends before it starts or is longer than 12 hours", () => {
    expect(roadParams.safeParse({ from_s: 32400, to_s: 25200 }).success).toBe(false);
    expect(roadParams.safeParse({ from_s: 0, to_s: 13 * 3600 }).success).toBe(false);
    expect(roadParams.safeParse({ from_s: 0, to_s: 3600, warmup_s: 3 * 3600 }).success).toBe(false);
    expect(roadParams.safeParse({ from_s: 0, to_s: 3600, extra: 1 }).success).toBe(false);
  });
});

describe("road scenario", () => {
  it("takes what the simulator panel builds", () => {
    expect(roadScenario.safeParse(scenario()).success).toBe(true);
  });

  it("needs a leg for every point and at least one line", () => {
    const bad = scenario();
    bad.lines[0]!.legs = [LEG];
    expect(roadScenario.safeParse(bad).success).toBe(false);
    expect(roadScenario.safeParse(scenario({ lines: [] })).success).toBe(false);
  });

  it("refuses an unknown vehicle energy", () => {
    const bad = scenario();
    (bad.lines[0]!.vehicle as { energy: string }).energy = "hydrogen";
    expect(roadScenario.safeParse(bad).success).toBe(false);
  });
});

describe("road tiles", () => {
  it("covers the lines with room around them", () => {
    const tiles = roadTiles(scenario());
    expect(tiles.length).toBeGreaterThan(0);
    const [x, y] = tileOf(8.545, 47.37);
    expect(tiles).toContainEqual([x, y]);
    // 600 m of room: a point 500 m west of the line is in one of the tiles.
    const west = tileOf(8.54 - 500 / (111_320 * Math.cos((47.37 * Math.PI) / 180)), 47.37);
    expect(tiles).toContainEqual(west);
  });

  it("covers the depots too", () => {
    const s = scenario({
      depots: [
        {
          id: "d1",
          name: "North",
          network: { nodes: [{ id: "n1", lonlat: [8.6, 47.4] }], edges: [] },
          lanes: [],
          assignments: [],
        },
      ],
    });
    expect(roadTiles(s)).toContainEqual(tileOf(8.6, 47.4));
  });

  it("takes only the tiles along the routes, not the whole box around a city's lines", () => {
    // Two lines 30 km apart, west and east of a city, and a 30 km airport line between them.
    const base = scenario().lines[0]!;
    const at = (lon: number, lat: number): [number, number] => [lon, lat];
    const lineOf = (index: number, a: [number, number], b: [number, number]) => ({
      ...base,
      index,
      legs: [
        { coords: [a, b], time_s: 600 },
        { coords: [b, a], time_s: 600 },
      ],
    });
    const s = scenario({
      lines: [
        lineOf(0, at(36.1, 33.4), at(36.1, 33.7)),
        lineOf(1, at(36.5, 33.4), at(36.5, 33.7)),
        lineOf(2, at(36.1, 33.5), at(36.5, 33.5)),
      ],
    });
    const tiles = roadTiles(s);
    const [x0, y0] = tileOf(36.1, 33.7);
    const [x1, y1] = tileOf(36.5, 33.4);
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    expect(tiles.length).toBeLessThan(box / 2);
    expect(tiles.length).toBeLessThanOrEqual(MAX_ROAD_TILES);
    // Every tile the long straight airport leg crosses is in, though the leg has only its two ends.
    for (let k = 0; k <= 40; k++) expect(tiles).toContainEqual(tileOf(36.1 + (0.4 * k) / 40, 33.5));
    // A tile far from every line is left out.
    expect(tiles).not.toContainEqual(tileOf(36.3, 33.65));
    // Each tile once, north to south and west to east.
    expect(new Set(tiles.map(([x, y]) => `${x}/${y}`)).size).toBe(tiles.length);
    const sorted = [...tiles].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(tiles).toEqual(sorted);
  });
});

import { describe, expect, it } from "vitest";
import { pluginSources } from "../src/features/noise/sources";
import type { SavedPluginLine } from "../src/kits/saved";

const gondola: SavedPluginLine = {
  kit: "straight-spans",
  doc: { name: "Gondola" },
  line: null,
  noise: {
    kit: "straight-spans",
    mode: "cable_car",
    system: "3s",
    operation: "continuous",
    headway_s: 60,
    trip_time_s: 400,
    stations: [
      { lonlat: [8.0, 47.0], kind: "terminal" },
      { lonlat: [8.02, 47.0], kind: "terminal" },
    ],
    station_height_m: 8,
    towers: [{ lonlat: [8.01, 47.0], height_m: 30 }],
  },
};

const ferry: SavedPluginLine = {
  kit: "water-route",
  doc: { name: "Harbour ferry" },
  line: null,
  noise: {
    kit: "water-route",
    mode: "ferry",
    vessel: "catamaran",
    headway_s: 1800,
    // 1,000 m east in 200 s.
    legs: [
      {
        path: [
          [8.0, 47.0],
          [8.0 + 1000 / (111_320 * Math.cos((47 * Math.PI) / 180)), 47.0],
        ],
        length_m: 1000,
        time_s: 200,
      },
    ],
    berths: [
      { lonlat: [8.0, 47.0], name: "A", docked_s: 900 },
      { lonlat: [8.013, 47.0], name: "B", docked_s: 0 },
    ],
  },
};

describe("cable car and ferry noise sources", () => {
  it("puts a gondola's towers and stations on the map all day and evening, none at night", () => {
    const s = pluginSources({ "aerial-lift": gondola });
    expect(s.map((x) => x.lw_key)).toEqual([
      "noise.cable_car_tower_lw_db",
      "noise.cable_car_station_lw_db",
      "noise.cable_car_station_lw_db",
    ]);
    expect(s[0]!.height_m).toBe(30);
    expect(s[1]!.height_m).toBe(8);
    expect(s[0]!.context).toEqual(["cable_car/3s", "cable_car"]);
    expect(s[0]!.active).toEqual({ day: 1, evening: 1, night: 0 });
  });

  it("runs an aerial tramway's rope only while the cabins travel", () => {
    const tram: SavedPluginLine = {
      ...gondola,
      noise: {
        ...gondola.noise!,
        mode: "aerial_tramway",
        operation: "reversible",
        headway_s: 800,
      } as SavedPluginLine["noise"],
    };
    const s = pluginSources({ tram });
    expect(s[0]!.active.day).toBeCloseTo(0.5);
  });

  it("spreads a ferry's time along the route and adds the vessels lying at the piers", () => {
    const s = pluginSources({ ferry });
    const route = s.filter((x) => x.lw_key === "noise.ferry_cruise_lw_db");
    const berth = s.filter((x) => x.lw_key === "noise.ferry_berth_lw_db");
    expect(route.length).toBe(40);
    // Two passes per half hour of 200 s each: 400 s of vessel per 1,800 s on the whole route.
    const sum = route.reduce((n, x) => n + x.active.day, 0);
    expect(sum).toBeCloseTo(400 / 1800, 2);
    expect(route.every((x) => x.active.night === 0)).toBe(true);
    // Pier A: 900 s of berth time per round trip, a round trip every 1,800 s: half a vessel there on average.
    expect(berth).toHaveLength(1);
    expect(berth[0]!.active.day).toBeCloseTo(0.5);
    expect(berth[0]!.height_key).toBe("noise.ferry_source_height_m");
    expect(berth[0]!.context).toEqual(["ferry/catamaran", "ferry"]);
  });

  it("leaves out modes without sound powers and lines that are not complete", () => {
    const other: SavedPluginLine = {
      ...gondola,
      noise: { ...gondola.noise!, mode: "other_mode" } as SavedPluginLine["noise"],
    };
    expect(pluginSources({ other, empty: { ...ferry, noise: null } })).toEqual([]);
  });
});

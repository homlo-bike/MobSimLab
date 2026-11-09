import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const drawNoise = vi.fn();
vi.mock("../src/features/noise/mapLayer", () => ({
  drawNoise: (...a: unknown[]) => drawNoise(...a),
  removeNoise: vi.fn(),
  LEGEND: [
    { from_db: 50, color: "#e2f2bf" },
    { from_db: 55, color: "#f3c683" },
    { from_db: 60, color: "#e87e4d" },
  ],
}));

import { buildingTiles, loadBuildings, MAX_BUILDING_TILES } from "../src/features/noise/buildings";
import { MAP_REACH_M, NoiseMap, projectSources } from "../src/features/noise/NoiseMap";
import type { NoiseBuilding, NoiseEngine, NoiseInput, NoiseView } from "../src/features/noise/types";
import type { RailEngineLoader } from "../src/features/railways/types";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import type { LineView } from "../src/features/street-lines/types";

function view(): LineView {
  const points = (["end_stop", "stop"] as const).map((kind, seq) => ({
    id: seq + 1,
    seq,
    kind,
    name: `P${seq + 1}`,
    lonlat: [7 + seq * 0.004, 50] as [number, number],
    status: "ok" as const,
    message: null,
    bearing_deg: 90,
    bay: null,
  }));
  return {
    points,
    legs: points.map((p, i) => ({
      index: i,
      from: p.id,
      to: points[(i + 1) % 2]!.id,
      coords: [p.lonlat, points[(i + 1) % 2]!.lonlat],
      length_m: 286,
      time_s: 40,
      direct_m: 286,
      status: "ok" as const,
      message: null,
      ways: [1],
      crossing_wait_s: 0,
      level_crossings: [],
    })),
    directions: [],
    station_groups: [],
    depot: null,
    depot_trips: [],
    issues: [],
    level_crossings: [],
    crossing_wait_s: 0,
    length_m: 572,
    time_s: 80,
  } as LineView;
}

const DOC = {
  lines: [
    {
      name: "Route 7",
      profile: {
        mode: "bus",
        height_m: 3.1,
        weight_t: 19,
        length_m: 12,
        max_speed_kmh: 80,
        battery_range_m: 0,
        doors_both_sides: false,
      },
      timing: { headwayMin: 10, dwellS: 20 },
      points: [],
      depot: null,
      depotStops: {},
      view: view(),
    },
  ],
} as unknown as StreetLinesDoc;

const noRail: RailEngineLoader = () => Promise.reject(new Error("no railway in this test"));

const house = (id: string, lon: number): NoiseBuilding => ({
  id,
  ring: [
    [lon, 50.0002],
    [lon + 0.0001, 50.0002],
    [lon + 0.0001, 50.0003],
    [lon, 50.0002],
  ],
  levels: 3,
});

const RESULT: NoiseView = {
  lden: { threshold_db: 55, typical_m: [10, 12, 14], max_m: 15, max_at: null, probes: 20 },
  lnight: { threshold_db: 50, typical_m: [4, 5, 6], max_m: 6, max_at: null, probes: 20 },
  checks: [],
  image: {
    width: 2,
    height: 2,
    cell_m: 10,
    coordinates: [
      [7, 50.001],
      [7.004, 50.001],
      [7.004, 50],
      [7, 50],
    ],
  },
  input_level: "planned",
  buildings: {
    count: 2,
    reached: 2,
    lden: { from_db: [55, 60, 65, 70, 75], buildings: [1, 1, 0, 0, 0] },
    lnight: { from_db: [50, 55, 60, 65, 70], buildings: [2, 0, 0, 0, 0] },
  },
  building_levels: [
    [58.2, 51],
    [61, 52.4],
  ],
};

describe("noise map sources and buildings", () => {
  it("takes every saved street line with its headway as buses per hour", async () => {
    const lines = await projectSources(DOC, null, noRail);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      mode: "bus",
      label: "Route 7",
      flows: { day: 6, evening: 3, night: 1 },
    });
    expect(lines[0]!.id).toBe("street-0-leg-0");
  });

  it("covers the lines and their reach with zoom-14 tiles, nearest the centre first", () => {
    const t = buildingTiles(
      [
        [7, 50],
        [7.004, 50],
      ],
      MAP_REACH_M,
    );
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.length).toBeLessThanOrEqual(4);
    // A 30 km line needs far more tiles than the map loads.
    expect(
      buildingTiles(
        [
          [7, 50],
          [7.4, 50],
        ],
        MAP_REACH_M,
      ).length,
    ).toBeGreaterThan(MAX_BUILDING_TILES);
  });

  it("keeps a building on a tile edge once", async () => {
    const fetchTile = vi.fn(async (x: number) =>
      x === 1 ? [house("w1", 7)] : [house("w1", 7), house("w2", 7.001)],
    );
    const b = await loadBuildings(
      [
        [1, 1],
        [2, 1],
      ],
      fetchTile,
    );
    expect(b.map((x) => x.id)).toEqual(["w1", "w2"]);
  });
});

describe("noise map in the GIS tab", () => {
  function setup() {
    const estimate = vi.fn((input: NoiseInput) => (input ? RESULT : RESULT));
    const engine: NoiseEngine = {
      estimate,
      image: vi.fn(() => new Uint8Array(16)),
      dispose: vi.fn(),
    };
    const fetchTile = vi.fn(async () => [house("w1", 7.001), house("w2", 7.002)]);
    const map = {
      getSource: vi.fn(() => undefined),
      addSource: vi.fn(),
      getLayer: vi.fn(() => undefined),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      setPaintProperty: vi.fn(),
    } as unknown as MapLibreMap;
    render(
      <NoiseMap
        map={map}
        streetLines={DOC}
        railway={null}
        preferences={{ "noise.building_default_height_m": 12, "street.bus_lane_delay_share": 0.1 }}
        loadNoise={async () => engine}
        loadRail={noRail}
        fetchTile={fetchTile}
      />,
    );
    return { estimate, fetchTile, map };
  }

  it("computes the map with the buildings round the lines and counts them by band", async () => {
    const { estimate, fetchTile, map } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(fetchTile).toHaveBeenCalled();
    const input = estimate.mock.calls[0]![0];
    expect(input.grid_reach_m).toBe(MAP_REACH_M);
    expect(input.buildings!.map((b) => b.id)).toEqual(["w1", "w2"]);
    expect(input.overrides).toEqual({ "noise.building_default_height_m": 12 });
    const table = await screen.findByRole("table", { name: "Buildings by noise band" });
    expect(table.textContent).toContain("55–59 dB");
    expect(table.textContent).toContain("2 of 2 in reach");
    expect(drawNoise).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith("noise-buildings", expect.anything());
    fireEvent.click(screen.getByRole("radio", { name: "L_night" }));
    expect(screen.getByRole("table", { name: "Buildings by noise band" }).textContent).toContain("50–54 dB");
  });

  it("can leave the buildings out", async () => {
    const { estimate, fetchTile } = setup();
    fireEvent.click(screen.getByLabelText("Screen with OpenStreetMap buildings"));
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(fetchTile).not.toHaveBeenCalled();
    expect(estimate.mock.calls[0]![0].buildings).toEqual([]);
  });
});

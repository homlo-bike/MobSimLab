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
import { buildingsBbox, type PopulationAnswer } from "../src/features/noise/population";
import { MAX_TERRAIN_POINTS, loadTerrain, terrainPlan } from "../src/features/noise/terrain";
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
    lden: { from_db: [55, 60, 65, 70, 75], buildings: [1, 1, 0, 0, 0], people: [12, 340, 0, 0, 0] },
    lnight: { from_db: [50, 55, 60, 65, 70], buildings: [2, 0, 0, 0, 0], people: [352, 0, 0, 0, 0] },
    people: { source: "grid", total: 352, reached: 352, unplaced: 4 },
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

  it("plans a terrain grid over the lines and their reach, coarser for long lines", () => {
    const p = terrainPlan(
      [
        [7, 50],
        [7.004, 50],
      ],
      MAP_REACH_M,
    )!;
    expect(p.spacingM).toBe(30);
    expect(p.lon0).toBeLessThan(7 - MAP_REACH_M / 111_195 / Math.cos((50 * Math.PI) / 180));
    expect(p.lat0 + (p.ny - 1) * p.dLat).toBeGreaterThan(50 + MAP_REACH_M / 111_195);
    const long = terrainPlan(
      [
        [7, 50],
        [7.1, 50.08],
      ],
      MAP_REACH_M,
    )!;
    expect(long.spacingM).toBeGreaterThan(30);
    expect(long.nx * long.ny).toBeLessThanOrEqual(MAX_TERRAIN_POINTS);
    // A 30 km line would need a grid coarser than the terrain is worth.
    expect(
      terrainPlan(
        [
          [7, 50],
          [7.4, 50.2],
        ],
        MAP_REACH_M,
      ),
    ).toBeNull();
  });

  it("loads the terrain row by row from the south-west in requests of 20,000", async () => {
    const fetch = vi.fn(async (pts: [number, number][]) => pts.map((p) => (p[1] > 50 ? 100 : null)));
    const plan = { lon0: 7, lat0: 49.95, dLon: 0.001, dLat: 0.0004, nx: 200, ny: 150, spacingM: 30 };
    const t = await loadTerrain(plan, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(t.z).toHaveLength(30_000);
    expect(fetch.mock.calls[0]![0][1]).toEqual([7.001, 49.95]);
    expect(t).toMatchObject({ x0: 7, y0: 49.95, dx: 0.001, dy: 0.0004, nx: 200, ny: 150 });
    expect(t.z[0]).toBeNull();
    expect(t.z.at(-1)).toBe(100);
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
  const GRID = { x0: 7, y0: 50, dx: 1 / 1200, dy: 1 / 1200, nx: 2, ny: 1, people: [30, 5] };
  const READY: PopulationAnswer = {
    status: "ready",
    grid: GRID,
    source: {
      name: "WorldPop",
      dataset: "R2025A",
      url: "https://doi.org/10.5258/SOTON/WP00839",
      licence: "CC BY 4.0",
      year: 2026,
      countries: ["DEU"],
      citation: "Bondarenko et al. 2025",
    },
  };
  function setup(
    fetchTerrain = vi.fn(async (pts: [number, number][]) => pts.map(() => 120)),
    fetchPeople = vi.fn<(bbox: [number, number, number, number]) => Promise<PopulationAnswer>>(
      async () => READY,
    ),
    result: NoiseView = RESULT,
  ) {
    const estimate = vi.fn((input: NoiseInput) => (input ? { ...result, terrain: true } : result));
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
        fetchTerrain={fetchTerrain}
        fetchPeople={fetchPeople}
      />,
    );
    return { estimate, fetchTile, fetchTerrain, fetchPeople, map };
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
    expect(input.terrain).toMatchObject({ dx: expect.any(Number), nx: expect.any(Number) });
    expect(input.terrain!.z.every((z) => z === 120)).toBe(true);
    expect(screen.getByText(/stand on the terrain/)).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Buildings and residents by noise band" });
    expect(table.textContent).toContain("55–59 dB");
    expect(table.textContent).toContain("2 of 2 buildings in reach");
    // Residents rounded as the Directive reports them: to the hundred above 100.
    expect(table.textContent).toContain("300");
    expect(drawNoise).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith("noise-buildings", expect.anything());
    fireEvent.click(screen.getByRole("radio", { name: "L_night" }));
    expect(
      screen.getByRole("table", { name: "Buildings and residents by noise band" }).textContent,
    ).toContain("50–54 dB");
  });

  it("can leave the buildings out", async () => {
    const { estimate, fetchTile } = setup();
    fireEvent.click(screen.getByLabelText("Screen with OpenStreetMap buildings"));
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(fetchTile).not.toHaveBeenCalled();
    expect(estimate.mock.calls[0]![0].buildings).toEqual([]);
  });

  it("can leave the terrain out, and falls back to flat ground when it fails", async () => {
    const { estimate, fetchTerrain } = setup();
    fireEvent.click(screen.getByLabelText("Use terrain heights (Copernicus GLO-30)"));
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(fetchTerrain).not.toHaveBeenCalled();
    expect(estimate.mock.calls[0]![0].terrain).toBeNull();
    cleanup();
    const failing = setup(vi.fn(async () => Promise.reject(new Error("DEM down"))));
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(failing.estimate).toHaveBeenCalled());
    expect(failing.estimate.mock.calls[0]![0].terrain).toBeNull();
    expect(await screen.findByText(/Terrain heights are unavailable \(DEM down\)/)).toBeTruthy();
  });

  it("shares WorldPop's people among the buildings and says so", async () => {
    const { estimate, fetchPeople } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    const bbox = fetchPeople.mock.calls[0]![0];
    expect(bbox[0]).toBeCloseTo(7.001, 6);
    expect(bbox[2]).toBeCloseTo(7.0021, 6);
    expect(estimate.mock.calls[0]![0].population).toEqual(GRID);
    expect(await screen.findByText(/Residents from WorldPop 2026 \(DEU\)/)).toBeTruthy();
    expect(screen.getByText(/4 people of the grid live in cells without a mapped home/)).toBeTruthy();
    expect(screen.getByText(/Population: WorldPop/)).toBeTruthy();
  });

  it("falls back to the building size while WorldPop downloads or when it fails", async () => {
    const sized: NoiseView = {
      ...RESULT,
      buildings: {
        ...RESULT.buildings!,
        people: { source: "building_size", total: 20, reached: 20, unplaced: 0 },
      },
    };
    const loading = setup(
      undefined,
      vi.fn(
        async () =>
          ({
            status: "loading",
            reason: "The WorldPop grid of DEU is being downloaded to the server",
          }) as const,
      ),
      sized,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(loading.estimate).toHaveBeenCalled());
    expect(loading.estimate.mock.calls[0]![0].population).toBeNull();
    expect(await screen.findByText(/being downloaded to the server\. Until it is there/)).toBeTruthy();
    expect(screen.getByText(/Residents estimated from the building size/)).toBeTruthy();
    cleanup();
    const failing = setup(
      undefined,
      vi.fn(async () => Promise.reject(new Error("WorldPop is unavailable right now"))),
      sized,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(failing.estimate).toHaveBeenCalled());
    expect(
      await screen.findByText(
        /WorldPop population is unavailable \(WorldPop is unavailable right now\), so residents/,
      ),
    ).toBeTruthy();
  });

  it("asks for no population without buildings", async () => {
    const { estimate, fetchPeople } = setup();
    fireEvent.click(screen.getByLabelText("Screen with OpenStreetMap buildings"));
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(fetchPeople).not.toHaveBeenCalled();
    expect(buildingsBbox([])).toBeNull();
  });
});

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

import { engineRunner } from "../src/features/noise/engine";
import { corridorTiles, loadBuildings, MAX_BUILDING_TILES } from "../src/features/noise/buildings";
import { Corridor } from "../src/features/noise/corridor";
import { MAP_REACH_M, NoiseMap, projectSources } from "../src/features/noise/NoiseMap";
import { buildingsBbox, fetchPopulationOver, type PopulationAnswer } from "../src/features/noise/population";
import { MAX_TERRAIN_POINTS, loadTerrain, terrainPlan } from "../src/features/noise/terrain";
import type { NoiseBuilding, NoiseEngine, NoiseInput, NoiseView } from "../src/features/noise/types";
import type { Done } from "../src/features/noise/result";
import type { SavedNoise } from "../src/features/noise/saved";
import { projectResults, type ResultsApi, resultFromJson, resultToJson } from "../src/projects/results";
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

const READY_SOURCE = {
  name: "WorldPop",
  dataset: "R2025A",
  url: "https://doi.org/10.5258/SOTON/WP00839",
  licence: "CC BY 4.0",
  year: 2026,
  countries: ["DEU"],
  citation: "Bondarenko et al. 2025",
};

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
    const t = corridorTiles(
      new Corridor(
        [
          [
            [7, 50],
            [7.004, 50],
          ],
        ],
        MAP_REACH_M,
      ),
    );
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.length).toBeLessThanOrEqual(4);
    // A 30 km line takes the tiles along it, well within the limit.
    const line = corridorTiles(
      new Corridor(
        [
          [
            [7, 50],
            [7.4, 50],
          ],
        ],
        MAP_REACH_M,
      ),
    );
    expect(line.length).toBeGreaterThan(12);
    expect(line.length).toBeLessThanOrEqual(MAX_BUILDING_TILES);
  });

  it("takes the tiles along lines that fan out across a city, not the land between them", () => {
    // Four 15 km lines from a centre, as a city's network fans out to its suburbs.
    const arms: [number, number][][] = [
      [
        [36.3, 33.5],
        [36.45, 33.5],
      ],
      [
        [36.3, 33.5],
        [36.15, 33.5],
      ],
      [
        [36.3, 33.5],
        [36.3, 33.64],
      ],
      [
        [36.3, 33.5],
        [36.3, 33.36],
      ],
    ];
    const tiles = corridorTiles(new Corridor(arms, MAP_REACH_M));
    // The box round them holds about 20 × 23 tiles; the arms take a fraction of it.
    expect(tiles.length).toBeLessThan(120);
    expect(tiles.length).toBeLessThanOrEqual(MAX_BUILDING_TILES);
    const near = new Corridor(arms, MAP_REACH_M);
    // Within the reach of a line, yes; in the empty quarter between two arms, no.
    expect(near.has(36.4, 33.5 + MAP_REACH_M / 111_195)).toBe(true);
    expect(near.has(36.4, 33.6)).toBe(false);
  });

  it("plans the terrain along the lines and their reach, loading only the samples near them", () => {
    const p = terrainPlan(
      [
        [
          [7, 50],
          [7.004, 50],
        ],
      ],
      MAP_REACH_M,
    )!;
    expect(p.spacingM).toBe(30);
    expect(p.lon0).toBeLessThan(7 - MAP_REACH_M / 111_195 / Math.cos((50 * Math.PI) / 180));
    expect(p.lat0 + (p.ny - 1) * p.dLat).toBeGreaterThan(50 + MAP_REACH_M / 111_195);
    // A city's lines fanning out 15 km each way stay at 30 m, loading only along them.
    const city = terrainPlan(
      [
        [
          [36.15, 33.5],
          [36.45, 33.5],
        ],
        [
          [36.3, 33.36],
          [36.3, 33.64],
        ],
      ],
      MAP_REACH_M,
    )!;
    expect(city.spacingM).toBe(30);
    expect(city.samples.length).toBeLessThanOrEqual(MAX_TERRAIN_POINTS);
    expect(city.samples.length).toBeLessThan((city.nx * city.ny) / 4);
    // A region 300 km across would need a grid coarser than the terrain is worth.
    expect(
      terrainPlan(
        [
          [
            [7, 50],
            [10, 53],
          ],
          [
            [7, 53],
            [10, 50],
          ],
        ],
        MAP_REACH_M,
      ),
    ).toBeNull();
  });

  it("loads the planned terrain samples from the south-west in requests of 20,000", async () => {
    const fetch = vi.fn(async (pts: [number, number][]) => pts.map((p) => (p[1] > 50 ? 100 : null)));
    // Every sample but the first row's first.
    const samples = Uint32Array.from({ length: 29_999 }, (_, i) => i + 1);
    const plan = { lon0: 7, lat0: 49.95, dLon: 0.001, dLat: 0.0004, nx: 200, ny: 150, spacingM: 30, samples };
    const t = await loadTerrain(plan, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(t.z).toHaveLength(30_000);
    expect(fetch.mock.calls[0]![0][0]).toEqual([7.001, 49.95]);
    expect(t).toMatchObject({ x0: 7, y0: 49.95, dx: 0.001, dy: 0.0004, nx: 200, ny: 150 });
    expect(t.z[0]).toBeNull();
    expect(t.z.at(-1)).toBe(100);
  });

  it("keeps only the buildings near the lines, from tiles loaded a few at a time", async () => {
    let open = 0;
    let most = 0;
    const fetchTile = vi.fn(async (x: number) => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return [house(`a${x}`, 7), house(`b${x}`, 7.5)];
    });
    const tiles = Array.from({ length: 10 }, (_, i): [number, number] => [i, 1]);
    const b = await loadBuildings(tiles, fetchTile, undefined, undefined, (h) => h.ring[0]![0] < 7.1);
    expect(fetchTile).toHaveBeenCalledTimes(10);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
    expect(b.map((x) => x.id)).toEqual(tiles.map(([x]) => `a${x}`));
  });

  it("asks for people in pieces over a city's buildings and joins them into one grid", async () => {
    const C = 1 / 1200;
    const fetchPeople = vi.fn(async (bbox: [number, number, number, number]): Promise<PopulationAnswer> => {
      const x0 = Math.floor((bbox[0] + 180) / C + 1e-6) * C - 180;
      const y0 = Math.floor((bbox[1] + 90) / C + 1e-6) * C - 90;
      const nx = Math.ceil((bbox[2] + 180) / C - 1e-6) - Math.round((x0 + 180) / C);
      const ny = Math.ceil((bbox[3] + 90) / C - 1e-6) - Math.round((y0 + 90) / C);
      return {
        status: "ready",
        grid: { x0, y0, dx: C, dy: C, nx, ny, people: new Array<number>(nx * ny).fill(1) },
        source: { ...READY_SOURCE, countries: [bbox[0] < 36.2 ? "SYR" : "LBN"] },
      };
    });
    // Buildings at both ends of a 0.4° line: two pieces, not the empty one between them.
    const homes = [house("w", 36.01), house("e", 36.39)];
    const box: [number, number, number, number] = [36.01, 50.0002, 36.3901, 50.0003];
    const a = await fetchPopulationOver(box, homes, fetchPeople);
    expect(fetchPeople).toHaveBeenCalledTimes(2);
    for (const [w, , e] of fetchPeople.mock.calls.map((c) => c[0])) expect(e - w).toBeLessThanOrEqual(0.3);
    if (a.status !== "ready") throw new Error(a.status);
    expect(a.grid.x0).toBeLessThanOrEqual(36.01 + 1e-9);
    expect(a.grid.x0 + a.grid.nx * a.grid.dx).toBeGreaterThanOrEqual(36.3901);
    // The pieces do not overlap: every person of both is in the joined grid once.
    let pieces = 0;
    for (const r of fetchPeople.mock.results) {
      const got = await (r.value as Promise<PopulationAnswer>);
      if (got.status === "ready") pieces += got.grid.people.length;
    }
    expect(a.grid.people.reduce((x, y) => x + y, 0)).toBe(pieces);
    expect(a.source.countries).toEqual(["SYR", "LBN"]);
    // A small area is one request, as before.
    fetchPeople.mockClear();
    await fetchPopulationOver([7, 50, 7.01, 50.01], [house("x", 7)], fetchPeople);
    expect(fetchPeople).toHaveBeenCalledTimes(1);
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
    waits: { popWaitMs: number; popPollMs?: number } = { popWaitMs: 0 },
    // Most of these tests are about the buildings, so they start with the option ticked.
    screenBuildings = true,
    results: ResultsApi | null = null,
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
        runNoise={engineRunner(async () => engine)}
        popWaitMs={waits.popWaitMs}
        popPollMs={waits.popPollMs}
        loadRail={noRail}
        fetchTile={fetchTile}
        fetchTerrain={fetchTerrain}
        fetchPeople={fetchPeople}
        screenBuildings={screenBuildings}
        results={results}
        canSave
      />,
    );
    return { estimate, fetchTile, fetchTerrain, fetchPeople, map };
  }

  it("leaves the buildings out unless asked for", async () => {
    const { estimate, fetchTile, fetchPeople } = setup(undefined, undefined, RESULT, { popWaitMs: 0 }, false);
    expect((screen.getByLabelText("Screen with OpenStreetMap buildings") as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(fetchTile).not.toHaveBeenCalled();
    expect(fetchPeople).not.toHaveBeenCalled();
    expect(estimate.mock.calls[0]![0].buildings).toEqual([]);
  });

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
    // The samples near the line are loaded; the engine fills the rest of the grid from them.
    expect(input.terrain!.z.some((z) => z === 120)).toBe(true);
    expect(input.terrain!.z.every((z) => z === 120 || z === null)).toBe(true);
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

  it("saves each new noise map with the project and shows the saved one on opening", async () => {
    let kept: { value: SavedNoise; inputs: string } | null = null;
    const results: ResultsApi = {
      load: vi.fn(async () => null),
      save: vi.fn(async (_kind, value, inputs) => {
        kept = { value: value as SavedNoise, inputs };
        return "2026-11-18T17:00:00.000Z";
      }),
    };
    const { estimate } = setup(undefined, undefined, RESULT, { popWaitMs: 0 }, false, results);
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    await waitFor(() => expect(results.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(results.save).mock.calls[0]![0]).toBe("noise");
    expect(await screen.findByText(/Saved with the project/)).toBeTruthy();
    // Through the saved format and back, as on opening the project again.
    const back = resultFromJson<SavedNoise>(resultToJson(kept!.value))!;
    expect(back.result.main.images!.lden).toBeInstanceOf(Uint8Array);
    expect([...back.result.main.images!.lden]).toEqual([...kept!.value.result.main.images!.lden]);
    cleanup();
    const reopen = (inputs: string) =>
      ({
        load: vi.fn(async () => ({ value: back, inputs, computedAt: "2026-11-18T17:00:00.000Z" })),
        save: vi.fn(async () => null),
      }) as unknown as ResultsApi;
    const again = setup(undefined, undefined, RESULT, { popWaitMs: 0 }, false, reopen(kept!.inputs));
    expect(await screen.findByText(/Saved with the project, worked out/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeTruthy();
    expect(again.estimate).not.toHaveBeenCalled();
    expect(drawNoise).toHaveBeenCalled();
    cleanup();
    // Worked out from other inputs (the design changed since), it shows as out of date.
    setup(undefined, undefined, RESULT, { popWaitMs: 0 }, false, reopen("older"));
    expect(await screen.findByText(/Out of date/)).toBeTruthy();
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
            countries: ["DEU"],
          }) as const,
      ),
      sized,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    await waitFor(() => expect(loading.estimate).toHaveBeenCalled());
    expect(loading.estimate.mock.calls[0]![0].population).toBeNull();
    expect(
      await screen.findByText(/population grid of DEU is being downloaded to the server\. Until it is there/),
    ).toBeTruthy();
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
        /WorldPop population is not available \(WorldPop is unavailable right now\), so residents/,
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

  it("shows the step under way and can be cancelled", async () => {
    let release: () => void = () => undefined;
    const slowTerrain = vi.fn(
      (pts: [number, number][]) => new Promise<number[]>((r) => (release = () => r(pts.map(() => 120)))),
    );
    const { estimate } = setup(slowTerrain);
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    const bar = await screen.findByRole("progressbar", { name: "Noise map" });
    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("The noise map was cancelled.")).toBeTruthy();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("waits for a first-time WorldPop download, showing how far it is, and can go on without it", async () => {
    const loading: PopulationAnswer = {
      status: "loading",
      reason: "downloading",
      countries: ["DEU"],
      progress: { receivedBytes: 120e6, totalBytes: 300e6 },
    };
    const fetchPeople = vi.fn(async () => (fetchPeople.mock.calls.length < 2 ? loading : READY));
    const ready = setup(undefined, fetchPeople, RESULT, { popWaitMs: 60_000, popPollMs: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    expect(await screen.findByText(/population grid of DEU to the server: 120 of 300 MB/)).toBeTruthy();
    await waitFor(() => expect(ready.estimate).toHaveBeenCalled());
    expect(ready.estimate.mock.calls[0]![0].population).toEqual(GRID);
    cleanup();

    const always = vi.fn(async () => loading);
    const skipped = setup(undefined, always, RESULT, { popWaitMs: 60_000, popPollMs: 60_000 });
    fireEvent.click(screen.getByRole("button", { name: "Compute noise map" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use the building size instead" }));
    await waitFor(() => expect(skipped.estimate).toHaveBeenCalled());
    expect(skipped.estimate.mock.calls[0]![0].population).toBeNull();
  });
});

describe("the noise map saved with the project", () => {
  it("sends it gzip-compressed and reads it back", async () => {
    let body: ArrayBuffer | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          body = await new Response(init.body as Blob).arrayBuffer();
          return new Response(JSON.stringify({ computedAt: "2026-11-18T17:00:00.000Z" }), { status: 200 });
        }
        return body
          ? new Response(body, {
              status: 200,
              headers: { "X-Computed-At": "2026-11-18T17:00:00.000Z", "X-Inputs": "abc" },
            })
          : new Response("", { status: 404 });
      }),
    );
    const api = projectResults("00000000-0000-4000-8000-000000000001");
    expect(await api.load("noise")).toBeNull();
    const levels = new Float32Array([55.5, Number.NaN]);
    const done: Done = {
      kind: "done",
      level: "planned",
      main: {
        name: "Current design",
        view: RESULT,
        images: { lden: new Uint8Array([1, 2, 3, 4]), lnight: new Uint8Array([5, 6, 7, 8]) },
        levels: { lden: levels, lnight: levels },
      },
      other: null,
      difference: null,
      buildings: null,
      notes: [],
      people: null,
    };
    expect(await api.save("noise", done, "abc")).toBe("2026-11-18T17:00:00.000Z");
    expect([...new Uint8Array(body!).slice(0, 2)]).toEqual([0x1f, 0x8b]);
    const back = await api.load<Done>("noise");
    expect(back?.computedAt).toBe("2026-11-18T17:00:00.000Z");
    expect(back?.inputs).toBe("abc");
    expect([...back!.value.main.images!.lnight]).toEqual([5, 6, 7, 8]);
    expect(back!.value.main.levels!.lden[0]).toBe(55.5);
    expect(Number.isNaN(back!.value.main.levels!.lden[1])).toBe(true);
    // The static viewer serves the saved result as plain JSON.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(resultToJson(done), { status: 200, headers: { "X-Inputs": "abc" } })),
    );
    expect((await projectResults("p").load<Done>("noise"))?.value.main.images!.lden).toBeInstanceOf(
      Uint8Array,
    );
    vi.unstubAllGlobals();
  });
});

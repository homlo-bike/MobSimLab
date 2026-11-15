import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const drawWalk = vi.fn();
vi.mock("../src/features/walk/mapLayer", () => ({
  drawWalk: (...a: unknown[]) => drawWalk(...a),
  removeWalk: vi.fn(),
}));

import type { PopulationAnswer } from "../src/features/noise/population";
import type { RailEngineLoader } from "../src/features/railways/types";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import type { LineView } from "../src/features/street-lines/types";
import {
  LIBRARY_MINUTES,
  peopleDemand,
  ruleMinutes,
  spacingGuidance,
  streetNetwork,
  studyArea,
  walkSettings,
  walkTiles,
} from "../src/features/walk/model";
import type { CoverageRequest, SpacingRequest, WalkEngine } from "../src/features/walk/types";
import { WalkAnalysis } from "../src/features/walk/WalkAnalysis";

/** A two-way line of three stops (one via point) at 50° N, 300 m apart, with one direction. */
function view(): LineView {
  const kinds = ["end_stop", "via", "stop", "end_stop"] as const;
  const points = kinds.map((kind, seq) => ({
    id: seq + 1,
    seq,
    kind,
    name: kind === "via" ? "" : `Stop ${seq + 1}`,
    lonlat: [7 + seq * 0.002, 50] as [number, number],
    status: "ok" as const,
    message: null,
    bearing_deg: 90,
    bay: null,
  }));
  const legs = points.slice(0, -1).map((p, i) => ({
    index: i,
    from: p.id,
    to: points[i + 1]!.id,
    coords: [p.lonlat, points[i + 1]!.lonlat],
    length_m: 143,
    time_s: 20,
    direct_m: 143,
    status: "ok" as const,
    message: null,
    ways: [1],
    crossing_wait_s: 0,
  }));
  return {
    points,
    legs,
    directions: [{ direction: 0, stops: [1, 3, 4], legs: [0, 1, 2], length_m: 429, time_s: 60 }],
    station_groups: [],
    depot: null,
    depot_trips: [],
    issues: [],
    level_crossings: [],
    crossing_wait_s: 0,
    length_m: 429,
    time_s: 60,
  } as unknown as LineView;
}

const DOC = {
  lines: [
    {
      name: "Route 7",
      profile: { mode: "bus" },
      timing: { headwayMin: 10, dwellS: 20 },
      points: [],
      depot: null,
      depotStops: {},
      view: view(),
    },
  ],
} as unknown as StreetLinesDoc;

const noRail: RailEngineLoader = () => Promise.reject(new Error("no railway in this test"));

interface Log {
  coverage?: CoverageRequest;
  spacing: SpacingRequest[];
  xml: string[];
}

function fakeEngine(log: Log) {
  return async (): Promise<WalkEngine> => ({
    addOsm: (xml) => log.xml.push(xml),
    build: () => {},
    ready: () => true,
    coverage: (req) => {
      log.coverage = req;
      return {
        demand_kind: req.demand ? "points" : "street_cells",
        total: 2000,
        covered: 1500,
        share: 0.75,
        buffer_share: 0.9,
        groups: [{ label: "15 min", covered: 1500, share: 0.75 }],
        minutes_bands: [
          { from_min: 0, to_min: 5, demand: 600 },
          { from_min: 5, to_min: 10, demand: 500 },
          { from_min: 10, to_min: 15, demand: 400 },
          { from_min: 15, to_min: 20, demand: 300 },
          { from_min: 20, to_min: null, demand: 200 },
        ],
        study_area: req.study_area,
        stops_off_network: [],
        demand_off_network: 0,
        uncovered: [
          { lon: 7.03, lat: 50.01, weight: 320, nearest: 1260 },
          { lon: 7.05, lat: 50.02, weight: 110, nearest: null },
        ],
      };
    },
    catchment: () => ({ type: "FeatureCollection", features: [] }),
    spacing: (req) => {
      log.spacing.push(req);
      return {
        geometry: req.route ? "route" : "straight",
        segments: [
          {
            from: req.stops[0]!.id,
            to: req.stops[1]!.id,
            along_m: 286,
            straight_m: 286,
            walk_m: 300,
            flag: null,
          },
          {
            from: req.stops[1]!.id,
            to: req.stops[2]!.id,
            along_m: 143,
            straight_m: 143,
            walk_m: 150,
            flag: "short",
          },
        ],
        along: { count: 2, mean: 214, median: 214, p10: 150, p90: 280, min: 143, max: 286 },
        walk: { count: 0, mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 },
        histogram: [],
        short: 1,
        long: 0,
      };
    },
    dispose: () => {},
  });
}

const GRID: PopulationAnswer = {
  status: "ready",
  grid: { x0: 6.99, y0: 49.99, dx: 0.001, dy: 0.001, nx: 3, ny: 2, people: [10, 0, 5, 20, 1, 0] },
  source: {
    name: "WorldPop",
    dataset: "Constrained",
    url: "https://www.worldpop.org",
    licence: "CC BY 4.0",
    year: 2020,
    countries: ["DEU"],
    citation: "",
  },
};

describe("walk model", () => {
  it("takes the stops of saved street lines and runs each direction along its legs", () => {
    const net = streetNetwork(DOC);
    expect(net.stops.map((s) => s.name)).toEqual(["Stop 1", "Stop 3", "Stop 4"]);
    expect(net.lines).toHaveLength(1);
    expect(net.lines[0]!.mode).toBe("bus");
    const d = net.lines[0]!.directions[0]!;
    expect(d.stops).toEqual(["s0:1", "s0:3", "s0:4"]);
    // Three legs joined without repeating the shared points.
    expect(d.route).toHaveLength(4);
    expect(streetNetwork(null).stops).toEqual([]);
  });

  it("uses the project's walk rule and walking speed, within bounds", () => {
    expect(ruleMinutes()).toBe(LIBRARY_MINUTES);
    expect(LIBRARY_MINUTES).toBe(15);
    expect(ruleMinutes({ "analysis.walk_rule_minutes": 10 })).toBe(10);
    expect(ruleMinutes({ "analysis.walk_rule_minutes": 90 })).toBe(LIBRARY_MINUTES);
    expect(walkSettings({ "demand.walk_speed_kmh": 4 }, true)).toMatchObject({
      walk_speed_kmh: 4,
      crossing_delay_s: 20,
      step_free: true,
    });
    expect(spacingGuidance("bus")).toEqual([250, 400, 600]);
    expect(spacingGuidance("hovercraft")).toBeNull();
  });

  it("boxes the stops with the walk reach and lists the tiles over it", () => {
    const area = studyArea(streetNetwork(DOC).stops, 1000)!;
    expect(area[1]).toBeCloseTo(50 - 1000 / 111_195, 6);
    expect(area[2]).toBeGreaterThan(7.006);
    expect(walkTiles(area).length).toBeGreaterThan(0);
    expect(walkTiles(area).length).toBeLessThan(10);
    expect(studyArea([], 1000)).toBeNull();
  });

  it("gathers the people of the grid inside the area in cells", () => {
    if (GRID.status !== "ready") throw new Error("grid");
    const pts = peopleDemand(GRID.grid, [6.99, 49.99, 7.0, 50.0], 2000);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.weight).toBe(36);
    // Cells outside the area are left out.
    const part = peopleDemand(GRID.grid, [6.99, 49.99, 6.991, 49.991], 2000);
    expect(part.reduce((s, p) => s + p.weight, 0)).toBe(10);
  });
});

describe("WalkAnalysis", () => {
  it("shows the stop spacing of each line against the mode's range", async () => {
    const log: Log = { spacing: [], xml: [] };
    render(
      <WalkAnalysis
        map={null}
        streetLines={DOC}
        railway={null}
        loadWalk={fakeEngine(log)}
        loadRail={noRail}
      />,
    );
    expect(await screen.findByText(/Median 214 m/)).toBeTruthy();
    expect(screen.getByText(/Usual for this mode: 250–600 m/)).toBeTruthy();
    expect(screen.getByText("1 too close, 0 too far apart")).toBeTruthy();
    expect(screen.getByText("Stop 3 → Stop 4")).toBeTruthy();
    expect(log.spacing[0]!.guidance_m).toEqual([250, 600]);
    expect(log.spacing[0]!.route).toHaveLength(4);
  });

  it("measures the walk coverage with the residents and lists the gaps", async () => {
    const log: Log = { spacing: [], xml: [] };
    const fetchTile = vi.fn(async (x: number, y: number) => `<osm tile="${x}/${y}"/>`);
    const fetchPeople = vi.fn(async () => GRID);
    render(
      <WalkAnalysis
        map={null}
        streetLines={DOC}
        railway={null}
        loadWalk={fakeEngine(log)}
        loadRail={noRail}
        fetchTile={fetchTile}
        fetchPeople={fetchPeople}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate walk coverage" }));
    expect(await screen.findByText(/75 % of the 2,000 residents/)).toBeTruthy();
    expect(screen.getByText(/In a straight line it would be 90 %/)).toBeTruthy();
    expect(screen.getByText("320 residents · 21 min walk to the nearest stop")).toBeTruthy();
    expect(screen.getByText("110 residents · no stop reachable on foot")).toBeTruthy();
    expect(screen.getByText(/WorldPop 2020 \(DEU\)/)).toBeTruthy();
    expect(fetchTile).toHaveBeenCalled();
    expect(log.xml.length).toBe(fetchTile.mock.calls.length);
    const req = log.coverage!;
    expect(req.groups[0]).toMatchObject({ metric: "time", limit: 900, stops: [0, 1, 2] });
    expect(req.demand!.length).toBeGreaterThan(0);
    expect(req.street_cells_m).toBeNull();
    // On-foot distances join the flagged pairs once the walk network is loaded.
    expect(await screen.findByText(/150 m on foot/)).toBeTruthy();
  });

  it("falls back to the streets when the population is still downloading", async () => {
    const log: Log = { spacing: [], xml: [] };
    render(
      <WalkAnalysis
        map={null}
        streetLines={DOC}
        railway={null}
        loadWalk={fakeEngine(log)}
        loadRail={noRail}
        fetchTile={async () => "<osm/>"}
        fetchPeople={async () => ({ status: "loading", reason: "downloading", countries: ["DEU"] })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate walk coverage" }));
    expect(await screen.findByText(/75 % of the walkable streets/)).toBeTruthy();
    expect(screen.getByText(/population of DEU is still downloading/)).toBeTruthy();
    expect(log.coverage!.demand).toBeNull();
    expect(log.coverage!.street_cells_m).toBe(200);
  });

  it("refuses an area larger than the tiles it may load", async () => {
    const far = structuredClone(DOC);
    far.lines[0]!.view.points[3]!.lonlat = [8.5, 51];
    const fetchTile = vi.fn(async () => "<osm/>");
    render(
      <WalkAnalysis
        map={{} as MapLibreMap}
        streetLines={far}
        railway={null}
        loadWalk={fakeEngine({ spacing: [], xml: [] })}
        loadRail={noRail}
        fetchTile={fetchTile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate walk coverage" }));
    expect(await screen.findByText(/at most 64/)).toBeTruthy();
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("asks for a line first", () => {
    render(<WalkAnalysis map={null} streetLines={null} railway={null} loadRail={noRail} />);
    expect(screen.getByText("Draw a street line or a railway with stations first.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Calculate walk coverage" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

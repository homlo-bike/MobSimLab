import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
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
    remove() {}
  },
}));
vi.mock("../src/features/street-lines/mapLayers", () => ({
  HIT_LAYER: "sl-legs-hit",
  ensureLayers: vi.fn(),
  removeLayers: vi.fn(),
  setLineColor: vi.fn(),
  drawLine: vi.fn(),
  drawRoads: vi.fn(),
}));
const drawNoise = vi.fn();
vi.mock("../src/features/noise/mapLayer", () => ({
  drawNoise: (...a: unknown[]) => drawNoise(...a),
  removeNoise: vi.fn(),
  LEGEND: [
    { from_db: 55, color: "#f3c683" },
    { from_db: 60, color: "#e87e4d" },
  ],
}));

import { fmtBand } from "../src/features/noise/NoiseSection";
import { noiseCalculationIn } from "../src/features/noise/plugin";
import { railSources, streetLineSources } from "../src/features/noise/sources";
import type { NoiseEngine, NoiseInput, NoiseView } from "../src/features/noise/types";
import { StreetLineEditor } from "../src/features/street-lines/StreetLineEditor";
import type { LineView, StreetEngine, VehicleProfile } from "../src/features/street-lines/types";
import type { Network, RailView } from "../src/features/railways/types";

const profile: VehicleProfile = {
  mode: "bus",
  height_m: 3.1,
  weight_t: 19,
  length_m: 12,
  max_speed_kmh: 80,
  battery_range_m: 0,
  doors_both_sides: false,
};

function lineView(): LineView {
  const points = (["end_stop", "via", "stop"] as const).map((kind, seq) => ({
    id: seq + 1,
    seq,
    kind,
    name: `P${seq + 1}`,
    lonlat: [7 + seq * 0.002, 50] as [number, number],
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
      to: points[(i + 1) % 3]!.id,
      coords: [p.lonlat, points[(i + 1) % 3]!.lonlat],
      length_m: 144,
      time_s: 36,
      direct_m: 144,
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
    length_m: 432,
    time_s: 108,
  };
}

const RESULT: NoiseView = {
  lden: { threshold_db: 55, typical_m: [31, 38, 46], max_m: 52, max_at: [7.001, 50.0004], probes: 40 },
  lnight: { threshold_db: 50, typical_m: [12, 12, 12], max_m: 15, max_at: null, probes: 40 },
  checks: [
    {
      severity: "info",
      text: "The 55 dB L_den band is widest here: 52 m from the line",
      at: [7.001, 50],
      line: null,
    },
  ],
  image: {
    width: 4,
    height: 2,
    cell_m: 10,
    coordinates: [
      [7, 50.001],
      [7.01, 50.001],
      [7.01, 50],
      [7, 50],
    ],
  },
  input_level: "planned",
};

describe("noise sources", () => {
  it("turns each street line leg into a source with its speed, stops and flows", () => {
    const lines = streetLineSources(lineView(), profile, { day: 6, evening: 3, night: 1 }, false);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.speed_kmh).toBeCloseTo(14.4);
    // Leg 1 runs from the end stop to a via point; leg 2 from the via point to a stop.
    expect(lines[0]!.stops_m).toEqual([0]);
    expect(lines[1]!.stops_m).toEqual([144]);
    expect(lines[0]!.flows.day).toBe(6);
    const trolley = streetLineSources(lineView(), { ...profile, mode: "trolleybus" }, lines[0]!.flows, false);
    expect(trolley[0]!.electric).toBe(true);
  });

  it("turns running tracks into sources with tunnels, viaducts and switches", () => {
    const doc = {
      tracks: [
        { id: 1, use: "running" },
        { id: 2, use: "storage" },
      ],
    } as unknown as Network;
    const track = (id: number) => ({
      id,
      length_m: 1000,
      tracks: 2,
      curves: [],
      ramps: [],
      levels: [
        { from_m: 0, to_m: 300, level: "underground" },
        { from_m: 300, to_m: 600, level: "street" },
        { from_m: 600, to_m: 1000, level: "elevated" },
      ],
      spread_m: [0, 0],
      mode: "metro",
      speed: { max_kmh: 80, time_s: 60, profile: [[0, 80, 0] as [number, number, number], [1000, 80, 70]] },
      centre: [
        [7, 50],
        [7.014, 50],
      ],
      embedded: false,
    });
    const view = {
      tracks: [track(1), track(2)],
      switches: [{ id: 9, track: 1, s0: 400, s1: 440 }],
      modes: {},
      params: { design_speed_kmh: 80, elevated_level_height_m: 7 },
      train_length_m: 120,
    } as unknown as RailView;
    const [l, ...rest] = railSources(doc, view, { day: 10, evening: 6, night: 2 });
    expect(rest).toHaveLength(0);
    expect(l!.flows).toEqual({ day: 20, evening: 12, night: 4 });
    expect(l!.speed).toEqual([
      [0, 5],
      [1000, 70],
    ]);
    expect(l!.ranges).toEqual([
      { from_m: 0, to_m: 300, kind: "underground" },
      { from_m: 600, to_m: 1000, kind: "bridge", height_m: 7 },
      { from_m: 400, to_m: 440, kind: "switch" },
    ]);
  });

  it("formats the band with its range", () => {
    expect(fmtBand(RESULT.lden)).toBe("about 40 m (30–45 m)");
    expect(fmtBand(RESULT.lnight)).toBe("12 m");
  });

  it("is offered where the noise plugin's manifest says", () => {
    expect(noiseCalculationIn("street-line-tool")).toBe(true);
    expect(noiseCalculationIn("railway-tool")).toBe(true);
    expect(noiseCalculationIn("gis")).toBe(true);
    expect(noiseCalculationIn("ferry-tool")).toBe(false);
  });
});

function streetEngine(): StreetEngine {
  const view = lineView();
  return {
    addOsm: vi.fn(),
    rebuild: vi.fn(() => view),
    ready: () => true,
    view: () => view,
    insertPoint: vi.fn(() => view),
    movePoint: vi.fn(() => view),
    deletePoint: vi.fn(() => view),
    clear: vi.fn(() => view),
    setKind: vi.fn(() => view),
    setName: vi.fn(() => view),
    setDepot: vi.fn(() => view),
    clearDepot: vi.fn(() => view),
    optimise: vi.fn(() => view),
    setSettings: vi.fn(() => view),
    setStreetSetups: vi.fn(() => view),
    setLevelCrossings: vi.fn(() => view),
    usableRoads: () => ({ type: "FeatureCollection", features: [] }),
    defaultProfile: (mode) => ({ ...profile, mode }),
    defaultRules: () => ({
      traffic_side: "right",
      detour_warn_m: 500,
      detour_warn_ratio: 0.25,
      grouping_distance_m: 150,
      max_snap_m: 150,
    }),
    dispose: vi.fn(),
  };
}

describe("noise band in the street line tool", () => {
  it("estimates the drawn line when the toggle is on and adds its checks", async () => {
    const estimate = vi.fn<(input: NoiseInput) => NoiseView>(() => RESULT);
    const noise: NoiseEngine = { estimate, image: vi.fn(() => new Uint8Array(32)), dispose: vi.fn() };
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getZoom: () => 15,
      getBounds: () => ({ getWest: () => 7, getSouth: () => 50, getEast: () => 7.01, getNorth: () => 50.01 }),
      getSource: () => undefined,
      getLayer: () => undefined,
      queryRenderedFeatures: () => [],
      getCanvas: () => ({ style: {} }),
    } as unknown as MapLibreMap;
    render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => streetEngine()}
        fetchTile={async () => "<osm/>"}
        loadNoise={async () => noise}
        noiseAvailable
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Noise")).toBeTruthy());
    expect(estimate).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByLabelText("Show noise band")));
    await waitFor(() => expect(estimate).toHaveBeenCalled(), { timeout: 2000 });
    const input = estimate.mock.calls.at(-1)![0];
    expect(input.lines).toHaveLength(3);
    expect(input.lines[0]!.flows.day).toBe(6);
    await waitFor(() => expect(screen.getByText("about 40 m (30–45 m)")).toBeTruthy());
    expect(screen.getByText(/Noise: The 55 dB L_den band is widest here/)).toBeTruthy();
    expect(drawNoise).toHaveBeenCalled();
    // Night service changes the estimate.
    const night = screen.getByLabelText("Night 23–07");
    await act(async () => fireEvent.change(night, { target: { value: "4" } }));
    await waitFor(() => expect(estimate.mock.calls.at(-1)![0].lines[0]!.flows.night).toBe(4), {
      timeout: 2000,
    });
  });
});

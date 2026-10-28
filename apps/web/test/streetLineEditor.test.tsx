import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("maplibre-gl", () => ({
  Marker: class {
    setLngLat() {
      return this;
    }
    setRotation() {
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

import {
  depotTripsToGeoJson,
  formatLength,
  formatTime,
  legsToGeoJson,
} from "../src/features/street-lines/geojson";
import { DEFAULT_TIMING } from "../src/features/street-lines/modes";
import { StreetLineEditor } from "../src/features/street-lines/StreetLineEditor";
import { along, circuitPath, lineChecks, lineStats } from "../src/features/street-lines/summary";
import { tilesFor, tileX, tileY } from "../src/features/street-lines/tiles";
import type { LineView, PointKind, StreetEngine, VehicleProfile } from "../src/features/street-lines/types";

function sampleView(kinds: PointKind[]): LineView {
  const points = kinds.map((kind, seq) => ({
    id: seq + 1,
    seq,
    kind,
    name: `Street ${seq + 1}`,
    lonlat: [7 + seq * 0.001, 50] as [number, number],
    status: "ok" as const,
    message: null,
    bearing_deg: 90,
    bay: null,
  }));
  const legs = points.map((p, i) => ({
    index: i,
    from: p.id,
    to: points[(i + 1) % points.length]!.id,
    coords: [p.lonlat, points[(i + 1) % points.length]!.lonlat],
    length_m: 400,
    time_s: 60,
    direct_m: 400,
    status: i === 1 ? ("warning" as const) : ("ok" as const),
    message: i === 1 ? "Turning round adds 900 m" : null,
    ways: [1],
  }));
  return {
    points,
    legs,
    directions: [{ direction: 0, stops: [1, 3], legs: [0, 1], length_m: 800, time_s: 120 }],
    station_groups: [],
    depot: null,
    depot_trips: [],
    issues: [],
    length_m: 400 * points.length,
    time_s: 60 * points.length,
  };
}

function fakeEngine(): StreetEngine {
  let view = sampleView([]);
  let built = false;
  const profile: VehicleProfile = {
    mode: "bus",
    height_m: 3.1,
    weight_t: 19,
    length_m: 12,
    max_speed_kmh: 80,
    battery_range_m: 0,
    doors_both_sides: false,
  };
  const update = (kinds: PointKind[]) => (view = sampleView(kinds));
  return {
    addOsm: vi.fn(),
    rebuild: vi.fn(() => {
      built = true;
      return update(["end_stop", "via", "stop"]);
    }),
    ready: () => built,
    view: () => view,
    insertPoint: vi.fn(() => update([...view.points.map((p) => p.kind), "via"])),
    movePoint: vi.fn(() => view),
    deletePoint: vi.fn(() => update(["end_stop", "stop"])),
    clear: vi.fn(() => update([])),
    setKind: vi.fn((id: number, kind: PointKind) =>
      update(view.points.map((p) => (p.id === id ? kind : p.kind))),
    ),
    setName: vi.fn(() => view),
    setDepot: vi.fn(() => view),
    clearDepot: vi.fn(() => view),
    optimise: vi.fn(() => view),
    setSettings: vi.fn(() => view),
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

/** A map at Monaco with only what the editor touches. */
function fakeMap(zoom: number) {
  const handlers = new Map<string, (ev: unknown) => void>();
  const map = {
    on: (t: string, f: (ev: unknown) => void) => handlers.set(t, f),
    off: (t: string) => handlers.delete(t),
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => 7.41,
      getSouth: () => 43.73,
      getEast: () => 7.42,
      getNorth: () => 43.735,
    }),
    getSource: () => undefined,
    getLayer: () => undefined,
    queryRenderedFeatures: () => [],
    getCanvas: () => ({ style: {} as CSSStyleDeclaration }),
  };
  return { map: map as unknown as MapLibreMap, handlers };
}

async function opened(zoom = 15) {
  const engine = fakeEngine();
  const fetchTile = vi.fn(async (x: number, y: number) => `<osm tile="${x}/${y}"/>`);
  const { map, handlers } = fakeMap(zoom);
  render(<StreetLineEditor map={map} loadEngine={async () => engine} fetchTile={fetchTile} />);
  await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeTruthy());
  return { engine, fetchTile, handlers };
}

describe("Street line editor", () => {
  it("loads the streets on screen automatically and routes the line", async () => {
    const { engine, fetchTile } = await opened();
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalledTimes(1));
    expect(fetchTile).toHaveBeenCalledWith(tileX(7.415), tileY(43.733));
    expect(engine.addOsm).toHaveBeenCalledTimes(fetchTile.mock.calls.length);
    expect(screen.getByText("Street 1")).toBeTruthy();
    expect(screen.getByText("Via point 2")).toBeTruthy();
    expect(screen.getByText(/Turning round adds 900 m/)).toBeTruthy();
    expect(screen.queryByText(/OSM XML|Export/)).toBeNull();
  });

  it("asks to zoom in before loading streets", async () => {
    const { fetchTile } = await opened(10);
    expect(await screen.findByText("Zoom in to street level to load streets.")).toBeTruthy();
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("adds a point where the planner clicks", async () => {
    const { engine, handlers } = await opened();
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    act(() => handlers.get("click")!({ lngLat: { lng: 7.415, lat: 43.733 }, point: { x: 10, y: 10 } }));
    expect(engine.insertPoint).toHaveBeenCalledWith(3, [7.415, 43.733], "via");
    expect(screen.getByText("Via point 4")).toBeTruthy();
  });

  it("promotes a via point to a stop and deletes points", async () => {
    const { engine } = await opened();
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Via point 2"));
    const kinds = screen.getByRole("group", { name: "Kind of point 2" });
    fireEvent.click(kinds.querySelectorAll("button")[1]!);
    expect(engine.setKind).toHaveBeenCalledWith(2, "stop");
    expect(screen.getByDisplayValue("Street 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete point 2" }));
    expect(engine.deletePoint).toHaveBeenCalledWith(2);
    expect(screen.queryByText("Street 3")).toBeNull();
  });

  it("re-routes and recolours when the mode changes", async () => {
    const { engine } = await opened();
    fireEvent.click(screen.getByRole("radio", { name: "Trolleybus" }));
    expect(engine.setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "trolleybus" }),
      expect.anything(),
    );
    expect(screen.getByText(/Battery range/)).toBeTruthy();
    expect(screen.getByText(/green: overhead wire/)).toBeTruthy();
  });

  it("switches tools from the palette and the keyboard", async () => {
    await opened();
    const pressed = (name: RegExp) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed(/Add point/)).toBe("true");
    fireEvent.keyDown(window, { key: "v" });
    expect(pressed(/Select and move/)).toBe("true");
    expect(screen.getByRole("note").textContent).toMatch(/Drag a point/);
    fireEvent.click(screen.getByRole("button", { name: /Pan/ }));
    expect(pressed(/Pan/)).toBe("true");
  });
});

describe("Line summary", () => {
  it("counts cycle time and vehicles for the headway", () => {
    const s = lineStats(sampleView(["end_stop", "via", "stop"]), DEFAULT_TIMING);
    expect(s).toMatchObject({ stops: 2, endStops: 1, runMin: 3, layoverMin: 5 });
    expect(s.cycleMin).toBeCloseTo(3 + 40 / 60 + 5);
    expect(s.vehicles).toBe(1);
  });

  it("lists warnings before advice and confirms a clean line", () => {
    const checks = lineChecks(sampleView(["end_stop", "via", "stop"]));
    expect(checks[0]).toMatchObject({ sev: "warn", point: 2 });
    const clean = sampleView(["stop", "stop"]);
    clean.legs.forEach((l) => Object.assign(l, { status: "ok", message: null }));
    const c = lineChecks(clean);
    expect(c[0]!.sev).toBe("ok");
    expect(c.some((x) => /Mark an end stop/.test(x.text))).toBe(true);
  });

  it("follows the circuit for the preview run", () => {
    const c = circuitPath(sampleView(["stop", "stop"]))!;
    expect(c.stops).toHaveLength(2);
    expect(c.length).toBeGreaterThan(0);
    const mid = along(c, c.length / 4);
    expect(mid.at[0]).toBeCloseTo(7.0005, 4);
    expect(Math.round(mid.bearing)).toBe(90);
  });
});

describe("Street tiles and map helpers", () => {
  it("picks the tiles on screen, centre first", () => {
    const t = tilesFor([7.41, 43.73, 7.44, 43.75]);
    expect(t.length).toBeGreaterThan(1);
    expect(t.length).toBeLessThanOrEqual(16);
    expect(tilesFor([-10, 40, 10, 60])).toHaveLength(16);
  });

  it("shows only the chosen depot runs", () => {
    const v = sampleView(["stop", "stop"]);
    v.depot_trips = [1, 2].flatMap((stop) =>
      (["pull_out", "pull_in"] as const).map((kind) => ({
        kind,
        stop,
        coords: [
          [7, 50],
          [7.1, 50],
        ],
        length_m: 1,
        time_s: 1,
        status: "ok" as const,
        message: null,
      })),
    ) as LineView["depot_trips"];
    expect(depotTripsToGeoJson(v, { out: 1, in: 2 }).features).toHaveLength(2);
    expect(legsToGeoJson(v).features).toHaveLength(2);
  });

  it("formats lengths and times", () => {
    expect(formatLength(350.4)).toBe("350 m");
    expect(formatLength(1250)).toBe("1.25 km");
    expect(formatTime(45)).toBe("45 s");
    expect(formatTime(600)).toBe("10 min");
  });
});

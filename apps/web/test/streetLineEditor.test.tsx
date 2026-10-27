import { cleanup, act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("maplibre-gl", () => ({ Marker: class {} }));

import { formatLength, formatTime, legsToGeoJson, lineToGeoJson } from "../src/features/street-lines/geojson";
import { StreetLineEditor } from "../src/features/street-lines/StreetLineEditor";
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
    issues: ["A line needs at least two stops. Promote points to stops."],
    length_m: 1200,
    time_s: 180,
  };
}

function fakeEngine(): StreetEngine {
  let view = sampleView(["end_stop", "via", "stop"]);
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
    bounds: () => [7, 50, 7.01, 50.01],
    stats: () => ({ nodes: 10, arcs: 1234, turn_bans: 5 }),
    view: () => view,
    insertPoint: vi.fn(() => view),
    movePoint: vi.fn(() => view),
    deletePoint: vi.fn(() => update(["end_stop", "stop"])),
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

async function loaded() {
  const engine = fakeEngine();
  render(<StreetLineEditor map={null} loadEngine={async () => engine} />);
  const file = new File(["<osm/>"], "area.osm", { type: "text/xml" });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Road network (OSM XML)"), { target: { files: [file] } });
  });
  await waitFor(() => expect(screen.getByText(/1,234 road links/)).toBeTruthy());
  return engine;
}

describe("Street line editor", () => {
  it("asks for a road network first", () => {
    render(<StreetLineEditor map={null} loadEngine={async () => fakeEngine()} />);
    expect(screen.getByText(/overpass_fetch.py/)).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Tools" })).toBeNull();
  });

  it("lists points, legs, problems and directions after loading", async () => {
    await loaded();
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeTruthy();
    expect(screen.getByText("Street 2")).toBeTruthy();
    expect(screen.getByDisplayValue("Street 1")).toBeTruthy();
    expect(screen.getByText(/Turning round adds 900 m/)).toBeTruthy();
    expect(screen.getByText(/at least two stops/)).toBeTruthy();
    expect(screen.getByText(/Street 1 → Street 3, 2 stops/)).toBeTruthy();
    expect(screen.getByText(/Circuit 1.2 km, 3 min/)).toBeTruthy();
  });

  it("promotes a via point to a stop and deletes points", async () => {
    const engine = await loaded();
    const kinds = screen.getByRole("group", { name: "Kind of point 2" });
    fireEvent.click(kinds.querySelectorAll("button")[1]!);
    expect(engine.setKind).toHaveBeenCalledWith(2, "stop");
    expect(screen.getByDisplayValue("Street 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete point 2" }));
    expect(engine.deletePoint).toHaveBeenCalledWith(2);
    expect(screen.queryByText("Street 3")).toBeNull();
  });

  it("re-routes when the mode changes", async () => {
    const engine = await loaded();
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "trolleybus" } });
    expect(engine.setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "trolleybus" }),
      expect.anything(),
    );
    expect(screen.getByText(/Battery range/)).toBeTruthy();
  });
});

describe("GeoJSON helpers", () => {
  it("exports legs and points with OSM attribution", () => {
    const v = sampleView(["stop", "stop"]);
    expect(legsToGeoJson(v).features).toHaveLength(2);
    const all = lineToGeoJson(v);
    expect(all.features.filter((f) => f.properties.type === "point")).toHaveLength(2);
    expect(all.attribution).toContain("OpenStreetMap contributors");
  });

  it("formats lengths and times", () => {
    expect(formatLength(350.4)).toBe("350 m");
    expect(formatLength(1250)).toBe("1.3 km");
    expect(formatTime(45)).toBe("45 s");
    expect(formatTime(600)).toBe("10 min");
  });
});

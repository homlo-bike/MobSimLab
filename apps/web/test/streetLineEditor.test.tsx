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
import { clearPlaces, publishPlaces } from "../src/features/naming/registry";
import { DEFAULT_TIMING } from "../src/features/street-lines/modes";
import type { SavedStreetLine } from "../src/features/street-lines/saved";
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
    crossing_wait_s: 0,
    level_crossings: [] as LineView["legs"][number]["level_crossings"],
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
    level_crossings: [],
    crossing_wait_s: 0,
  };
}

/** The line view with a regional railway level crossing on its first leg. */
function withCrossing(v: LineView, source: "timetable" | "assumed"): LineView {
  if (!v.legs.length) return v;
  const wait = {
    wait_s: 1.7,
    off_peak_wait_s: 0.8,
    closed_share: 0.086,
    closures_per_hour: 8,
    mean_closure_s: 39,
    peak_hour_s: source === "timetable" ? 8 * 3600 : null,
    source,
  };
  const legs = v.legs.map((l, i) =>
    i === 0
      ? {
          ...l,
          time_s: l.time_s + 1.7,
          crossing_wait_s: 1.7,
          level_crossings: [{ crossing: 0, passes: 1, wait_s: 1.7 }],
        }
      : l,
  );
  return {
    ...v,
    legs,
    time_s: v.time_s + 1.7,
    crossing_wait_s: 1.7,
    level_crossings: [
      {
        ids: ["lc3-1001-0"],
        street: "Station Road",
        modes: ["regional_rail"],
        protection: "barriers",
        lonlat: [7, 50],
        wait,
        passes: 1,
        wait_s: 1.7,
      },
    ],
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
  // Like the engine, keep the level crossings across edits and rebuilds.
  let crossings: "timetable" | "assumed" | null = null;
  const update = (kinds: PointKind[]) => {
    const v = sampleView(kinds);
    return (view = crossings ? withCrossing(v, crossings) : v);
  };
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
    setLevelCrossings: vi.fn((topology: string, closures: string) => {
      crossings = topology ? (closures ? "timetable" : "assumed") : null;
      return update(view.points.map((p) => p.kind));
    }),
    setStreetSetups: vi.fn(() => view),
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

async function opened(zoom = 15, railTopology: unknown = null) {
  const engine = fakeEngine();
  const fetchTile = vi.fn(async (x: number, y: number) => `<osm tile="${x}/${y}"/>`);
  const { map, handlers } = fakeMap(zoom);
  render(
    <StreetLineEditor
      map={map}
      loadEngine={async () => engine}
      fetchTile={fetchTile}
      railTopology={railTopology}
    />,
  );
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

  it("names a new stop after the stop next to it, so they are one stop", async () => {
    const { engine } = await opened();
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Via point 2"));
    fireEvent.click(screen.getByRole("group", { name: "Kind of point 2" }).querySelectorAll("button")[1]!);
    // Point 2 is 71 m from stops 1 and 3, inside the 150 m station distance.
    expect(engine.setName).toHaveBeenCalledWith(2, expect.stringMatching(/^Street [13]$/));
    expect(screen.getByRole("status").textContent).toMatch(/one stop with the stop next to it/);
  });

  it("renames a whole stop group and numbers a name used by a station far away", async () => {
    publishPlaces("rail", [{ id: "rail:9", name: "Harbour", lonlat: [8, 50] }]);
    const { engine } = await opened();
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Street 3"));
    const input = screen.getByRole("textbox", { name: "Name of point 3" });
    fireEvent.change(input, { target: { value: "Harbour" } });
    fireEvent.blur(input);
    // Stop 1 is 142 m from stop 3: one stop, so both take the name.
    expect(engine.setName).toHaveBeenCalledWith(3, "Harbour 2");
    expect(engine.setName).toHaveBeenCalledWith(1, "Harbour 2");
    expect(screen.getByRole("status").textContent).toMatch(
      /already the name of a stop or station 71\.\d km away/,
    );
    clearPlaces();
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

  it("waits at the railway tool's level crossings and uses rail timetable closures when loaded", async () => {
    const topology = { schema: "mobsimlab.rail-topology/1", level_crossings: [] };
    const { engine } = await opened(15, topology);
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    expect(engine.setLevelCrossings).toHaveBeenCalledWith(JSON.stringify(topology), "");
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Level crossings on the line" }).textContent).toMatch(
        /Station Road · Regional rail · barriers/,
      ),
    );
    expect(screen.getByText(/\+1\.7 s per pass \(peak\)/)).toBeTruthy();
    expect(screen.getByText(/assumed service$/)).toBeTruthy();
    expect(screen.getByText(/^Railway: /).textContent).toMatch(
      /Railway: railway tool drawing\. Closures: assumed service\./,
    );
    const closures = JSON.stringify({ schema: "mobsimlab.level-crossing-closures/1", level_crossings: [] });
    const file = new File([closures], "closures.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Load rail timetable closures"), { target: { files: [file] } });
    await waitFor(() =>
      expect(engine.setLevelCrossings).toHaveBeenLastCalledWith(JSON.stringify(topology), closures),
    );
    expect(await screen.findByText(/08:00 busiest hour/)).toBeTruthy();
    expect(screen.getByText(/^Railway: /).textContent).toMatch(/Closures: closures\.json/);
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

describe("Street line saved with the project", () => {
  const saved: SavedStreetLine = {
    name: "Harbour shuttle",
    profile: {
      mode: "trolleybus",
      height_m: 3.4,
      weight_t: 18,
      length_m: 12,
      max_speed_kmh: 60,
      battery_range_m: 5000,
      doors_both_sides: false,
    },
    rules: {
      traffic_side: "right",
      detour_warn_m: 500,
      detour_warn_ratio: 0.25,
      grouping_distance_m: 150,
      max_snap_m: 150,
    },
    timing: { ...DEFAULT_TIMING, headwayMin: 7.5 },
    points: [
      { lonlat: [7.411, 43.731], kind: "end_stop", name: "Harbour" },
      { lonlat: [7.415, 43.733], kind: "via", name: null },
      { lonlat: [7.419, 43.734], kind: "stop", name: null },
    ],
    depot: [7.412, 43.73],
    depotStops: { out: 0, in: 0 },
    view: sampleView(["end_stop", "via", "stop"]),
  };

  it("routes the saved points again once the streets have loaded, without saving on open", async () => {
    const engine = fakeEngine();
    const onSave = vi.fn();
    const { map, handlers } = fakeMap(15);
    const fitBounds = vi.fn();
    Object.assign(map, { fitBounds, jumpTo: vi.fn() });
    render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={async () => "<osm/>"}
        initial={saved}
        onSave={onSave}
      />,
    );
    expect(fitBounds).toHaveBeenCalledWith(
      [
        [7.411, 43.73],
        [7.419, 43.734],
      ],
      expect.objectContaining({ maxZoom: 16 }),
    );
    await waitFor(() => expect(engine.insertPoint).toHaveBeenCalledTimes(3));
    expect(engine.setSettings).toHaveBeenCalledWith(saved.profile, saved.rules);
    expect(engine.insertPoint).toHaveBeenNthCalledWith(1, 0, [7.411, 43.731], "end_stop");
    expect(engine.insertPoint).toHaveBeenNthCalledWith(3, 2, [7.419, 43.734], "stop");
    expect(engine.setName).toHaveBeenCalledWith(1, "Harbour");
    expect(engine.setDepot).toHaveBeenCalledWith([7.412, 43.73]);
    expect(screen.getByDisplayValue("Harbour shuttle")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    // The planner's next change is saved, with the names they gave and the route for the journey planner.
    act(() => handlers.get("click")!({ lngLat: { lng: 7.42, lat: 43.735 }, point: { x: 10, y: 10 } }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const line = onSave.mock.calls[0]![0] as SavedStreetLine;
    expect(line).toMatchObject({ name: "Harbour shuttle", timing: { headwayMin: 7.5 } });
    expect(line.points[0]).toMatchObject({ name: "Harbour" });
    expect(line.points.at(-1)).toMatchObject({ kind: "via", name: null });
    expect(line.view.points).toHaveLength(line.points.length);
  });

  it("saves a new line only once a point is placed", async () => {
    const engine = fakeEngine();
    const onSave = vi.fn();
    const { map, handlers } = fakeMap(15);
    render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={async () => "<osm/>"}
        onSave={onSave}
      />,
    );
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    // The fake engine routes three sample points on the first build; a real one starts empty.
    act(() => handlers.get("click")!({ lngLat: { lng: 7.42, lat: 43.735 }, point: { x: 10, y: 10 } }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});

describe("Line summary", () => {
  it("counts the expected wait at level crossings in the running time", () => {
    const s = lineStats(withCrossing(sampleView(["end_stop", "via", "stop"]), "assumed"), DEFAULT_TIMING);
    expect(s.crossingMin).toBeCloseTo(1.7 / 60);
    expect(s.runMin).toBeCloseTo(3 + 1.7 / 60);
  });

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

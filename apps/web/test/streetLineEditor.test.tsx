import type { SavedDepot } from "../src/features/depots/types";
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
  drawOtherLines: vi.fn(),
}));

import {
  depotTripsToGeoJson,
  formatLength,
  formatTime,
  legsToGeoJson,
} from "../src/features/street-lines/geojson";
import { clearPlaces, publishPlaces } from "../src/features/naming/registry";
import { DEFAULT_TIMING } from "../src/features/street-lines/modes";
import { keepRoutedLegs, lineTiles, type SavedStreetLine } from "../src/features/street-lines/saved";
import { LineList } from "../src/features/street-lines/LineList";
import { dayService, vehicleById, vehiclesFor } from "../src/features/street-lines/service";
import { setProjectServiceDay } from "../src/features/journey-planner/network";
import { StreetLineEditor } from "../src/features/street-lines/StreetLineEditor";
import { lineChecks, lineStats } from "../src/features/street-lines/summary";
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
    setDepotGates: vi.fn(() => view),
    clearDepot: vi.fn(() => view),
    optimise: vi.fn(() => view),
    setSettings: vi.fn(() => view),
    setLevelCrossings: vi.fn((topology: string, closures: string) => {
      crossings = topology ? (closures ? "timetable" : "assumed") : null;
      return update(view.points.map((p) => p.kind));
    }),
    setStreetSetups: vi.fn(() => view),
    setDelayShares: vi.fn(() => view),
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

  it("routes with the project's delays in traffic", async () => {
    const engine = fakeEngine();
    const { map } = fakeMap(15);
    render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={async () => "<osm/>"}
        delays={{ mixed_traffic: 0.4, bus_lane: 0.05 }}
      />,
    );
    await waitFor(() =>
      expect(engine.setDelayShares).toHaveBeenCalledWith({ mixed_traffic: 0.4, bus_lane: 0.05 }),
    );
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

  it("waits at the railway tool's level crossings with the service it assumes", async () => {
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
    expect(screen.queryByText(/Load track topology|Load rail timetable closures/)).toBeNull();
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
    fireEvent.keyDown(window, { key: "d" });
    expect(pressed(/Bus depot/)).toBe("true");
    expect(screen.queryByRole("button", { name: /Preview run/ })).toBeNull();
  });

  it("places the bus depot from the palette", async () => {
    const { engine, handlers } = await opened();
    await waitFor(() => expect(engine.rebuild).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Bus depot/ }));
    expect(screen.getByRole("note").textContent).toMatch(/depot gate/);
    act(() => handlers.get("click")!({ lngLat: { lng: 7.412, lat: 43.73 }, point: { x: 1, y: 1 } }));
    expect(engine.setDepot).toHaveBeenCalledWith([7.412, 43.73]);
    expect(screen.getByRole("button", { name: /Select and move/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the shared depot editor from the palette's Bus depot when the workspace has one", async () => {
    const engine = fakeEngine();
    const { map } = fakeMap(15);
    const onOpenDepots = vi.fn();
    render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={vi.fn(async () => "<osm/>")}
        onOpenDepots={onOpenDepots}
      />,
    );
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Bus depot/ }));
    expect(onOpenDepots).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "d" });
    expect(onOpenDepots).toHaveBeenCalledTimes(2);
    // No line-own depot gate is being placed.
    expect(screen.getByRole("button", { name: /Bus depot/ }).getAttribute("aria-pressed")).toBe("false");
    expect(engine.setDepot).not.toHaveBeenCalled();
  });

  it("shows the mode first, right under the tool choice, and no rules of its own", async () => {
    await opened();
    const mode = screen.getByRole("radiogroup", { name: "Mode" });
    const name = screen.getByDisplayValue("Line 1");
    expect(mode.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Rules")).toBeNull();
    expect(screen.queryByText(/Right-hand|Stops within this distance|Warn when turning round/)).toBeNull();
    expect(screen.getByText("Service")).toBeTruthy();
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

  it("runs to and from a shared depot's gates and saves the depot by id", async () => {
    const engine = fakeEngine();
    const onSave = vi.fn();
    const { map } = fakeMap(15);
    Object.assign(map, { fitBounds: vi.fn(), jumpTo: vi.fn() });
    const ring: [number, number][] = [
      [7.41, 43.729],
      [7.412, 43.729],
      [7.412, 43.7305],
      [7.41, 43.7305],
    ];
    const depot = (modes: SavedDepot["modes"]): SavedDepot => ({
      id: "dp1",
      name: "North depot",
      modes,
      boundary: ring,
      gates: [
        { id: "g1", kind: "entrance", lonlat: [7.411, 43.729] },
        { id: "g2", kind: "exit", lonlat: [7.412, 43.73] },
        { id: "g3", kind: "both", lonlat: [7.41, 43.73] },
      ],
      zones: [],
      layout: null,
    });
    const busOnly: SavedDepot = { ...depot(["bus"]), id: "dp2", name: "Bus depot" };
    render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={async () => "<osm/>"}
        initial={{ ...saved, depot: null }}
        onSave={onSave}
        depots={[depot(["trolleybus", "bus"]), busOnly]}
      />,
    );
    await waitFor(() => expect(engine.insertPoint).toHaveBeenCalledTimes(3));
    const pick = screen.getByRole("combobox", { name: "Depot" }) as HTMLSelectElement;
    // A depot that does not take trolleybuses cannot be chosen.
    const other = [...pick.options].find((o) => o.value === "dp2")!;
    expect(other.disabled).toBe(true);
    expect(other.textContent).toContain("does not take this mode");
    fireEvent.change(pick, { target: { value: "dp1" } });
    await waitFor(() =>
      expect(engine.setDepotGates).toHaveBeenCalledWith(
        [
          [7.412, 43.73],
          [7.41, 43.73],
        ],
        [
          [7.411, 43.729],
          [7.41, 43.73],
        ],
      ),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const line = onSave.mock.calls.at(-1)![0] as SavedStreetLine;
    expect(line).toMatchObject({ depotId: "dp1", depot: null });
    fireEvent.change(pick, { target: { value: "" } });
    expect(engine.clearDepot).toHaveBeenCalled();
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

  it("follows the project's street rules over the rules the line was saved with", async () => {
    const engine = fakeEngine();
    const { map } = fakeMap(15);
    Object.assign(map, { fitBounds: vi.fn(), jumpTo: vi.fn() });
    const projectRules = { traffic_side: "left" as const, grouping_distance_m: 200, detour_warn_m: 300 };
    const { rerender } = render(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={async () => "<osm/>"}
        initial={saved}
        projectRules={projectRules}
      />,
    );
    await waitFor(() =>
      expect(engine.setSettings).toHaveBeenCalledWith(saved.profile, { ...saved.rules, ...projectRules }),
    );
    rerender(
      <StreetLineEditor
        map={map}
        loadEngine={async () => engine}
        fetchTile={async () => "<osm/>"}
        initial={saved}
        projectRules={{ ...projectRules, traffic_side: "right" }}
      />,
    );
    await waitFor(() =>
      expect(engine.setSettings).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ traffic_side: "right", detour_warn_m: 300 }),
      ),
    );
  });
});

describe("Street line vehicle and service", () => {
  it("offers the mode's catalogue vehicles and drives with the chosen one's size and speed", async () => {
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
    const select = (await screen.findByRole("combobox", { name: "Vehicle" })) as HTMLSelectElement;
    expect(select.options).toHaveLength(vehiclesFor("bus").length + 1);
    expect(select.value).toBe("");
    const bus = vehicleById("solaris_urbino-18-gen4")!;
    fireEvent.change(select, { target: { value: bus.id } });
    expect(engine.setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: "bus",
        length_m: bus.length_m,
        height_m: bus.height_m,
        weight_t: bus.weight_t,
        max_speed_kmh: bus.top_speed_kmh,
      }),
      expect.anything(),
    );
    expect(screen.getByTestId("vehicle-facts").textContent).toContain(`${bus.capacity} places`);

    // First and last departure and the off-peak headway are the planner's to change, and saved.
    fireEvent.change(screen.getByLabelText("First departure"), { target: { value: "06:15" } });
    fireEvent.change(screen.getByLabelText("Last departure"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Off-peak headway/ }), {
      target: { value: "15" },
    });
    act(() => handlers.get("click")!({ lngLat: { lng: 7.42, lat: 43.735 }, point: { x: 10, y: 10 } }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const line = onSave.mock.calls.at(-1)![0] as SavedStreetLine;
    expect(line.vehicle).toBe(bus.id);
    expect(line.timing).toMatchObject({
      firstMin: 375,
      lastMin: 1380,
      offPeakHeadwayMin: 15,
      headwayMin: 10,
    });

    // Another mode starts again from its typical vehicle.
    fireEvent.click(screen.getByRole("radio", { name: "Trolleybus" }));
    expect(select.value).toBe("");
  });

  it("starts a new line at 05:00 to 00:30 and flags a last departure before the first", async () => {
    await opened();
    expect((screen.getByLabelText("First departure") as HTMLInputElement).value).toBe("05:00");
    expect((screen.getByLabelText("Last departure") as HTMLInputElement).value).toBe("24:30");
    fireEvent.change(screen.getByLabelText("Last departure"), { target: { value: "04:00" } });
    expect(screen.getByRole("list", { name: "Checks" }).textContent).toContain(
      "The last departure must be after the first.",
    );
  });

  it("counts trips and vehicle-hours over the peaks and off peak", () => {
    const t = { ...DEFAULT_TIMING, headwayMin: 10, offPeakHeadwayMin: 20 };
    // 05:00–00:30: peaks 07–09 and 16–19 (30 departures), off peak 6 + 21 + 17; a 25 min circuit needs 3
    // vehicles in the peaks and 2 off peak.
    const d = dayService(t, 25);
    expect([d.serviceHours, d.tripsPerDay]).toEqual([19.5, 148]);
    expect(d.vehicleHours).toBeCloseTo(3 * 5 + 2 * 14.5, 2);
  });

  it("uses the project's weekday peaks when the workspace sets them", () => {
    const t = { ...DEFAULT_TIMING, headwayMin: 10, offPeakHeadwayMin: 20 };
    // One peak, 07:00–10:00: 3 h at three vehicles, 16.5 h at two.
    setProjectServiceDay({ firstS: 5 * 3600, lastS: 24.5 * 3600, peaks: [[7 * 3600, 10 * 3600]] });
    try {
      expect(dayService(t, 25).vehicleHours).toBeCloseTo(3 * 3 + 2 * 16.5, 2);
    } finally {
      setProjectServiceDay(null);
    }
    expect(dayService(t, 25).vehicleHours).toBeCloseTo(3 * 5 + 2 * 14.5, 2);
  });
});

describe("Street line list", () => {
  it("switches lines, starts a new one and asks before deleting", () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    const onDelete = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <LineList
        names={["Line 1", "Harbour"]}
        current={1}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={onDelete}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "0" } });
    expect(onSelect).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "New line" }));
    expect(onNew).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete line" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Harbour"));
    expect(onDelete).toHaveBeenCalledWith(1);
    confirm.mockRestore();
  });

  it("shows a new line not drawn yet and offers no delete for it", () => {
    render(<LineList names={["Line 1"]} current={1} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("1");
    expect(screen.getByRole("option", { name: "New line (not drawn yet)" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete line" }) as HTMLButtonElement).disabled).toBe(true);
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

describe("a saved street route", () => {
  it("keeps a leg's saved route when routing it again fails for want of streets", () => {
    const saved = sampleView(["end", "via", "end"]);
    saved.legs[0]!.coords = [saved.points[0]!.lonlat, [7.0005, 50.0004], saved.points[1]!.lonlat];
    saved.legs[0]!.length_m = 520;
    // Routed again with the first leg's streets not loaded: straight and in error.
    const again = structuredClone(saved);
    again.legs[0] = { ...again.legs[0]!, coords: [again.points[0]!.lonlat, again.points[1]!.lonlat], status: "error", message: "No route", length_m: 0, time_s: 0 };
    again.issues = ["No route"];
    again.length_m -= 520;
    const kept = keepRoutedLegs(again, saved);
    expect(kept.legs[0]!.status).toBe("ok");
    expect(kept.legs[0]!.coords).toHaveLength(3);
    expect(kept.length_m).toBe(saved.length_m);
    expect(kept.issues).toEqual([]);
  });

  it("does not bring back the old route of a point that moved", () => {
    const saved = sampleView(["end", "via", "end"]);
    const moved = structuredClone(saved);
    moved.points[1]!.lonlat = [7.5, 50.5];
    moved.legs[0] = { ...moved.legs[0]!, status: "error", message: "No route" };
    expect(keepRoutedLegs(moved, saved).legs[0]!.status).toBe("error");
  });

  it("loads the tiles under the whole line, not only those on screen", () => {
    const view = sampleView(["end", "end"]);
    view.legs[0]!.coords = [[7, 50], [7.2, 50]];
    const keys = lineTiles({ points: view.points.map((p) => ({ lonlat: p.lonlat, kind: p.kind, name: null })), depot: null, view } as unknown as SavedStreetLine);
    expect(keys).toContain(`${tileX(7.2)}/${tileY(50)}`);
    expect(keys).toContain(`${tileX(7)}/${tileY(50)}`);
  });
});

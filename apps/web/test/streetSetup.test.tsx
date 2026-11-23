import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strips, stripsFromLanes } from "../src/features/street-setup/CrossSection";
import {
  effective,
  forgetSetups,
  loadSetups,
  parsePeakCars,
  peakCarsDefault,
  upsert,
  verdicts,
} from "../src/features/street-setup/model";
import type { LaneEngine, LaneEngineLoader, LaneGeometry } from "../src/features/street-setup/lanes";
import { StreetSetupEditor } from "../src/features/street-setup/StreetSetupEditor";
import { LanesBackdrop } from "../src/features/street-setup/LanesBackdrop";
import {
  layoutOf,
  newSection,
  sectionName,
  sectionsFromLanes,
  template,
  totalWidth,
} from "../src/features/street-setup/sections";
import type { JunctionSetup, StreetInfo, StreetSetup } from "../src/features/street-setup/types";
import { addsToSelection, toggleSelection } from "../src/features/street-setup/selection";
import { busDirections, drivenDirections, reroutedLines } from "../src/features/street-setup/reroutes";
import type { LegView, LineView } from "../src/features/street-lines/types";

afterEach(cleanup);

const HIGH: StreetInfo = {
  way: 100,
  name: "High Street",
  class: "primary",
  main_road: true,
  oneway: false,
  lanes: 2,
  width_m: null,
  maxspeed_kmh: 50,
  bus_lane: false,
  bike_lane: false,
  tram: true,
  coords: [
    [7.414, 43.733],
    [7.416, 43.733],
  ],
};
const BACK: StreetInfo = {
  ...HIGH,
  way: 200,
  name: "Back Lane",
  class: "residential",
  main_road: false,
  tram: false,
};

describe("Street sections", () => {
  it("reduces a layout to what routing reads, like the Rust engine", () => {
    const centre = layoutOf(template("centreBus"));
    expect(centre).toMatchObject({
      carsForward: 2,
      carsBackward: 2,
      busLanes: 2,
      separated: true,
      tram: false,
    });
    // The same bus lanes painted next to the cars are not separated.
    const painted = layoutOf([
      newSection("lane", ["car"], "backward"),
      newSection("lane", ["bus"], "backward"),
      newSection("lane", ["bus"], "forward"),
      newSection("lane", ["car"], "forward"),
    ]);
    expect(painted.separated).toBe(false);
    const tram = layoutOf(template("tramPeople"));
    expect(tram).toMatchObject({
      carsForward: 0,
      carsBackward: 0,
      busForward: false,
      tram: true,
      tramOwnLane: true,
    });
    expect(layoutOf(template("tramBus"))).toMatchObject({ tramOwnLane: true, busLanes: 2 });
    // A tram sharing a lane with cars runs in mixed traffic.
    expect(
      layoutOf([newSection("lane", ["car", "tram"], "backward"), newSection("lane", ["tram"], "forward")])
        .tramOwnLane,
    ).toBe(false);
  });

  it("names sections by who uses them", () => {
    expect(sectionName(newSection("lane"))).toEqual({ key: "new" });
    expect(sectionName(newSection("lane", ["bus"]))).toEqual({ key: "one", user: "bus" });
    expect(sectionName(newSection("lane", ["bus", "car", "taxi"]))).toEqual({ key: "general" });
    expect(sectionName(newSection("lane", ["walk", "bike"]))).toEqual({ key: "shared" });
    expect(sectionName(newSection("lane", ["tram", "car"]))).toEqual({
      key: "mixed",
      users: ["car", "tram"],
    });
    expect(sectionName(newSection("green"))).toEqual({ key: "green" });
    expect(newSection("green").style).toBe("trees");
  });

  it("starts a custom layout from the street's lanes", () => {
    const s = sectionsFromLanes([
      { kind: "pavement", dir: "backward", width: 2.04, rails: false },
      { kind: "kerb", dir: "backward", width: 0.1, rails: false },
      { kind: "traffic", dir: "backward", width: 3.25, rails: true },
      { kind: "bus", dir: "forward", width: 3.3, rails: false },
      { kind: "green", dir: "forward", width: 2, rails: false },
    ]);
    expect(s.map((x) => [x.kind, x.users, x.dir ?? null, x.width])).toEqual([
      ["lane", ["walk"], null, 2],
      ["protection", [], null, 0.3],
      ["lane", ["car", "bus", "taxi", "bike", "tram"], "backward", 3.3],
      ["lane", ["bus", "taxi"], "forward", 3.3],
      ["green", [], null, 2],
    ]);
    expect(totalWidth(s)).toBeCloseTo(10.9);
  });

  it("gives a custom layout's street its values", () => {
    const e = effective(HIGH, { way: 100, sections: template("protectedBike") });
    expect(e).toMatchObject({
      oneway: false,
      trafficLanes: 2,
      busLane: false,
      bikeLane: true,
      separated: true,
    });
    expect(verdicts(HIGH, e).map((v) => v.who)).toEqual(["Cars", "Buses"]);
    const oneWay = effective(HIGH, { way: 100, sections: [newSection("lane", ["car"], "backward")] });
    expect(oneWay.oneway).toBe(true);
  });
});

describe("Street setup model", () => {
  it("takes each value from the setup, else from OpenStreetMap", () => {
    const e = effective(HIGH, undefined);
    expect(e).toMatchObject({
      trafficLanes: 2,
      busLane: false,
      bikeLane: false,
      separated: false,
      tram: null,
    });
    expect(effective({ ...HIGH, lanes: 4, bus_lane: true }, undefined).trafficLanes).toBe(2);
    expect(effective(HIGH, { way: 100, traffic_lanes: 4, bus_lane: true, tram: "own_lane" })).toMatchObject({
      trafficLanes: 4,
      busLane: true,
      tram: "own_lane",
    });
  });

  it("warns for a tram and buses in main-road traffic, and a separated own lane resolves it", () => {
    const mixed = verdicts(HIGH, effective(HIGH, { way: 100, tram: "mixed" }));
    expect(mixed.filter((v) => v.level === "warning").map((v) => v.who)).toEqual([
      "Buses",
      "Trams",
      "Cyclists",
    ]);
    const fixed = verdicts(
      HIGH,
      effective(HIGH, { way: 100, tram: "own_lane", bus_lane: true, separated: true, bike_lane: true }),
    );
    expect(fixed.every((v) => v.level === "ok")).toBe(true);
    const painted = verdicts(HIGH, effective(HIGH, { way: 100, tram: "own_lane" }));
    expect(painted.find((v) => v.who === "Trams")).toMatchObject({ level: "info" });
    // The project's preferences change the delay the texts quote.
    const project = verdicts(HIGH, effective(HIGH, undefined), { mixed_traffic: 0.4, bus_lane: 0.05 });
    expect(project.find((v) => v.who === "Buses")?.text).toMatch(/about 40 % longer/);
  });

  it("draws the cross-section kerb to kerb", () => {
    const e = effective(HIGH, {
      way: 100,
      tram: "own_lane",
      separated: true,
      bus_lane: true,
      bike_lane: true,
    });
    expect(strips(e, false).every((s) => s.width === undefined)).toBe(true);
    expect(strips(e, false).map((s) => s.kind)).toEqual([
      "walk",
      "bike",
      "kerb",
      "bus",
      "kerb",
      "car",
      "kerb",
      "tram",
      "kerb",
      "car",
      "kerb",
      "bus",
      "kerb",
      "bike",
      "walk",
    ]);
  });

  it("takes the street's own lanes, widths and rails when the lane engine has them", () => {
    const list = stripsFromLanes([
      { kind: "footway", dir: "backward", width: 2, rails: false },
      { kind: "kerb", dir: "backward", width: 0.1, rails: false },
      { kind: "tram", dir: "backward", width: 3.1, rails: true },
      { kind: "traffic", dir: "forward", width: 3.2, rails: false },
      { kind: "construction", dir: "forward", width: 1, rails: false },
    ]);
    expect(list).toEqual([
      { kind: "walk", dir: "down", width: 2, rails: false },
      { kind: "kerb", dir: "down", width: 0.1, rails: false },
      { kind: "tram", dir: "down", width: 3.1, rails: true },
      { kind: "car", dir: "up", width: 3.2, rails: false },
      { kind: "buffer", dir: "up", width: 1, rails: false },
    ]);
  });

  it("keeps one setup per street and drops empty ones", () => {
    let list = upsert([], { way: 1, bus_lane: true });
    list = upsert(list, { way: 1, bus_lane: true, bike_lane: true });
    expect(list).toEqual([{ way: 1, bus_lane: true, bike_lane: true }]);
    expect(upsert(list, { way: 1, bus_lane: null, bike_lane: null })).toEqual([]);
    // Setups an older release kept in this browser are read once, then forgotten.
    window.localStorage.setItem("mobsimlab.streetSetups.p1", JSON.stringify(list));
    expect(loadSetups("p1")).toEqual(list);
    expect(loadSetups("other")).toEqual([]);
    forgetSetups("p1");
    expect(loadSetups("p1")).toEqual([]);
  });

  it("takes traffic peaks from the setup, else the default for the road type", () => {
    expect(effective(HIGH, undefined)).toMatchObject({ carsMorningPeak: 900, carsEveningPeak: 900 });
    expect(effective(BACK, undefined).carsMorningPeak).toBe(50);
    expect(peakCarsDefault("trunk_link")).toBe(1500);
    expect(peakCarsDefault("secondary")).toBe(600);
    expect(peakCarsDefault("tertiary")).toBe(300);
    expect(peakCarsDefault("busway")).toBe(0);
    expect(effective(HIGH, { way: 100, cars_morning_peak: 1200, cars_evening_peak: 0 })).toMatchObject({
      carsMorningPeak: 1200,
      carsEveningPeak: 0,
    });
    // A street with only traffic peaks set is kept; clearing them drops it.
    expect(upsert([], { way: 1, cars_evening_peak: 400 })).toEqual([{ way: 1, cars_evening_peak: 400 }]);
    expect(upsert([], { way: 1, cars_evening_peak: null })).toEqual([]);
    expect(parsePeakCars("")).toBeNull();
    expect(parsePeakCars("-5")).toBeNull();
    expect(parsePeakCars("812.6")).toBe(813);
    expect(parsePeakCars("99999")).toBe(8000);
  });
});

/** A map with only what the editor touches. */
function fakeMap(zoom = 16) {
  const handlers = new Map<string, Set<(ev: unknown) => void>>();
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();
  const hit = { way: null as number | null, junction: null as string | null };
  const map = {
    on: (t: string, f: (ev: unknown) => void) => handlers.set(t, (handlers.get(t) ?? new Set()).add(f)),
    off: (t: string, f: (ev: unknown) => void) => handlers.get(t)?.delete(f),
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => 7.41,
      getSouth: () => 43.73,
      getEast: () => 7.42,
      getNorth: () => 43.735,
    }),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (l: { id: string }) => layers.add(l.id),
    removeLayer: (id: string) => layers.delete(id),
    moveLayer: vi.fn(),
    setFilter: vi.fn(),
    setLayerZoomRange: vi.fn(),
    easeTo: vi.fn(),
    boxZoom: { disable: vi.fn(), enable: vi.fn() },
    queryRenderedFeatures: (_at: unknown, o?: { layers?: string[] }) =>
      o?.layers?.includes("ss-junctions")
        ? hit.junction === null
          ? []
          : [{ properties: { key: hit.junction, crossing: true } }]
        : hit.way === null
          ? []
          : [{ properties: { way: hit.way } }],
  };
  const click = (shiftKey: boolean) =>
    act(() => {
      for (const f of handlers.get("click") ?? [])
        f({ point: { x: 5, y: 5 }, lngLat: { lng: 7.415, lat: 43.733 }, originalEvent: { shiftKey } });
    });
  const tap = (way: number | null) => {
    hit.way = way;
    hit.junction = null;
    click(false);
  };
  /** A click on a street with Shift held: it adds the street to the selection, or takes it out. */
  const tapShift = (way: number) => {
    hit.way = way;
    hit.junction = null;
    click(true);
  };
  /** A click on the junction with this key; with Shift held, it adds to the selection. */
  const tapJunction = (key: string, shift = false) => {
    hit.junction = key;
    click(shift);
  };
  return {
    map: map as unknown as MapLibreMap,
    sources,
    tap,
    tapShift,
    tapJunction,
    setFilter: map.setFilter,
    setLayerZoomRange: map.setLayerZoomRange,
    boxZoom: map.boxZoom,
  };
}

const NO_LANES: LaneEngineLoader = async () => null;

function Harness({
  map,
  onChange,
  loadLanes = NO_LANES,
  trafficSide = "right",
  onJunctionsChange,
  streetLines,
  initialJunctions = [],
}: {
  initialJunctions?: JunctionSetup[];
  map: MapLibreMap;
  onChange: (s: StreetSetup[]) => void;
  loadLanes?: LaneEngineLoader;
  trafficSide?: "right" | "left";
  onJunctionsChange?: (j: JunctionSetup[]) => void;
  streetLines?: { name: string; view: LineView }[];
}) {
  const [setups, setSetups] = useState<StreetSetup[]>([]);
  const [junctions, setJunctions] = useState<JunctionSetup[]>(initialJunctions);
  return (
    <StreetSetupEditor
      map={map}
      setups={setups}
      onChange={(s) => {
        setSetups(s);
        onChange(s);
      }}
      fetchTile={async () => "<osm/>"}
      loadInfos={async () => () => [HIGH, BACK]}
      loadLanes={loadLanes}
      trafficSide={trafficSide}
      streetLines={streetLines}
      junctions={junctions}
      onJunctionsChange={(j) => {
        setJunctions(j);
        onJunctionsChange?.(j);
      }}
    />
  );
}

describe("Selecting several things on the map", () => {
  it("adds or takes out with Shift, Ctrl or Cmd, else selects only the one clicked", () => {
    const key = (x: { id: number }) => x.id;
    const a = { id: 1 };
    const b = { id: 2 };
    expect(addsToSelection({ shiftKey: true })).toBe(true);
    expect(addsToSelection({ metaKey: true })).toBe(true);
    expect(addsToSelection({})).toBe(false);
    expect(addsToSelection(undefined)).toBe(false);
    expect(toggleSelection([a], b, key, false)).toEqual([b]);
    expect(toggleSelection([a], b, key, true)).toEqual([a, b]);
    expect(toggleSelection([a, b], a, key, true)).toEqual([b]);
  });
});

describe("Street setup editor", () => {
  it("loads the streets on screen, sets up a tapped street and shows what it means", async () => {
    const { map, sources, tap } = fakeMap();
    const onChange = vi.fn();
    render(<Harness map={map} onChange={onChange} />);
    await waitFor(() => expect(sources.get("ss-streets")!.setData).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading streets…")).toBeNull());
    tap(100);
    const form = screen.getByRole("region", { name: "Street setup: High Street" });
    expect(within(form).getByText(/Mixed traffic on a main road|Inferred from the street/)).toBeTruthy();
    expect(within(form).getByText(/Buses and trolleybuses run in the traffic of a main road/)).toBeTruthy();

    // OpenStreetMap's lanes until the planner customises the street: then a typical layout of it.
    const layout = screen.getByRole("group", { name: "Street layout" });
    expect(within(layout).getByRole("button", { name: "OSM default" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Customise this street" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        way: 100,
        sections: [
          expect.objectContaining({ kind: "lane", users: ["walk"] }),
          expect.objectContaining({ users: ["car", "bus", "taxi", "bike"], dir: "backward" }),
          expect.objectContaining({ users: ["car", "bus", "taxi", "bike"], dir: "forward" }),
          expect.objectContaining({ kind: "lane", users: ["walk"] }),
        ],
      }),
    ]);
    expect(within(form).getByText("Lanes: 1 ↑ with the street, 1 ↓ against it.")).toBeTruthy();

    // A template: bus lanes in the middle behind kerbs, so buses are not held up.
    fireEvent.click(screen.getByRole("button", { name: "Centre bus lanes" }));
    expect(within(form).getByText(/Separated bus lane/)).toBeTruthy();
    const strip = screen.getByRole("listbox", { name: "Sections, left to right" });
    expect(within(strip).getAllByRole("option")).toHaveLength(11);

    // Add a section after the first one and make it a tram lane both ways: a tram in its own lane.
    fireEvent.click(screen.getByRole("button", { name: "+ Add section" }));
    const picked = screen.getByRole("region", { name: "Selected section: New section" });
    expect(within(picked).getByText("2 of 12")).toBeTruthy();
    fireEvent.click(within(picked).getByRole("button", { name: "Trams" }));
    expect(screen.getByRole("region", { name: "Selected section: Tram lane" })).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Direction" })).getByRole("button", { name: "↕ Both" }),
    );
    let last = onChange.mock.lastCall![0][0] as StreetSetup;
    expect(last.sections![1]).toMatchObject({ kind: "lane", users: ["tram"], dir: "both" });
    // Buses may share it: mixed traffic of trams and buses, still no cars.
    fireEvent.click(
      within(screen.getByRole("group", { name: "Who can use it?" })).getByRole("button", { name: "Buses" }),
    );
    expect(screen.getByRole("region", { name: "Selected section: Buses + Trams" })).toBeTruthy();
    // Move it next to the centre, then remove it again.
    fireEvent.click(screen.getByRole("button", { name: "Move right" }));
    last = onChange.mock.lastCall![0][0] as StreetSetup;
    expect(last.sections![2]).toMatchObject({ users: ["tram", "bus"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect((onChange.mock.lastCall![0][0] as StreetSetup).sections).toHaveLength(11);

    // Trams and people only: no cars and no buses on the street.
    fireEvent.click(screen.getByRole("button", { name: "Trams and people only" }));
    expect(within(form).getByText(/No lane for cars/)).toBeTruthy();
    expect(within(form).getByText(/No lane lets buses in/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Traffic at peak" })).toBeNull();
    // Back to OpenStreetMap's lanes.
    fireEvent.click(within(layout).getByRole("button", { name: "OSM default" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Customise this street" }));
    expect(screen.getByText("Streets set up · 1")).toBeTruthy();

    // Traffic peaks: empty shows the road type's default; a typed value is saved per direction.
    const traffic = screen.getByRole("group", { name: "Traffic at peak" });
    expect(within(traffic).getByText(/Empty: 900, the default/)).toBeTruthy();
    const morning = within(traffic).getByLabelText(/Morning peak, 7:00–9:00/) as HTMLInputElement;
    expect(morning.placeholder).toBe("900");
    fireEvent.change(morning, { target: { value: "1200" } });
    fireEvent.change(within(traffic).getByLabelText(/Evening peak, 16:00–19:00/), {
      target: { value: "1400" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ way: 100, cars_morning_peak: 1200, cars_evening_peak: 1400 }),
    ]);
    expect(screen.getByText(/1200 cars\/h morning · 1400 cars\/h evening/)).toBeTruthy();
    fireEvent.change(morning, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ cars_morning_peak: null })]);

    fireEvent.click(screen.getByRole("button", { name: "Reset to OpenStreetMap" }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    tap(null);
    expect(screen.getByText(/No street selected/)).toBeTruthy();
  });

  it("draws the lanes of the streets on screen and redraws them when a setup changes", async () => {
    const { map, sources, tap, setLayerZoomRange } = fakeMap();
    const shapes: LaneGeometry = {
      lanes: [
        {
          kind: "bus",
          way: 100,
          layer: 0,
          ring: [7.411, 43.731, 7.412, 43.731, 7.412, 43.732, 7.411, 43.731],
        },
      ],
      junctions: [
        {
          ring: [7.412, 43.731, 7.413, 43.731, 7.413, 43.732, 7.412, 43.731],
          nodes: [1],
          ways: [100],
          crossing: true,
          signals: false,
        },
      ],
      lines: [{ kind: "centre", layer: 0, path: [7.411, 43.731, 7.412, 43.731] }],
      roads: [
        {
          way: 100,
          lanes: [
            { kind: "pavement", dir: "backward", width: 1.5, rails: false },
            { kind: "parking", dir: "backward", width: 2.5, rails: false },
            { kind: "traffic", dir: "backward", width: 3, rails: true },
            { kind: "traffic", dir: "forward", width: 3, rails: true },
            { kind: "bus", dir: "forward", width: 3.05, rails: false },
            { kind: "pavement", dir: "forward", width: 1.5, rails: false },
          ],
        },
      ],
      driving_side: "right",
    };
    const engine = {
      addTile: vi.fn(),
      build: vi.fn(async () => shapes),
      dispose: vi.fn(),
    } satisfies LaneEngine;
    const { unmount } = render(
      <Harness map={map} onChange={() => {}} loadLanes={async () => engine} trafficSide="left" />,
    );
    await waitFor(() => expect(engine.build).toHaveBeenCalled());
    // Every loaded tile goes to the engine, and the tiles on screen are built.
    const keys = engine.addTile.mock.calls.map((c) => c[0]);
    expect(keys.length).toBeGreaterThan(0);
    expect(engine.addTile).toHaveBeenCalledWith(keys[0], "<osm/>");
    // Traffic keeps to the project's side (Project preferences).
    expect(engine.build).toHaveBeenLastCalledWith(keys, [], "left");
    await waitFor(() => expect(sources.get("ss-lanes")!.setData).toHaveBeenCalled());
    const drawn = sources.get("ss-lanes")!.setData.mock.lastCall![0];
    expect(drawn.features[0]).toMatchObject({
      properties: { kind: "bus", way: 100 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [7.411, 43.731],
            [7.412, 43.731],
            [7.412, 43.732],
            [7.411, 43.731],
          ],
        ],
      },
    });
    expect(sources.get("ss-junctions")!.setData.mock.lastCall![0].features).toHaveLength(1);
    expect(sources.get("ss-lane-markings")!.setData.mock.lastCall![0].features[0].properties.kind).toBe(
      "centre",
    );
    // The street lines make way for the lanes from zoom 16.
    expect(setLayerZoomRange).toHaveBeenCalledWith("ss-streets", 0, 16);
    expect(screen.getByText("Lanes, from zoom 16")).toBeTruthy();

    // The cross-section shows the street's own lanes, at their widths.
    tap(100);
    const section = screen.getByRole("img", { name: /^Cross-section/ });
    expect(section.getAttribute("aria-label")).toBe(
      "Cross-section: pavement, parking lane, traffic lane, traffic lane, bus lane, pavement",
    );
    expect((section.children[1] as HTMLElement).style.flex).toMatch(/^2\.5 1 0/);

    // Customising starts from the street's own lanes, and the layout is drawn on the map.
    fireEvent.click(screen.getByRole("button", { name: "Customise this street" }));
    await waitFor(() =>
      expect(engine.build).toHaveBeenLastCalledWith(
        keys,
        [
          expect.objectContaining({
            way: 100,
            sections: [
              expect.objectContaining({ users: ["walk"], width: 1.5 }),
              expect.objectContaining({ kind: "parking", width: 2.5 }),
              expect.objectContaining({ users: ["car", "bus", "taxi", "bike", "tram"], dir: "backward" }),
              expect.objectContaining({ users: ["car", "bus", "taxi", "bike", "tram"], dir: "forward" }),
              expect.objectContaining({ users: ["bus", "taxi"], dir: "forward", width: 3.1 }),
              expect.objectContaining({ users: ["walk"] }),
            ],
          }),
        ],
        "left",
      ),
    );
    unmount();
    expect(engine.dispose).toHaveBeenCalled();
  });

  it("shows traffic lights only for selected junctions, and sets several at once", async () => {
    const { map, tap, tapJunction, setFilter } = fakeMap();
    const ring = (x: number) => [x, 43.731, x + 0.001, 43.731, x + 0.001, 43.732, x, 43.731];
    const shapes: LaneGeometry = {
      lanes: [],
      junctions: [
        { ring: ring(7.411), nodes: [1], ways: [100, 200], crossing: true, signals: true },
        { ring: ring(7.413), nodes: [2], ways: [100], crossing: true, signals: false },
      ],
      lines: [],
      roads: [],
      driving_side: "right",
    };
    const engine = {
      addTile: vi.fn(),
      build: vi.fn(async () => shapes),
      dispose: vi.fn(),
    } satisfies LaneEngine;
    const onJunctionsChange = vi.fn();
    render(
      <Harness
        map={map}
        onChange={() => {}}
        loadLanes={async () => engine}
        onJunctionsChange={onJunctionsChange}
      />,
    );
    await waitFor(() => expect(engine.build).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading streets…")).toBeNull());
    // Nothing selected: no traffic light settings.
    expect(screen.queryByRole("group", { name: "Traffic lights" })).toBeNull();

    // One junction: its name, what OSM maps, and the three choices.
    tapJunction("1");
    expect(screen.getByRole("heading", { name: "High Street / Back Lane" })).toBeTruthy();
    expect(screen.getByText("OpenStreetMap: traffic lights")).toBeTruthy();
    expect(setFilter).toHaveBeenLastCalledWith("ss-junction-selected", [
      "in",
      ["get", "key"],
      ["literal", ["1"]],
    ]);
    // A plain click on another junction selects only that one.
    tapJunction("2");
    expect(screen.getByText("OpenStreetMap: no traffic lights")).toBeTruthy();

    // Shift-click adds the first one again: one choice for both.
    tapJunction("1", true);
    const panel = screen.getByRole("region", { name: "Junctions selected: 2" });
    expect(within(panel).getByText("Now with traffic lights: 1 · without: 1")).toBeTruthy();
    const lights = within(panel).getByRole("group", { name: "Traffic lights" });
    // Both follow OpenStreetMap, so that choice is marked.
    expect(within(lights).getByRole("button", { name: "As in OpenStreetMap", pressed: true })).toBeTruthy();
    fireEvent.click(within(lights).getByRole("button", { name: "No traffic lights" }));
    expect(onJunctionsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ nodes: [2], signals: false }),
      expect.objectContaining({ nodes: [1], signals: false, name: "High Street / Back Lane" }),
    ]);
    expect(within(lights).getByRole("button", { name: "No traffic lights", pressed: true })).toBeTruthy();
    expect(screen.getByText("Junctions set up · 2")).toBeTruthy();
    // Different settings: no choice is marked until one is made for all.
    fireEvent.click(
      within(panel).getByRole("button", { name: "Take High Street / Back Lane out of the selection" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Traffic lights", pressed: false }));
    tapJunction("1", true);
    const mixed = screen.getByRole("region", { name: "Junctions selected: 2" });
    expect(within(mixed).getByText(/They differ now/)).toBeTruthy();
    expect(
      within(within(mixed).getByRole("group", { name: "Traffic lights" })).queryByRole("button", {
        pressed: true,
      }),
    ).toBeNull();

    // Take one out of the selection; back to the panel of one junction.
    fireEvent.click(
      within(mixed).getByRole("button", { name: "Take High Street / Back Lane out of the selection" }),
    );
    expect(screen.getByRole("region", { name: "Junction" })).toBeTruthy();
    // As OSM maps it: its setup is removed.
    fireEvent.click(screen.getByRole("button", { name: "As in OpenStreetMap" }));
    expect(onJunctionsChange).toHaveBeenLastCalledWith([expect.objectContaining({ nodes: [1] })]);
    // A click on a street clears the junctions.
    tap(100);
    expect(screen.queryByRole("group", { name: "Traffic lights" })).toBeNull();
  });

  it("names a junction saved without its streets' names once its streets are drawn, and saves the name", async () => {
    const { map, tapJunction } = fakeMap();
    const ring = (x: number) => [x, 43.731, x + 0.001, 43.731, x + 0.001, 43.732, x, 43.731];
    const shapes: LaneGeometry = {
      lanes: [],
      junctions: [
        { ring: ring(7.411), nodes: [1], ways: [100, 200], crossing: true, signals: false },
        { ring: ring(7.413), nodes: [2], ways: [100], crossing: true, signals: false },
      ],
      lines: [],
      roads: [],
      driving_side: "right",
    };
    const engine = {
      addTile: vi.fn(),
      build: vi.fn(async () => shapes),
      dispose: vi.fn(),
    } satisfies LaneEngine;
    const onJunctionsChange = vi.fn();
    render(
      <Harness
        map={map}
        onChange={() => {}}
        loadLanes={async () => engine}
        onJunctionsChange={onJunctionsChange}
        initialJunctions={[{ nodes: [1], signals: true, lonlat: [7.4115, 43.7315] }]}
      />,
    );
    const list = await screen.findByRole("region", { name: "Junctions set up · 1" });
    await waitFor(() => expect(within(list).getByText("High Street / Back Lane")).toBeTruthy());
    // The next change of lights stores the name with the junction.
    tapJunction("2");
    fireEvent.click(screen.getByRole("button", { name: "No traffic lights" }));
    expect(onJunctionsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ nodes: [1], signals: true, name: "High Street / Back Lane" }),
      expect.objectContaining({ nodes: [2], signals: false, name: "High Street" }),
    ]);
  });

  it("turns off box zoom while open, so Shift-click reaches junctions and streets", () => {
    const { map, boxZoom } = fakeMap();
    const { unmount } = render(<Harness map={map} onChange={vi.fn()} />);
    // MapLibre's box zoom takes Shift and swallows the click that follows.
    expect(boxZoom.disable).toHaveBeenCalled();
    expect(boxZoom.enable).not.toHaveBeenCalled();
    unmount();
    expect(boxZoom.enable).toHaveBeenCalled();
  });

  it("sets several streets at once with Shift-click: one street's layout for all, and their peak traffic", async () => {
    const { map, sources, tap, tapShift } = fakeMap();
    const onChange = vi.fn();
    render(<Harness map={map} onChange={onChange} />);
    await waitFor(() => expect(sources.get("ss-streets")!.setData).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading streets…")).toBeNull());
    tap(100);
    fireEvent.click(screen.getByRole("button", { name: "Customise this street" }));
    const sections = (onChange.mock.lastCall![0] as StreetSetup[])[0]!.sections;
    tapShift(200);
    const panel = screen.getByRole("region", { name: "Streets selected: 2" });
    // Only what they share: no cross-section of one street.
    expect(screen.queryByRole("listbox", { name: "Sections, left to right" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Use the layout of High Street for all" }));
    let last = onChange.mock.lastCall![0] as StreetSetup[];
    expect(last.find((s) => s.way === 200)?.sections).toEqual(sections);
    // Peak traffic differs until it is typed once for both.
    const morning = within(panel).getAllByRole("spinbutton")[0] as HTMLInputElement;
    expect(morning.value).toBe("");
    fireEvent.change(morning, { target: { value: "600" } });
    last = onChange.mock.lastCall![0] as StreetSetup[];
    expect(last.map((s) => s.cars_morning_peak)).toEqual([600, 600]);
    // Shift-click takes a street out again: one street shows its own panel.
    tapShift(100);
    expect(screen.getByRole("region", { name: "Street setup: Back Lane" })).toBeTruthy();
    // A plain click selects only that street.
    tapShift(100);
    tap(100);
    expect(screen.getByRole("region", { name: "Street setup: High Street" })).toBeTruthy();
  });

  it("says so when the lanes cannot be drawn, and keeps the street lines", async () => {
    const { map, setLayerZoomRange } = fakeMap();
    const engine: LaneEngine = {
      addTile: () => {},
      build: async () => {
        throw new Error("no junctions");
      },
      dispose: () => {},
    };
    render(<Harness map={map} onChange={() => {}} loadLanes={async () => engine} />);
    expect(await screen.findByText(/The lanes could not be drawn/)).toBeTruthy();
    expect(setLayerZoomRange).toHaveBeenLastCalledWith("ss-streets", 0, 24);
  });

  it("asks to zoom in before loading streets", async () => {
    const { map } = fakeMap(11);
    render(<Harness map={map} onChange={() => {}} />);
    expect(await screen.findByText(/Zoom in to street level/)).toBeTruthy();
  });
});

/** A saved line whose one leg drives along High Street from west to east (with the way as drawn). */
function lineAlongHigh(name: string, eastward = true): { name: string; view: LineView } {
  const coords: [number, number][] = [
    [7.4145, 43.733],
    [7.415, 43.733],
    [7.4155, 43.733],
  ];
  const leg = {
    index: 0,
    ways: [100],
    coords: eastward ? coords : [...coords].reverse(),
  } as unknown as LegView;
  return { name, view: { legs: [leg] } as unknown as LineView };
}

describe("Street setup changes that re-route saved bus lines", () => {
  const walkOnly: StreetSetup = {
    way: 100,
    sections: [newSection("lane", ["walk"]), newSection("lane", ["walk"])],
  };

  it("reads which ways buses may drive, as the street routing does", () => {
    expect(busDirections(HIGH, undefined)).toEqual([true, true]);
    expect(busDirections(HIGH, { way: 100, oneway: true })).toEqual([true, false]);
    expect(busDirections(HIGH, walkOnly)).toEqual([false, false]);
    expect(busDirections(HIGH, { way: 100, sections: template("tramPeople") })).toEqual([false, false]);
    expect(busDirections(HIGH, { way: 100, sections: template("centreBus") })).toEqual([true, true]);
    expect(busDirections({ ...HIGH, class: "pedestrian" }, undefined)).toEqual([false, false]);
  });

  it("reads which way a route drives along a street", () => {
    expect(drivenDirections(lineAlongHigh("A").view.legs[0]!.coords, HIGH.coords)).toEqual([true, false]);
    expect(drivenDirections(lineAlongHigh("A", false).view.legs[0]!.coords, HIGH.coords)).toEqual([
      false,
      true,
    ]);
  });

  it("lists lines driving along a street closed to buses, or against a street made one-way", () => {
    const infos = new Map([[100, HIGH]]);
    const lines = [lineAlongHigh("East"), lineAlongHigh("West", false)];
    expect(reroutedLines([], [walkOnly], infos, lines).map((r) => r.line)).toEqual(["East", "West"]);
    expect(reroutedLines([], [{ way: 100, oneway: true }], infos, lines)).toEqual([
      { line: "West", street: "High Street", way: 100 },
    ]);
    expect(reroutedLines([], [{ way: 100, bus_lane: true }], infos, lines)).toEqual([]);
    // Opening a street again re-routes no one.
    expect(reroutedLines([walkOnly], [], infos, lines)).toEqual([]);
  });

  it("asks before a change that sends saved lines round a street", async () => {
    const { map, sources, tap } = fakeMap();
    const onChange = vi.fn();
    render(<Harness map={map} onChange={onChange} streetLines={[lineAlongHigh("Line 12")]} />);
    await waitFor(() => expect(sources.get("ss-streets")!.setData).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading streets…")).toBeNull());
    tap(100);
    fireEvent.click(screen.getByRole("button", { name: "Customise this street" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Trams and people only" }));
    const ask = screen.getByRole("alertdialog", { name: /sends saved bus lines round a street/ });
    expect(within(ask).getByText("Line 12 no longer drives along High Street")).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Trams and people only" }));
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect((onChange.mock.lastCall![0][0] as StreetSetup).sections).toHaveLength(6);
  });
});

describe("Street lanes under the Create tab's tools", () => {
  it("draws the streets lane by lane, faded, with the street setups, and a tram lane without track as an empty strip", async () => {
    const { map, sources } = fakeMap(17);
    const added: string[] = [];
    const build = vi.fn(async (): Promise<LaneGeometry> => ({
      lanes: [
        {
          kind: "traffic",
          way: 100,
          layer: 0,
          ring: [7.414, 43.733, 7.416, 43.733, 7.416, 43.7331, 7.414, 43.733],
        },
        {
          kind: "tram_space",
          way: 100,
          layer: 0,
          ring: [7.414, 43.7331, 7.416, 43.7331, 7.416, 43.7332, 7.414, 43.7331],
        },
      ],
      junctions: [],
      lines: [],
      roads: [],
      driving_side: "right",
    }));
    const engine = {
      addTile: (k: string) => added.push(k),
      build,
      dispose: vi.fn(),
    } as unknown as LaneEngine;
    const setups: StreetSetup[] = [{ way: 100, tram: "own_lane" }];
    const { unmount } = render(
      <LanesBackdrop
        map={map}
        setups={setups}
        fetchTile={async () => "<osm/>"}
        loadLanes={async () => engine}
      />,
    );
    await waitFor(() => expect(sources.get("om-lanes")!.setData).toHaveBeenCalled());
    expect(added.length).toBeGreaterThan(0);
    expect(build).toHaveBeenLastCalledWith(expect.any(Array), setups, "right");
    const data = sources.get("om-lanes")!.setData.mock.lastCall![0] as {
      features: { properties: { kind: string } }[];
    };
    expect(data.features.map((f) => f.properties.kind)).toEqual(["traffic", "tram_space"]);
    unmount();
    expect(sources.has("om-lanes")).toBe(false);
  });
});

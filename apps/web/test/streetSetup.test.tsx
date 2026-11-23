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
import {
  layoutOf,
  newSection,
  sectionName,
  sectionsFromLanes,
  template,
  totalWidth,
} from "../src/features/street-setup/sections";
import type { StreetInfo, StreetSetup } from "../src/features/street-setup/types";

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
  const hit = { way: null as number | null };
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
    queryRenderedFeatures: () => (hit.way === null ? [] : [{ properties: { way: hit.way } }]),
  };
  const tap = (way: number | null) => {
    hit.way = way;
    act(() => {
      for (const f of handlers.get("click") ?? [])
        f({ point: { x: 5, y: 5 }, lngLat: { lng: 7.415, lat: 43.733 } });
    });
  };
  return { map: map as unknown as MapLibreMap, sources, tap, setLayerZoomRange: map.setLayerZoomRange };
}

const NO_LANES: LaneEngineLoader = async () => null;

function Harness({
  map,
  onChange,
  loadLanes = NO_LANES,
  trafficSide = "right",
}: {
  map: MapLibreMap;
  onChange: (s: StreetSetup[]) => void;
  loadLanes?: LaneEngineLoader;
  trafficSide?: "right" | "left";
}) {
  const [setups, setSetups] = useState<StreetSetup[]>([]);
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
    />
  );
}

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
      junctions: [{ ring: [7.412, 43.731, 7.413, 43.731, 7.413, 43.732, 7.412, 43.731] }],
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

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
}: {
  map: MapLibreMap;
  onChange: (s: StreetSetup[]) => void;
  loadLanes?: LaneEngineLoader;
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

    fireEvent.click(
      within(screen.getByRole("group", { name: "Tram" })).getByRole("button", { name: "Own lane" }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Separation from traffic" })).getByRole("button", {
        name: "Kerb or barrier",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Bus lane" })).getByRole("button", { name: "Yes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "More traffic lanes" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        way: 100,
        tram: "own_lane",
        separated: true,
        bus_lane: true,
        traffic_lanes: 3,
      }),
    ]);
    expect(within(form).getByText("Own lane, separated from the traffic: reliable.")).toBeTruthy();
    expect(within(form).getByText(/Separated bus lane/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Cross-section: pavement, bus lane, traffic lane/ })).toBeTruthy();
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
    const { unmount } = render(<Harness map={map} onChange={() => {}} loadLanes={async () => engine} />);
    await waitFor(() => expect(engine.build).toHaveBeenCalled());
    // Every loaded tile goes to the engine, and the tiles on screen are built.
    const keys = engine.addTile.mock.calls.map((c) => c[0]);
    expect(keys.length).toBeGreaterThan(0);
    expect(engine.addTile).toHaveBeenCalledWith(keys[0], "<osm/>");
    expect(engine.build).toHaveBeenLastCalledWith(keys, []);
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

    // A new setup is drawn with the setups applied.
    fireEvent.click(
      within(screen.getByRole("group", { name: "Bus lane" })).getByRole("button", { name: "Yes" }),
    );
    await waitFor(() =>
      expect(engine.build).toHaveBeenLastCalledWith(keys, [
        expect.objectContaining({ way: 100, bus_lane: true }),
      ]),
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

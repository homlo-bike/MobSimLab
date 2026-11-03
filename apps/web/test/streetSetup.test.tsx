import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strips } from "../src/features/street-setup/CrossSection";
import { effective, loadSetups, saveSetups, upsert, verdicts } from "../src/features/street-setup/model";
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
  });

  it("draws the cross-section kerb to kerb", () => {
    const e = effective(HIGH, {
      way: 100,
      tram: "own_lane",
      separated: true,
      bus_lane: true,
      bike_lane: true,
    });
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

  it("keeps one setup per street and drops empty ones", () => {
    let list = upsert([], { way: 1, bus_lane: true });
    list = upsert(list, { way: 1, bus_lane: true, bike_lane: true });
    expect(list).toEqual([{ way: 1, bus_lane: true, bike_lane: true }]);
    expect(upsert(list, { way: 1, bus_lane: null, bike_lane: null })).toEqual([]);
    saveSetups("p1", list);
    expect(loadSetups("p1")).toEqual(list);
    expect(loadSetups("other")).toEqual([]);
  });
});

/** A map with only what the editor touches. */
function fakeMap(zoom = 16) {
  const handlers = new Map<string, (ev: unknown) => void>();
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();
  const hit = { way: null as number | null };
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
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (l: { id: string }) => layers.add(l.id),
    removeLayer: (id: string) => layers.delete(id),
    moveLayer: vi.fn(),
    setFilter: vi.fn(),
    easeTo: vi.fn(),
    queryRenderedFeatures: () => (hit.way === null ? [] : [{ properties: { way: hit.way } }]),
  };
  const tap = (way: number | null) => {
    hit.way = way;
    act(() => handlers.get("click")!({ point: { x: 5, y: 5 }, lngLat: { lng: 7.415, lat: 43.733 } }));
  };
  return { map: map as unknown as MapLibreMap, sources, tap };
}

function Harness({ map, onChange }: { map: MapLibreMap; onChange: (s: StreetSetup[]) => void }) {
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
    expect(within(form).getByText(/Buses run in the traffic of a main road/)).toBeTruthy();

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

    fireEvent.click(screen.getByRole("button", { name: "Reset to OpenStreetMap" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    tap(null);
    expect(screen.getByText(/No street selected/)).toBeTruthy();
  });

  it("asks to zoom in before loading streets", async () => {
    const { map } = fakeMap(11);
    render(<Harness map={map} onChange={() => {}} />);
    expect(await screen.findByText(/Zoom in to street level/)).toBeTruthy();
  });
});

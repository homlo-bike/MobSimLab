import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The area window's map: records its handlers so a test can click on it; points are degrees × 1000 px. */
const maps: FakeMap[] = [];
interface FakeMap {
  handlers: Map<string, (ev: unknown) => void>;
  data: Map<string, unknown>;
  fitBounds: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
}
vi.mock("maplibre-gl", () => {
  class Map {
    handlers = new globalThis.Map<string, (ev: unknown) => void>();
    data = new globalThis.Map<string, unknown>();
    fitBounds = vi.fn();
    easeTo = vi.fn();
    dragPan = { enable() {}, disable() {} };
    doubleClickZoom = { enable() {}, disable() {} };
    constructor() {
      maps.push(this as unknown as FakeMap);
      setTimeout(() => this.handlers.get("load")?.({}), 0);
    }
    addControl() {}
    addSource(id: string) {
      this.data.set(id, null);
    }
    addLayer() {}
    getSource(id: string) {
      return { setData: (d: unknown) => this.data.set(id, d) };
    }
    on(ev: string, f: (ev: unknown) => void) {
      this.handlers.set(ev, f);
    }
    off(ev: string) {
      this.handlers.delete(ev);
    }
    remove() {}
    getCanvas() {
      return { style: {} };
    }
    getCenter() {
      return { lng: 0, lat: 0 };
    }
    getZoom() {
      return 5;
    }
    project([x, y]: [number, number]) {
      return { x: x * 1000, y: y * 1000 };
    }
    queryRenderedFeatures() {
      return [];
    }
  }
  class Control {}
  return { Map, AttributionControl: Control, NavigationControl: Control, setWorkerUrl: () => {} };
});

import { AreaSection } from "../src/features/area/AreaSection";
import { AreaWindow } from "../src/features/area/AreaWindow";
import {
  type AreaEstimate,
  type AreaPolygon,
  type AreaView,
  outsideKm2,
  type ProjectAreaApi,
  ringAreaKm2,
} from "../src/features/area/api";
import { useAreaZoom } from "../src/features/area/useAreaZoom";

afterEach(() => {
  cleanup();
  maps.length = 0;
});

const square = (x: number, y: number, d: number): [number, number][] => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
  [x, y],
];
const damascus: AreaPolygon = { id: "a1", name: "Damascus", detail: "full", ring: square(36.2, 33.45, 0.15) };
const estimateOf = (polygons: AreaPolygon[], added?: number): AreaEstimate => ({
  areaKm2: Math.round(polygons.reduce((s, p) => s + ringAreaKm2(p.ring), 0)),
  tiles: { full: polygons.length * 100, main: 0 },
  bytes: polygons.length * 60 * 1024 * 1024,
  polygons: polygons.map((p) => ({ id: p.id, areaKm2: ringAreaKm2(p.ring), bytes: 60 * 1024 * 1024 })),
  limitBytes: 1000 * 1024 * 1024,
  overLimit: false,
  ...(added === undefined ? {} : { added: { tiles: 10, bytes: added * 1024 * 1024 } }),
});
const view = (polygons: AreaPolygon[], over: Partial<AreaView> = {}): AreaView => ({
  polygons,
  estimate: estimateOf(polygons),
  bbox: polygons.length ? [36.2, 33.45, 36.35, 33.6] : null,
  dataDate: polygons.length ? "2026-11-18T10:00:00Z" : null,
  ...over,
});

/** Purpose: click the area window's map at `[lon, lat]`. */
async function clickMap(lon: number, lat: number) {
  const map = maps[0]!;
  await act(async () =>
    map.handlers.get("click")!({ lngLat: { lng: lon, lat }, point: { x: lon * 1000, y: lat * 1000 } }),
  );
}

describe("area window", () => {
  it("draws polygons on the map, totals them and saves them with their detail", async () => {
    const estimate = vi.fn(async (ps: AreaPolygon[]) => estimateOf(ps));
    const onSave = vi.fn();
    render(<AreaWindow initial={[]} estimate={estimate} onSave={onSave} onClose={() => {}} />);
    await waitFor(() => expect(maps[0]?.handlers.has("click")).toBe(true));
    expect(screen.getByText(/No polygons yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Draw polygon/ }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Save area" }) as HTMLButtonElement).disabled).toBe(true);

    // Three corners, then Backspace takes the last back, then Enter closes the polygon.
    await clickMap(36.2, 33.45);
    await clickMap(36.35, 33.45);
    await clickMap(36.9, 34.9);
    fireEvent.keyDown(document.body, { key: "Backspace" });
    await clickMap(36.35, 33.6);
    fireEvent.keyDown(document.body, { key: "Enter" });

    const list = await screen.findByRole("button", { name: /Area 1/ });
    expect(within(list).getByText(/Full · /)).toBeTruthy();
    await waitFor(() => expect(estimate).toHaveBeenCalled());
    expect(estimate.mock.calls.at(-1)![0][0]!.ring).toEqual([
      [36.2, 33.45],
      [36.35, 33.45],
      [36.35, 33.6],
      [36.2, 33.45],
    ]);
    expect(await screen.findByText("60 MB", { selector: "div" })).toBeTruthy();
    expect(screen.getByText("100 map tiles")).toBeTruthy();
    expect(screen.getByText("Limit 1,000 MB")).toBeTruthy();

    // Name it and set it to main roads and railways only.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "M5 corridor" } });
    fireEvent.click(screen.getByRole("radio", { name: "Main roads and railways only" }));
    expect(screen.getByText(/Motorway, trunk and primary roads/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save area" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ id: "a1", name: "M5 corridor", detail: "main" }),
    ]);
  });

  it("closes a polygon by clicking its first corner, and searching only moves the map", async () => {
    const search = vi.fn(async () => [
      {
        name: "Homs",
        context: "Syria",
        kind: "city",
        lonLat: [36.72, 34.73] as [number, number],
        bbox: null,
      },
    ]);
    render(
      <AreaWindow
        initial={[]}
        estimate={async (ps) => estimateOf(ps)}
        onSave={() => {}}
        onClose={() => {}}
        search={search}
      />,
    );
    await waitFor(() => expect(maps[0]?.handlers.has("click")).toBe(true));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Homs" } });
    fireEvent.click(await screen.findByRole("button", { name: /Homs/ }));
    expect(maps[0]!.easeTo).toHaveBeenCalledWith({ center: [36.72, 34.73], zoom: 11 });
    expect(screen.queryByRole("button", { name: /Area 1/ })).toBeNull();

    await clickMap(36.7, 34.7);
    await clickMap(36.75, 34.7);
    await clickMap(36.75, 34.75);
    await clickMap(36.7001, 34.7001);
    expect(await screen.findByRole("button", { name: /Area 1/ })).toBeTruthy();
  });

  it("asks before downloading what an edited area adds, and saves at once when it adds nothing", async () => {
    const estimate = vi.fn(async (ps: AreaPolygon[], prev?: AreaPolygon[]) =>
      estimateOf(ps, prev && ps.length > prev.length ? 31 : 0),
    );
    const onSave = vi.fn();
    render(
      <AreaWindow
        initial={[damascus]}
        saved={[damascus]}
        projectName="Syria intercity"
        estimate={estimate}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Editing the area of Syria intercity")).toBeTruthy();
    await waitFor(() => expect(maps[0]?.fitBounds).toHaveBeenCalled());
    fireEvent.keyDown(document.body, { key: "d" });
    await clickMap(35.85, 34.85);
    await clickMap(35.95, 34.85);
    await clickMap(35.95, 34.95);
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tartus" } });
    await waitFor(() => expect(estimate.mock.calls.at(-1)![1]).toEqual([damascus]));
    await waitFor(() => expect(estimate.mock.calls.at(-1)![0]).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Save area" }));
    const ask = await screen.findByRole("alertdialog", { name: "Download map data for the new parts?" });
    expect(within(ask).getByText(/New or changed: Tartus \(Full, /)).toBeTruthy();
    expect(within(ask).getByText(/They need about 31 MB/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Back to the map" }));
    fireEvent.click(screen.getByRole("button", { name: "Save area" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and download 31 MB" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0].map((p: AreaPolygon) => p.name)).toEqual(["Damascus", "Tartus"]);

    // Deleting a polygon adds nothing to download: no question.
    cleanup();
    maps.length = 0;
    const other = { ...damascus, id: "a2", name: "Homs" };
    const saved = vi.fn();
    render(
      <AreaWindow
        initial={[damascus, other]}
        saved={[damascus, other]}
        estimate={estimate}
        onSave={saved}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Homs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete polygon" }));
    await waitFor(() => expect(estimate.mock.calls.at(-1)![0]).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Save area" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith([damascus]));
  });

  it("refuses to save an area over the limit and says why", async () => {
    render(
      <AreaWindow
        initial={[damascus]}
        estimate={async (ps) => ({ ...estimateOf(ps), bytes: 2000 * 1024 * 1024, overLimit: true })}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/more map data than the 1,000 MB a project may hold/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save area" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Escape, but first drops a polygon being drawn", async () => {
    const onClose = vi.fn();
    render(
      <AreaWindow initial={[]} estimate={async (ps) => estimateOf(ps)} onSave={() => {}} onClose={onClose} />,
    );
    await waitFor(() => expect(maps[0]?.handlers.has("click")).toBe(true));
    await clickMap(36.2, 33.45);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Project preferences, Project area", () => {
  const fakeApi = (initial: AreaView): ProjectAreaApi & Record<string, ReturnType<typeof vi.fn>> => ({
    get: vi.fn(async () => initial),
    set: vi.fn(async (polygons: AreaPolygon[]) => ({
      ...view(polygons),
      imports: [
        { kind: "osm" as const, status: "queued" as const },
        { kind: "dem" as const, status: "current" as const },
        { kind: "population" as const, status: "failed" as const, reason: "The area is too big" },
      ],
    })),
    refresh: vi.fn(async () => ({
      imports: [
        { kind: "osm" as const, status: "queued" as const },
        { kind: "dem" as const, status: "queued" as const },
        { kind: "population" as const, status: "queued" as const },
      ],
    })),
    estimate: vi.fn(async (ps: AreaPolygon[]) => estimateOf(ps, 0)),
  });

  it("shows the polygons, the data date and the size, and refreshes the map data", async () => {
    const api = fakeApi(view([damascus]));
    render(<AreaSection api={api} editable projectName="Syria intercity" />);
    expect(await screen.findByText("Damascus")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Outline of the project area" })).toBeTruthy();
    expect(screen.getByText("1 polygon")).toBeTruthy();
    expect(screen.getByText(/Map data from .*2026/)).toBeTruthy();
    expect(screen.getByText(/about 60 MB of map data/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh map data" }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalled());
    expect(await screen.findByText("OpenStreetMap: import started")).toBeTruthy();
  });

  it("edits the area in the area window and says which imports started", async () => {
    const api = fakeApi(view([damascus]));
    render(<AreaSection api={api} editable projectName="Syria intercity" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit area/ }));
    const win = await screen.findByRole("dialog", { name: "Project area" });
    fireEvent.click(within(win).getByRole("button", { name: /Damascus/ }));
    fireEvent.click(within(win).getByRole("radio", { name: "Main roads and railways only" }));
    await waitFor(() => expect(api.estimate).toHaveBeenCalled());
    fireEvent.click(within(win).getByRole("button", { name: "Save area" }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith([{ ...damascus, detail: "main" }], true));
    expect(await screen.findByText("Area saved.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Project area" })).toBeNull();
    expect(screen.getByText("Elevation: already imported")).toBeTruthy();
    expect(screen.getByText("Population: could not start. The area is too big")).toBeTruthy();
  });

  it("asks to draw an area when there is none, and lets readers only look", async () => {
    render(<AreaSection api={fakeApi(view([]))} editable />);
    expect(await screen.findByText(/No project area yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Draw area/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh map data" })).toBeNull();
    cleanup();
    render(<AreaSection api={fakeApi(view([damascus]))} editable={false} />);
    expect(await screen.findByText("Damascus")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit area/ })).toBeNull();
  });
});

describe("area geometry in the app", () => {
  it("works out how much of a region lies outside the area", () => {
    const area = [{ ring: square(0, 0, 1) }];
    expect(outsideKm2(square(0.2, 0.2, 0.5), area)).toBe(0);
    const half = outsideKm2(square(0.5, 0, 1), area);
    expect(half / ringAreaKm2(square(0.5, 0, 1))).toBeCloseTo(0.5, 1);
  });
});

describe("Opening a project puts the map on its area", () => {
  function fakeMap() {
    const handlers = new Map<string, () => void>();
    return {
      handlers,
      map: {
        once: (ev: string, f: () => void) => handlers.set(ev, f),
        off: (ev: string) => handlers.delete(ev),
        fitBounds: vi.fn(),
      },
    };
  }
  const boxView = (bbox: [number, number, number, number] | null): AreaView => ({ ...view([]), bbox });

  it("zooms to the area once it has loaded", async () => {
    const { map } = fakeMap();
    const load = vi.fn(async () => boxView([37.0, 36.1, 37.3, 36.3]));
    renderHook(() => useAreaZoom(map as unknown as MapLibreMap, "p1", load));
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledWith("p1");
    expect(map.fitBounds.mock.calls[0]![0]).toEqual([
      [37.0, 36.1],
      [37.3, 36.3],
    ]);
  });

  it("leaves the map alone when something moved it first or there is no area", async () => {
    const { map, handlers } = fakeMap();
    let done!: (v: AreaView) => void;
    const load = vi.fn(() => new Promise<AreaView>((r) => (done = r)));
    renderHook(() => useAreaZoom(map as unknown as MapLibreMap, "p1", load));
    handlers.get("movestart")!();
    await act(async () => done(boxView([0, 0, 1, 1])));
    expect(map.fitBounds).not.toHaveBeenCalled();

    const other = fakeMap();
    renderHook(() => useAreaZoom(other.map as unknown as MapLibreMap, "p2", async () => boxView(null)));
    await act(async () => {});
    expect(other.map.fitBounds).not.toHaveBeenCalled();
  });
});

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AreaPicker } from "../src/features/area/AreaPicker";
import { AreaSection } from "../src/features/area/AreaSection";
import type { AreaRegion, AreaView, ProjectAreaApi } from "../src/features/area/api";
import { useAreaZoom } from "../src/features/area/useAreaZoom";
import type { Place } from "../src/map/places";

afterEach(cleanup);

const ring = (x: number, y: number, d: number): [number, number][] => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
  [x, y],
];
const berlin: AreaRegion = {
  id: "r62422",
  name: "Berlin",
  kind: "administrative",
  adminLevel: 4,
  ring: ring(13.1, 52.3, 0.5),
  areaKm2: 891,
};
const brandenburg: AreaRegion = {
  id: "r62504",
  name: "Brandenburg",
  kind: "administrative",
  adminLevel: 4,
  ring: ring(11.3, 51.4, 3.3),
  areaKm2: 29_654,
};
const place: Place = { name: "Berlin", context: "Germany", kind: "city", lonLat: [13.4, 52.5], bbox: null };

describe("project area picker (#140)", () => {
  it("searches a place, lists the regions it lies in and ticks more than one", async () => {
    const search = vi.fn(async () => [place]);
    const lookUp = vi.fn(async () => [berlin, brandenburg]);
    const onChange = vi.fn();
    const { rerender } = render(
      <AreaPicker value={[]} onChange={onChange} search={search} lookUp={lookUp} />,
    );
    expect(screen.getByText(/No region chosen/)).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Berlin" } });
    fireEvent.click(await screen.findByRole("button", { name: /Berlin/ }));
    expect(lookUp).toHaveBeenCalledWith([13.4, 52.5]);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Berlin/ }));
    expect(onChange).toHaveBeenLastCalledWith([berlin]);
    rerender(<AreaPicker value={[berlin]} onChange={onChange} search={search} lookUp={lookUp} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Brandenburg/ }));
    expect(onChange).toHaveBeenLastCalledWith([berlin, brandenburg]);
    rerender(
      <AreaPicker value={[berlin, brandenburg]} onChange={onChange} search={search} lookUp={lookUp} />,
    );
    expect(screen.getByRole("img", { name: "Outline of the chosen regions" })).toBeTruthy();
    expect(screen.getByText("About 30,545 km² in all")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Berlin" }));
    expect(onChange).toHaveBeenLastCalledWith([brandenburg]);
  });

  it("saves the area in Preferences and says which imports started", async () => {
    const api: ProjectAreaApi = {
      get: vi.fn(async () => ({ regions: [berlin], bbox: null, areaKm2: null })),
      set: vi.fn(async (regions: AreaRegion[]) => ({
        regions,
        bbox: null,
        areaKm2: null,
        imports: [
          { kind: "osm" as const, status: "queued" as const },
          { kind: "dem" as const, status: "current" as const },
          { kind: "population" as const, status: "failed" as const, reason: "The area is too big" },
        ],
      })),
    };
    render(<AreaSection api={api} editable />);
    const save = await screen.findByRole("button", { name: "Save area and import data" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove Berlin" }));
    fireEvent.click(save);
    await waitFor(() => expect(api.set).toHaveBeenCalledWith([], true));
    expect(await screen.findByText("Area saved.")).toBeTruthy();
    expect(screen.getByText("OpenStreetMap: import started")).toBeTruthy();
    expect(screen.getByText("Elevation: already imported")).toBeTruthy();
    expect(screen.getByText("Population: could not start. The area is too big")).toBeTruthy();
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
  const view = (bbox: [number, number, number, number] | null): AreaView => ({
    regions: [],
    bbox,
    areaKm2: null,
  });

  it("zooms to the area once it has loaded", async () => {
    const { map } = fakeMap();
    const load = vi.fn(async () => view([37.0, 36.1, 37.3, 36.3]));
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
    await act(async () => done(view([0, 0, 1, 1])));
    expect(map.fitBounds).not.toHaveBeenCalled();

    const other = fakeMap();
    renderHook(() => useAreaZoom(other.map as unknown as MapLibreMap, "p2", async () => view(null)));
    await act(async () => {});
    expect(other.map.fitBounds).not.toHaveBeenCalled();
  });
});

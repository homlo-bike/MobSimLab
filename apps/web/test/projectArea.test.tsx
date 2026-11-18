import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AreaPicker } from "../src/features/area/AreaPicker";
import { AreaSection } from "../src/features/area/AreaSection";
import type { AreaRegion, ProjectAreaApi } from "../src/features/area/api";
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

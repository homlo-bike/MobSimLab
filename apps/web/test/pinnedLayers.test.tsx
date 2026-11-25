import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ Marker: undefined }));

import { DEFAULT_BASEMAP } from "../src/map/basemaps";
import { MapControls } from "../src/map/MapControls";
import { type PinnedLayer, PinnedLayersContext } from "../src/map/pinnedLayers";
import type { Network } from "../src/features/railways/types";
import { pinnableLayers, pinnedFeatures, type ProjectContent } from "../src/workspace/PinnedLayers";

afterEach(cleanup);

const map = {
  getStyle: () => ({ layers: [] }),
  on: () => {},
  off: () => {},
  getCenter: () => ({ lng: 8.5, lat: 47.4 }),
  getZoom: () => 12,
} as unknown as MapLibreMap;

const empty: ProjectContent = {
  railway: null,
  streetLines: [],
  pluginLines: {},
  setups: [],
  junctions: [],
  regions: [],
};

describe("project layers kept shown on every map tab", () => {
  it("offers the layers the project has, and ticks one to keep it shown", () => {
    const onChange = vi.fn();
    render(
      <PinnedLayersContext.Provider
        value={{
          available: ["tracks", "stations", "regions"],
          pinned: new Set<PinnedLayer>(["regions"]),
          onChange,
        }}
      >
        <MapControls
          map={map}
          basemap={DEFAULT_BASEMAP}
          onBasemap={vi.fn()}
          hidden={new Set()}
          onHidden={vi.fn()}
        />
      </PinnedLayersContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(screen.getByText("Always show")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Regions" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Stops" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Tracks" }));
    expect([...onChange.mock.calls[0]![0]].sort()).toEqual(["regions", "tracks"]);
  });

  it("has no Always show outside a project", () => {
    render(
      <MapControls
        map={map}
        basemap={DEFAULT_BASEMAP}
        onBasemap={vi.fn()}
        hidden={new Set()}
        onHidden={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(screen.queryByText("Always show")).toBeNull();
  });

  it("lists only what the project holds, and draws regions, street setups and rail service lines", () => {
    expect(pinnableLayers(empty)).toEqual([]);
    const railway = {
      tracks: [{ id: 1 }],
      stations: [{ id: 1 }, { id: 2 }],
      lines: [{ id: "l1", color: "#f00", stations: [1, 2] }],
    } as unknown as Network;
    const content: ProjectContent = {
      ...empty,
      railway,
      setups: [{ way: 7, at: [8.5, 47.4] }],
      regions: [
        {
          id: "r1",
          name: "North",
          ring: [
            [8, 47],
            [9, 47],
            [9, 48],
          ],
          source: "drawn",
          values: {} as never,
        },
      ],
    };
    expect(pinnableLayers(content)).toEqual([
      "serviceLines",
      "tracks",
      "stations",
      "streetSetups",
      "regions",
    ]);
    const view = {
      stations: [
        { id: 1, name: "A", lonlat: [8.1, 47.1] },
        { id: 2, name: "B", lonlat: [8.2, 47.2] },
      ],
      layers: { tracks: { features: [] }, platforms: { features: [] } },
    } as never;
    const f = pinnedFeatures(content, view);
    expect(f.serviceLines[0]!.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [8.1, 47.1],
        [8.2, 47.2],
      ],
    });
    expect(f.stations).toHaveLength(2);
    expect(f.streetSetups).toHaveLength(1);
    expect((f.regions[0]!.geometry as { coordinates: number[][][] }).coordinates[0]).toHaveLength(4);
  });
});

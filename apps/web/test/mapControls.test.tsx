import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ Marker: undefined }));

import { BASEMAPS, basemapById, basemapStyle, DEFAULT_BASEMAP } from "../src/map/basemaps";
import { MapControls } from "../src/map/MapControls";
import { applyHidden, groupOf, groupsOnMap } from "../src/map/mapLayers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A map with layers and layout visibility, enough for the layer control. */
function fakeMap(ids: string[], visibility: Record<string, string> = {}) {
  const vis = { ...visibility };
  const handlers: (() => void)[] = [];
  const map = {
    getStyle: () => ({ layers: ids.map((id) => ({ id })) }),
    getLayoutProperty: (id: string) => vis[id],
    setLayoutProperty: vi.fn((id: string, _k: string, v: string) => (vis[id] = v)),
    on: (_e: string, f: () => void) => handlers.push(f),
    off: vi.fn(),
    getCenter: () => ({ lng: 8.5, lat: 47.4 }),
    getZoom: () => 12,
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
  };
  return { map: map as unknown as MapLibreMap, vis, raw: map };
}

describe("basemaps and project layers", () => {
  it("offers the OpenFreeMap styles and Sentinel-2 imagery, each credited", () => {
    expect(BASEMAPS.map((b) => b.kind)).toEqual(["street", "street", "street", "aerial"]);
    for (const b of BASEMAPS) expect(b.attribution).toContain("OpenStreetMap contributors");
    expect(basemapById("eox-s2cloudless-2016").attribution).toContain("Copernicus Sentinel data 2016");
    expect(basemapById("nope")).toBe(DEFAULT_BASEMAP);
  });

  it("draws imagery under the labels and borders, keeping the vector source for the naming rules", () => {
    const loaded = {
      version: 8,
      sources: { openmaptiles: { type: "vector", url: "x" } },
      layers: [
        { id: "background", type: "background" },
        { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" },
        { id: "road", type: "line", source: "openmaptiles", "source-layer": "transportation" },
        { id: "border", type: "line", source: "openmaptiles", "source-layer": "boundary" },
        { id: "label", type: "symbol", source: "openmaptiles", "source-layer": "place" },
      ],
    } as StyleSpecification;
    const aerial = basemapStyle(basemapById("eox-s2cloudless-2016"), loaded);
    expect(aerial.layers.map((l) => l.id)).toEqual(["background", "eox-s2cloudless-2016", "border", "label"]);
    expect(Object.keys(aerial.sources)).toEqual(["openmaptiles", "eox-s2cloudless-2016"]);
    expect(basemapStyle(DEFAULT_BASEMAP, loaded)).toBe(loaded);
  });

  it("groups the tools' layers by their id and hides and restores them", () => {
    expect(groupOf("sl-legs")).toBe("streetLines");
    expect(groupOf("rd-tracks")).toBe("railways");
    expect(groupOf("noise-band")).toBe("noise");
    expect(groupOf("water")).toBeNull();
    const { map, vis } = fakeMap(["background", "sl-legs", "rd-tracks", "rd-connections"], {
      "rd-connections": "none",
    });
    expect(groupsOnMap(map)).toEqual(["streetLines", "railways"]);
    applyHidden(map, new Set(["railways"]));
    expect(vis).toMatchObject({ "rd-tracks": "none", "rd-connections": "none" });
    expect(vis["sl-legs"]).toBeUndefined();
    applyHidden(map, new Set());
    // Each layer gets back what its tool gave it.
    expect(vis).toMatchObject({ "rd-tracks": "visible", "rd-connections": "none" });
  });
});

describe("map controls", () => {
  it("switches the basemap and hides a group of project layers", () => {
    const { map } = fakeMap(["sl-legs"]);
    const onBasemap = vi.fn();
    const onHidden = vi.fn();
    render(
      <MapControls
        map={map}
        basemap={DEFAULT_BASEMAP}
        onBasemap={onBasemap}
        hidden={new Set()}
        onHidden={onHidden}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
    fireEvent.click(screen.getByRole("radio", { name: /Sentinel-2 cloudless 2016/ }));
    expect(onBasemap).toHaveBeenCalledWith(basemapById("eox-s2cloudless-2016"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Street lines" }));
    expect([...onHidden.mock.calls[0]![0]]).toEqual(["streetLines"]);
  });

  it("finds a place and moves the map to it", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toContain("/api/places/search?q=zurich");
      expect(url).toContain("lat=47.4000");
      return new Response(
        JSON.stringify({
          places: [
            {
              name: "Zürich",
              context: "Switzerland",
              kind: "place/city",
              lonLat: [8.54, 47.37],
              bbox: [8.4, 47.3, 8.6, 47.4],
            },
            {
              name: "Zürich HB",
              context: "Bahnhofplatz",
              kind: "railway/station",
              lonLat: [8.54, 47.378],
              bbox: null,
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const { map, raw } = fakeMap([]);
    render(
      <MapControls
        map={map}
        basemap={DEFAULT_BASEMAP}
        onBasemap={vi.fn()}
        hidden={new Set()}
        onHidden={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search places" }));
    const input = screen.getByRole("searchbox", { name: "Town, street, station or address" });
    fireEvent.change(input, { target: { value: "zurich" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(await screen.findByRole("button", { name: /Zürich HB/ }));
    expect(raw.flyTo).toHaveBeenCalledWith({ center: [8.54, 47.378], zoom: 16 });
    await waitFor(() => expect(screen.queryByRole("searchbox")).toBeNull());
  });

  it("says when the search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Place search is unavailable right now" }), { status: 502 }),
      ),
    );
    const { map } = fakeMap([]);
    render(
      <MapControls
        map={map}
        basemap={DEFAULT_BASEMAP}
        onBasemap={vi.fn()}
        hidden={new Set()}
        onHidden={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search places" }));
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "zurich" } });
    fireEvent.submit(input.closest("form")!);
    expect(
      await screen.findByText("Place search failed: Place search is unavailable right now"),
    ).toBeTruthy();
  });
});

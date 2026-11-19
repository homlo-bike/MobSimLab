import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ Marker: undefined }));

import {
  availableBasemaps,
  BASEMAPS,
  basemapById,
  basemapStyle,
  DEFAULT_BASEMAP,
  imageryTiles,
  loadServerBasemaps,
  newestDay,
  onServerBasemaps,
  refreshServerBasemaps,
  rememberBasemap,
  rememberedBasemapId,
  pluginBasemap,
} from "../src/map/basemaps";
import { MapControls } from "../src/map/MapControls";
import { applyHidden, groupOf, groupsOnMap, switchBasemap } from "../src/map/mapLayers";

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

  it("shows the OpenFreeMap credit once: the basemap's own, not the tiles' as well", () => {
    const loaded = {
      version: 8,
      sources: {
        openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
        other: { type: "vector", url: "https://example.org/tiles", attribution: "Other" },
      },
      layers: [],
    } as unknown as StyleSpecification;
    const street = basemapStyle(DEFAULT_BASEMAP, loaded);
    expect(street.sources.openmaptiles).toMatchObject({ attribution: "" });
    expect(street.sources.other).toMatchObject({ attribution: "Other" });
    expect(DEFAULT_BASEMAP.attribution).toContain("OpenStreetMap contributors");
    const aerial = basemapStyle(basemapById("eox-s2cloudless-2016"), loaded);
    expect(aerial.sources.openmaptiles).toMatchObject({ attribution: "" });
  });

  it("adds the NASA GIBS plugin's daily imagery, for the newest day or a picked one", () => {
    const ids = availableBasemaps().map((b) => b.id);
    expect(ids.slice(0, BASEMAPS.length)).toEqual(BASEMAPS.map((b) => b.id));
    expect(ids).toContain("gibs-hls-sentinel-2");
    expect(availableBasemaps([]).map((b) => b.id)).toEqual(BASEMAPS.map((b) => b.id));
    const hls = basemapById("gibs-hls-sentinel-2");
    expect(hls.kind).toBe("aerial");
    expect(hls.attribution).toContain("NASA GIBS");
    expect(hls.attribution).toContain("OpenStreetMap contributors");
    expect(hls.note).toContain("30 m");
    const now = new Date("2026-11-17T12:00:00Z");
    expect(newestDay(hls, now)).toBe("2026-11-13");
    expect(imageryTiles(hls, now)[0]).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-11-13/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png",
    );
    expect(imageryTiles({ ...hls, day: "2024-06-01" }, now)[0]).toContain("/default/2024-06-01/");
    expect(newestDay(DEFAULT_BASEMAP)).toBeNull();
  });

  it("offers Esri World Imagery only once the API says an Admin saved the key, with tiles through the API", async () => {
    expect(availableBasemaps().map((b) => b.id)).not.toContain("esri-world-imagery");
    const answer = (available: string[]) =>
      vi.fn(
        async () => new Response(JSON.stringify({ available }), { status: 200 }),
      ) as unknown as typeof fetch;
    expect(await loadServerBasemaps(answer(["esri"]))).toBe(true);
    const esri = basemapById("esri-world-imagery");
    expect(esri.id).toBe("esri-world-imagery");
    expect(esri.attribution).toContain("Powered by Esri");
    expect(imageryTiles(esri)).toEqual([`${window.location.origin}/api/basemaps/esri/tiles/{z}/{y}/{x}`]);
    expect(await loadServerBasemaps(answer([]))).toBe(true);
    expect(availableBasemaps().map((b) => b.id)).not.toContain("esri-world-imagery");
    // Without an API (the static viewer) nothing keyed is offered.
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await loadServerBasemaps(down)).toBe(false);
  });

  it("tells open maps when an Admin's key changes what is offered, and keeps a keyed pick across reloads", async () => {
    const answer = (available: string[]) =>
      vi.fn(
        async () => new Response(JSON.stringify({ available }), { status: 200 }),
      ) as unknown as typeof fetch;
    const heard = vi.fn();
    const stop = onServerBasemaps(heard);
    await refreshServerBasemaps(answer(["esri"]));
    await refreshServerBasemaps(answer(["esri"]));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await refreshServerBasemaps(answer([]));
    expect(heard).toHaveBeenCalledTimes(1);
    // Picked before a reload, Esri is not offered yet when the map opens; its id is kept to restore it then.
    rememberBasemap("esri-world-imagery");
    expect(rememberedBasemapId()).toBe("esri-world-imagery");
    expect(basemapById(rememberedBasemapId()).id).toBe(DEFAULT_BASEMAP.id);
    localStorage.clear();
  });

  it("switches the basemap while another style is still loading", () => {
    // MapLibre throws "Style is not done loading" from listImages then; that blanked every project page.
    const setStyle = vi.fn();
    const map = {
      listImages: () => {
        throw new Error("Style is not done loading");
      },
      getImage: vi.fn(),
      setStyle,
      once: vi.fn(),
    } as unknown as MapLibreMap;
    expect(() => switchBasemap(map, DEFAULT_BASEMAP)).not.toThrow();
    expect(setStyle).toHaveBeenCalledWith(DEFAULT_BASEMAP.styleUrl, expect.anything());
  });

  it("escapes a plugin's attribution", () => {
    const b = pluginBasemap({
      id: "x",
      label: "X",
      tiles: ["https://gibs.earthdata.nasa.gov/{z}/{x}/{y}.jpg"],
      tileSize: 256,
      maxzoom: 9,
      attribution: { text: "<img src=x onerror=alert(1)>", url: 'https://example.org/"a' },
    });
    expect(b.attribution).not.toContain("<img");
    expect(b.attribution).toContain("&#60;img");
    expect(b.attribution).toContain('href="https://example.org/&#34;a"');
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

  it("offers a date for daily imagery and shows its own note", () => {
    const onBasemap = vi.fn();
    const hls = basemapById("gibs-hls-sentinel-2");
    render(
      <MapControls
        map={fakeMap([]).map}
        basemap={hls}
        onBasemap={onBasemap}
        hidden={new Set()}
        onHidden={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
    expect(screen.getByText(/About 30 m per pixel/)).toBeTruthy();
    const date = screen.getByLabelText("Imagery date") as HTMLInputElement;
    expect(date.min).toBe("2015-11-28");
    fireEvent.change(date, { target: { value: "2024-06-01" } });
    expect(onBasemap).toHaveBeenCalledWith({ ...hls, day: "2024-06-01" });
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

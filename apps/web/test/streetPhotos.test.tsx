import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ Marker: undefined }));

import { DEFAULT_BASEMAP } from "../src/map/basemaps";
import { MapControls } from "../src/map/MapControls";
import {
  loadStreetPhotoSources,
  photoUrl,
  resetStreetPhotoSources,
  streetPhotoSources,
} from "../src/map/streetPhotos";
import { PLUGINS } from "../src/plugins/registry";

const REF = "11111111-2222-4333-8444-555555555555_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const photo = (ref: string, distanceM: number) => ({
  provider: "panoramax",
  ref,
  lon: 2.35,
  lat: 48.85,
  distanceM,
  takenAt: "2025-06-01T10:00:00Z",
  author: "Camille",
  licence: { name: "CC-BY-SA-4.0", url: "https://spdx.org/licenses/CC-BY-SA-4.0.html" },
  heading: 90,
  panorama: true,
  pageUrl: `https://api.panoramax.xyz/#focus=pic&pic=${ref.split("_")[1]}`,
});

function stubApi(available: string[], photos: unknown[] = []) {
  const fetchImpl = vi.fn(async (url: string) => {
    if (url === "/api/street-photos") return Response.json({ available });
    if (url.startsWith("/api/street-photos/panoramax/near?")) return Response.json({ photos });
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

/** A map with a container and canvas, enough for the Street photos panel. */
function fakeMap() {
  const container = document.createElement("div");
  container.className = "maplibregl-map";
  const canvasContainer = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvasContainer.appendChild(canvas);
  container.appendChild(canvasContainer);
  document.body.appendChild(container);
  const toolClick = vi.fn();
  canvasContainer.addEventListener("click", toolClick);
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  const map = {
    getContainer: () => container,
    getCanvasContainer: () => canvasContainer,
    getCanvas: () => canvas,
    getZoom: () => 16,
    getStyle: () => ({ layers: [...layers.keys()].map((id) => ({ id })) }),
    unproject: ([x, y]: [number, number]) => ({ lng: 2.35 + x / 1e5, lat: 48.85 - y / 1e5 }),
    on: vi.fn(),
    off: vi.fn(),
    addSource: vi.fn((id: string, s: unknown) => sources.set(id, { ...(s as object), setData: vi.fn() })),
    getSource: (id: string) => sources.get(id),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    addLayer: vi.fn((l: { id: string }) => layers.set(l.id, l)),
    getLayer: (id: string) => layers.get(id),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
  };
  return { map: map as unknown as MapLibreMap, raw: map, canvas, toolClick, sources, layers, container };
}

beforeEach(() => resetStreetPhotoSources());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("street photo sources", () => {
  it("are the Panoramax plugin's, offered once the API serves them", async () => {
    expect(PLUGINS.find((p) => p.id === "org.mobsimlab.panoramax")?.streetPhotos?.[0]?.provider).toBe(
      "panoramax",
    );
    expect(streetPhotoSources()).toEqual([]);
    stubApi(["panoramax"]);
    expect(await loadStreetPhotoSources()).toBe(true);
    expect(streetPhotoSources().map((s) => s.id)).toEqual(["panoramax"]);
    // A project that turned the plugin off has none.
    expect(streetPhotoSources(PLUGINS.filter((p) => p.id !== "org.mobsimlab.panoramax"))).toEqual([]);
  });

  it("offers none without an API (static viewer)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    await loadStreetPhotoSources();
    expect(streetPhotoSources()).toEqual([]);
  });

  it("loads pictures through the API", () => {
    expect(photoUrl({ provider: "panoramax", ref: REF }, "sd")).toBe(
      `/api/street-photos/panoramax/photos/${REF}/sd`,
    );
  });
});

describe("Street photos panel", () => {
  const renderControls = (map: MapLibreMap) =>
    render(
      <MapControls
        map={map}
        basemap={DEFAULT_BASEMAP}
        onBasemap={vi.fn()}
        hidden={new Set()}
        onHidden={vi.fn()}
      />,
    );

  it("has no button when the API serves no source", async () => {
    stubApi([]);
    const { map } = fakeMap();
    renderControls(map);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Street photos" })).toBeNull();
  });

  it("shows coverage, and a click on the map shows the photos near it without reaching the tool", async () => {
    const other = REF.replace(/e{12}$/, "f".repeat(12));
    const fetchImpl = stubApi(["panoramax"], [photo(REF, 4), photo(other, 12)]);
    const { map, raw, canvas, toolClick, layers } = fakeMap();
    renderControls(map);
    fireEvent.click(await screen.findByRole("button", { name: "Street photos" }));
    expect([...layers.keys()]).toEqual(["sp-coverage-lines", "sp-coverage-points"]);
    expect(raw.addSource.mock.calls[0]![1]).toMatchObject({
      type: "vector",
      tiles: ["https://api.panoramax.xyz/api/map/{z}/{x}/{y}.mvt"],
    });
    expect(canvas.style.cursor).toBe("crosshair");
    expect(screen.getByText(/Click a point on the map/)).toBeTruthy();

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 20 });
    fireEvent.click(canvas, { clientX: 10, clientY: 20 });
    expect(toolClick).not.toHaveBeenCalled();
    const img = (await screen.findByRole("img", { name: /Street photo 1/ })) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(`/api/street-photos/panoramax/photos/${REF}/sd`);
    const near = String(fetchImpl.mock.calls.find((c) => String(c[0]).includes("/near?"))![0]);
    expect(near).toContain("lon=2.350100&lat=48.849800");
    expect(screen.getByText("Photo 1 of 2")).toBeTruthy();
    expect(screen.getByText("360° photo")).toBeTruthy();
    expect(screen.getByText("By Camille")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Licence: CC-BY-SA-4.0" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Panoramax" }).getAttribute("href")).toContain("pic=");
    expect(screen.getByText(/not saved with the project/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Photo 2 of 2")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Street photo 2/ }).getAttribute("src")).toContain(other);

    // A drag pans the map and searches nothing.
    const calls = fetchImpl.mock.calls.length;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 20 });
    fireEvent.click(canvas, { clientX: 80, clientY: 20 });
    expect(fetchImpl.mock.calls.length).toBe(calls);

    // Closing removes the coverage and gives the tool its clicks back.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(layers.size).toBe(0);
    expect(canvas.style.cursor).toBe("");
    fireEvent.click(canvas);
    expect(toolClick).toHaveBeenCalledTimes(1);
  });

  it("says when there are no photos near the point, and when the search fails", async () => {
    stubApi(["panoramax"], []);
    const { map, canvas } = fakeMap();
    renderControls(map);
    fireEvent.click(await screen.findByRole("button", { name: "Street photos" }));
    fireEvent.click(canvas);
    expect(await screen.findByText(/No photos within 30 m/)).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "Panoramax did not answer in time" }, { status: 504 })),
    );
    fireEvent.click(canvas);
    await waitFor(() =>
      expect(
        screen.getByText("The photos could not be loaded: Panoramax did not answer in time"),
      ).toBeTruthy(),
    );
  });
});

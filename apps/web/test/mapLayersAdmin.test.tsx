import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ Marker: undefined }));

import { MapLayersAdmin, type MapLayerService } from "../src/admin/MapLayersAdmin";
import {
  availableBasemaps,
  availableOverlays,
  basemapStyle,
  loadServerBasemaps,
  OGC_PLUGIN,
  type ServiceLayer,
} from "../src/map/basemaps";
import { MapControls } from "../src/map/MapControls";
import { applyOverlays } from "../src/map/overlays";
import { activePlugins, type Plugin } from "../src/plugins/registry";

// A made-up secret with little variety, so secret scanners do not take it for a real one.
const SECRET = `test-${"x".repeat(20)}KEY9`;
const SID = "0b7d8a52-3c1e-4d1f-9a6b-1f2e3d4c5b6a";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const topo: ServiceLayer = {
  id: `ogc-${SID}-0`,
  label: "Topographic map",
  service: "Topographic map",
  kind: "wms",
  showAs: "basemap",
  tiles: [`/api/map-layers/${SID}/0/tiles/{z}/{x}/{y}`],
  tileSize: 256,
  minzoom: 2,
  maxzoom: 18,
  bounds: [5.8, 47.2, 15.1, 55.1],
  attribution: "© Example contributors",
};
const landCover: ServiceLayer = {
  ...topo,
  id: `ogc-${SID}-1`,
  label: "Land cover",
  kind: "wmts",
  showAs: "overlay",
  tiles: [`/api/map-layers/${SID}/1/tiles/{z}/{x}/{y}`],
};

const answer = (layers: unknown[]) =>
  vi.fn(
    async () => new Response(JSON.stringify({ available: [], layers }), { status: 200 }),
  ) as unknown as typeof fetch;

describe("WMS, WMTS and XYZ layers on the map", () => {
  it("offers an Admin's layers as basemaps and overlays only in projects that use the plugin", async () => {
    expect(
      await loadServerBasemaps(answer([topo, landCover, { id: "evil", tiles: ["https://x.example/{z}"] }])),
    ).toBe(true);
    const on = activePlugins();
    expect(on.some((p) => p.id === OGC_PLUGIN)).toBe(true);
    const base = availableBasemaps(on).find((b) => b.id === topo.id)!;
    expect(base).toMatchObject({ label: "Topographic map", tag: "WMS", kind: "aerial", note: "" });
    expect(base.attribution).toContain("© Example contributors");
    expect(availableBasemaps(on).some((b) => b.id === landCover.id)).toBe(false);
    expect(availableOverlays(on).map((l) => l.id)).toEqual([landCover.id]);
    // A layer whose tiles do not come through the API is never offered.
    expect(availableOverlays(on).some((l) => l.id === "evil")).toBe(false);

    const off: Plugin[] = on.filter((p) => p.id !== OGC_PLUGIN);
    expect(availableBasemaps(off).some((b) => b.id === topo.id)).toBe(false);
    expect(availableOverlays(off)).toEqual([]);

    const style = basemapStyle(base, { version: 8, sources: {}, layers: [] });
    expect(style.sources[topo.id]).toMatchObject({
      type: "raster",
      tiles: [`${window.location.origin}/api/map-layers/${SID}/0/tiles/{z}/{x}/{y}`],
      minzoom: 2,
      maxzoom: 18,
      bounds: [5.8, 47.2, 15.1, 55.1],
    });
    await loadServerBasemaps(answer([]));
  });

  it("draws picked overlays under the project's layers and takes them away again", () => {
    let layers = [{ id: "background" }, { id: "labels" }, { id: "sl-line" }];
    const sources: Record<string, unknown> = { openmaptiles: {} };
    const map = {
      getStyle: () => ({ layers, sources }),
      getLayer: (id: string) => layers.find((l) => l.id === id),
      getSource: (id: string) => sources[id],
      addSource: vi.fn((id: string, s: unknown) => (sources[id] = s)),
      addLayer: vi.fn((l: { id: string }, before?: string) => {
        const i = before ? layers.findIndex((x) => x.id === before) : layers.length;
        layers = [...layers.slice(0, i), { id: l.id }, ...layers.slice(i)];
      }),
      removeLayer: vi.fn((id: string) => (layers = layers.filter((l) => l.id !== id))),
      removeSource: vi.fn((id: string) => delete sources[id]),
    };
    // Without markBasemap every layer counts as the project's: the overlay goes first. Mark the basemap's.
    const m = map as unknown as MapLibreMap;
    applyOverlays(m, [landCover], new Set([landCover.id]));
    expect(map.addSource).toHaveBeenCalledWith(
      landCover.id,
      expect.objectContaining({ type: "raster", attribution: "© Example contributors" }),
    );
    expect(layers.map((l) => l.id)).toContain(landCover.id);
    applyOverlays(m, [landCover], new Set());
    expect(layers.map((l) => l.id)).not.toContain(landCover.id);
    expect(sources[landCover.id]).toBeUndefined();
  });

  it("lists overlays in the layer control with a switch", async () => {
    await loadServerBasemaps(answer([landCover]));
    const onOverlays = vi.fn();
    const map = {
      getStyle: () => ({ layers: [] }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as MapLibreMap;
    render(
      <MapControls
        map={map}
        basemap={availableBasemaps()[0]!}
        onBasemap={() => {}}
        hidden={new Set()}
        onHidden={() => {}}
        overlays={new Set()}
        onOverlays={onOverlays}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Land cover/ }));
    expect(onOverlays).toHaveBeenCalledWith(new Set([landCover.id]));
    await loadServerBasemaps(answer([]));
  });
});

describe("WMS, WMTS and XYZ services in Administration", () => {
  it("reads a service's layers with its key, adds the picked ones and never shows the key again", async () => {
    let services: MapLayerService[] = [];
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/admin/map-layers/inspect")
          return new Response(
            JSON.stringify({
              kind: "wmts",
              title: "Land cover",
              attribution: "Example Drive",
              layers: [
                { id: "lc2020", title: "Land cover 2020" },
                {
                  id: "geo",
                  title: "Only geographic",
                  problem: "no tile matrix set on the Web Mercator grid",
                },
              ],
            }),
            { status: 200 },
          );
        if (url === "/api/admin/map-layers" && init?.method === "POST")
          services = [
            {
              id: SID,
              kind: "wmts",
              name: "Land cover",
              address: "api.example.com/v3/ogc/wmts/085f",
              auth: { type: "query", name: "token" },
              showAs: "overlay",
              attribution: "Example Drive",
              layers: [{ id: "lc2020", title: "Land cover 2020" }],
              addedAt: "2026-11-18T17:00:00Z",
              addedBy: "Alice",
              builtin: false,
              hidden: false,
            },
          ];
        if (url === "/api/basemaps") return new Response(JSON.stringify({ available: [] }), { status: 200 });
        return new Response(JSON.stringify({ services }), { status: 200 });
      }),
    );
    const run = async (f: () => Promise<unknown>) => void (await f());
    render(<MapLayersAdmin csrfToken="csrf-1" run={run} />);
    expect(await screen.findByText("No services added yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Service type"), { target: { value: "wmts" } });
    fireEvent.change(screen.getByLabelText("Service address"), {
      target: { value: "https://api.example.com/v3/ogc/wmts/085f?request=getCapabilities" },
    });
    fireEvent.change(screen.getByLabelText("Sign-in"), { target: { value: "query" } });
    fireEvent.change(screen.getByLabelText("Parameter name"), { target: { value: "token" } });
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Read layers" }));
    // The one usable layer is picked; the other cannot be.
    const lc = (await screen.findByRole("checkbox", { name: /Land cover 2020/ })) as HTMLInputElement;
    expect(lc.checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Only geographic/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("Attribution (who the data comes from)") as HTMLInputElement).value).toBe(
      "Example Drive",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Overlay" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to the map" }));
    expect(await screen.findByText("api.example.com/v3/ogc/wmts/085f")).toBeTruthy();

    const add = calls.find((c) => c.url === "/api/admin/map-layers" && c.init?.method === "POST")!;
    expect(JSON.parse(String(add.init?.body))).toEqual({
      kind: "wmts",
      url: "https://api.example.com/v3/ogc/wmts/085f?request=getCapabilities",
      auth: { type: "query", name: "token", secret: SECRET },
      name: "Land cover",
      attribution: "Example Drive",
      showAs: "overlay",
      layers: ["lc2020"],
    });
    expect((add.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByText(new RegExp(SECRET))).toBeNull();
  });

  it("hides a built-in service instead of removing it, and shows it again", async () => {
    const svc: MapLayerService = {
      id: SID,
      kind: "xyz",
      name: "OpenTopoMap",
      address: "a.tile.opentopomap.org/{z}/{x}/{y}.png",
      auth: { type: "none", name: null },
      showAs: "basemap",
      attribution: "© OpenTopoMap",
      layers: [{ id: "tiles", title: "a.tile.opentopomap.org" }],
      addedAt: "2026-11-18T17:00:00Z",
      addedBy: null,
      builtin: true,
      hidden: false,
    };
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "PUT") svc.hidden = JSON.parse(String(init.body)).hidden;
        if (url === "/api/basemaps") return new Response(JSON.stringify({ available: [] }), { status: 200 });
        return new Response(JSON.stringify({ services: [{ ...svc }] }), { status: 200 });
      }),
    );
    render(<MapLayersAdmin csrfToken="csrf-1" run={async (f) => void (await f())} />);
    expect(await screen.findByText("Built in")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove OpenTopoMap" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide OpenTopoMap" }));
    expect(await screen.findByText("Hidden")).toBeTruthy();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe(`/api/admin/map-layers/${SID}/hidden`);
    expect(JSON.parse(String(put.init?.body))).toEqual({ hidden: true });
    fireEvent.click(screen.getByRole("button", { name: "Show OpenTopoMap again" }));
    expect(await screen.findByRole("button", { name: "Hide OpenTopoMap" })).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeodataApi, GeodataStatus, ImportRun } from "../src/features/geodata/api";
import { MapDataPanel } from "../src/features/geodata/MapDataPanel";
import { dataProject, setDataProject, withProject } from "../src/geodata/projectData";

afterEach(() => {
  cleanup();
  setDataProject(null);
});

const LIMITS = {
  overpassMaxKm2: 400,
  osmMaxAreaKm2: 20000,
  demMaxAreaKm2: 20000,
  maxPbfMb: 4000,
  demUploadMaxMb: 500,
};
const none = { current: null, latest: null };

function run(over: Partial<ImportRun> = {}): ImportRun {
  return {
    id: "run-1",
    kind: "osm",
    method: "overpass",
    status: "done",
    bbox: [7, 50, 7.1, 50.1],
    bufferKm: 2,
    options: {},
    progress: {},
    stats: { rows: { osm_way_road: 12, osm_way_rail: 1, osm_building: 30, osm_pt: 4 } },
    source: { dataTimestamp: "2026-11-15T08:00:00Z", via: "Overpass" },
    error: null,
    createdAt: "2026-11-16T10:00:00Z",
    startedAt: "2026-11-16T10:00:00Z",
    finishedAt: "2026-11-16T10:01:00Z",
    ...over,
  };
}

function status(over: Partial<GeodataStatus> = {}): GeodataStatus {
  return {
    canImport: true,
    area: {
      bbox: [7, 50, 7.1, 50.1],
      areaKm2: 80,
      polygons: [
        {
          id: "a1",
          name: "Trier",
          ring: [
            [7, 50],
            [7.1, 50],
            [7.1, 50.1],
            [7, 50],
          ],
        },
      ],
    },
    osm: none,
    dem: none,
    demUpload: none,
    suggestedMethod: "overpass",
    limits: LIMITS,
    ...over,
  };
}

function fakeApi(
  first: GeodataStatus,
  after: GeodataStatus = first,
): GeodataApi & Record<string, ReturnType<typeof vi.fn>> {
  let calls = 0;
  return {
    status: vi.fn(async () => (calls++ === 0 ? first : after)),
    regions: vi.fn(async () => [
      { id: "nordrhein-westfalen", name: "Nordrhein-Westfalen", parent: "germany", bboxKm2: 40000 },
    ]),
    startOsm: vi.fn(async () => run({ status: "queued" })),
    uploadPbf: vi.fn(async () => run({ status: "queued", method: "upload" })),
    startDem: vi.fn(async () => run({ kind: "dem", method: "copernicus", status: "queued" })),
    cancel: vi.fn(async () => run({ status: "cancelled" })),
    uploadDem: vi.fn(async () => run({ kind: "dem_upload", method: "geotiff", status: "queued" })),
    remove: vi.fn(async () => undefined),
  };
}

describe("map data requests", () => {
  it("add the open project and its import to tile URLs and terrain bodies", () => {
    expect(withProject("/api/street-network/tiles/14/1/2")).toBe("/api/street-network/tiles/14/1/2");
    setDataProject("p-1", "imp 1");
    expect(withProject("/api/street-network/tiles/14/1/2")).toBe(
      "/api/street-network/tiles/14/1/2?project=p-1&osm=imp%201",
    );
    expect(withProject("/api/street-network/water?bbox=1,2,3,4")).toBe(
      "/api/street-network/water?bbox=1,2,3,4&project=p-1&osm=imp%201",
    );
    expect(dataProject()).toBe("p-1");
    setDataProject(null, "imp 1");
    expect(withProject("/x")).toBe("/x");
  });
});

describe("terrain requests", () => {
  it("send the session's CSRF token", async () => {
    const { setCsrfToken } = await import("../src/session/csrf");
    const { fetchElevations } = await import("../src/terrain/terrain");
    setCsrfToken("tok-1");
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ elevationsM: [1], source: {} }), { status: 200 }),
    );
    await fetchElevations([[7.123, 50.456]], fetchImpl as unknown as typeof fetch);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok-1");
    setCsrfToken(null);
  });
});

describe("Map data panel", () => {
  it("asks for a drawing when the project has no area", async () => {
    render(<MapDataPanel api={fakeApi(status({ area: null }))} map={null} />);
    expect(await screen.findByText(/Draw the project area first/)).toBeTruthy();
  });

  it("shows the current import and reports it to the map tools", async () => {
    const onOsmImport = vi.fn();
    render(
      <MapDataPanel
        api={fakeApi(status({ osm: { current: run(), latest: run(), coversDrawing: false } }))}
        map={null}
        onOsmImport={onOsmImport}
      />,
    );
    expect(await screen.findByText(/12 roads, 1 railways, 30 buildings, 4 stops/)).toBeTruthy();
    expect(screen.getByText(/reaches outside the imported area/)).toBeTruthy();
    expect(onOsmImport).toHaveBeenCalledWith("run-1");
  });

  it("starts an Overpass import with planned roads and follows it", async () => {
    const api = fakeApi(
      status(),
      status({ osm: { current: null, latest: run({ status: "running", progress: { step: "extract" } }) } }),
    );
    render(<MapDataPanel api={api} map={null} />);
    await screen.findByText(/box around it, 80 km²/);
    fireEvent.click(screen.getByLabelText(/Keep planned roads/));
    fireEvent.click(screen.getAllByRole("button", { name: "Import" })[0]!);
    await waitFor(() => expect(api.startOsm).toHaveBeenCalledWith({ method: "overpass", planned: true }));
    expect(await screen.findByText("Cutting out the project area…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("run-1"));
    // It answers at once: the bar says it is stopping, and Cancel is not offered twice.
    expect(screen.getByText("Stopping after the current step…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows how far an import is with a progress bar", async () => {
    const api = fakeApi(
      status({
        osm: {
          current: null,
          latest: run({
            status: "running",
            method: "overpass",
            progress: { step: "download", done: 3, total: 12 },
          }),
        },
      }),
    );
    render(<MapDataPanel api={api} map={null} />);
    const bar = await screen.findByRole("progressbar", { name: "OpenStreetMap" });
    // Overpass: download, join, write; a quarter of the tiles are in, so a twelfth of the whole job.
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    expect(bar.getAttribute("aria-valuenow")).toBe("8");
    expect(screen.getByText("Downloading 3 of 12…")).toBeTruthy();
  });

  it("offers Geofabrik regions for an area too large for Overpass", async () => {
    const api = fakeApi(
      status({
        area: { bbox: [6, 50, 8, 51], areaKm2: 15000, polygons: [] },
        suggestedMethod: "geofabrik",
      }),
    );
    render(<MapDataPanel api={api} map={null} />);
    expect(((await screen.findByRole("option", { name: /Overpass/ })) as HTMLOptionElement).disabled).toBe(
      true,
    );
    expect(await screen.findByRole("option", { name: /Nordrhein-Westfalen/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Import" })[0]!);
    await waitFor(() =>
      expect(api.startOsm).toHaveBeenCalledWith({
        method: "geofabrik",
        region: "nordrhein-westfalen",
        planned: false,
      }),
    );
  });

  it("says Geofabrik cannot be reached instead of that no region holds the area", async () => {
    const api = fakeApi(
      status({
        area: { bbox: [6, 50, 8, 51], areaKm2: 15000, polygons: [] },
        suggestedMethod: "geofabrik",
      }),
    );
    api.regions = vi.fn(async () => {
      throw new Error("Geofabrik is unreachable: connect ETIMEDOUT");
    });
    render(<MapDataPanel api={api} map={null} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Geofabrik is unreachable/);
    expect(screen.queryByText("No Geofabrik region holds the whole area.")).toBeNull();
    // The method no longer stays on Geofabrik: the area is too large for Overpass, so it is the file upload.
    expect((screen.getByLabelText("Get the data from") as HTMLSelectElement).value).toBe("upload");
  });

  it("starts the elevation import and hides imports from viewers", async () => {
    const api = fakeApi(status());
    render(<MapDataPanel api={api} map={null} />);
    await screen.findByText(/box around it, 80 km²/);
    const buttons = screen.getAllByRole("button", { name: "Import" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(api.startDem).toHaveBeenCalled());
    cleanup();
    render(<MapDataPanel api={fakeApi(status({ canImport: false }))} map={null} />);
    expect(await screen.findByText("Owners and Editors can import data.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("names the project area's polygons and has no buffer to set", async () => {
    render(<MapDataPanel api={fakeApi(status())} map={null} />);
    expect(
      await screen.findByText("Project area: Trier. The imports cover the box around it, 80 km²."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Buffer (km)")).toBeNull();
  });

  it("uploads the planner's own elevation grid with its source, and removes it", async () => {
    const own = run({
      id: "own-1",
      kind: "dem_upload",
      method: "geotiff",
      source: {
        name: "City LiDAR",
        licence: "CC BY 4.0",
        verticalAccuracyM: 0.15,
        resolutionM: 1,
        crs: "EPSG:25832",
      },
      stats: { notes: ["The file has 2 bands; the first was read."] },
    });
    const api = fakeApi(status(), status({ demUpload: { current: own, latest: own } }));
    render(<MapDataPanel api={api} map={null} />);
    await screen.findByText(/box around it, 80 km²/);
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "City LiDAR" } });
    fireEvent.change(screen.getByLabelText("Vertical accuracy (m)"), { target: { value: "0.15" } });
    const file = new File([new Uint8Array([73, 73, 42, 0])], "lidar.tif", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText(/Choose a GeoTIFF file/), { target: { files: [file] } });
    await waitFor(() =>
      expect(api.uploadDem).toHaveBeenCalledWith(file, {
        crs: "",
        source: "City LiDAR",
        licence: "",
        accuracy: 0.15,
      }),
    );
    expect(await screen.findByText(/1 m grid, EPSG:25832 · heights within ±0.15 m · CC BY 4.0/)).toBeTruthy();
    expect(screen.getByText("The file has 2 bands; the first was read.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("own-1"));
  });
});

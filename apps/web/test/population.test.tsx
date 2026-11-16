import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PopulationApi, PopulationLayer, PopulationOverview } from "../src/features/population/api";
import { csvColumns, formatOf, geojsonFields, guessField } from "../src/features/population/files";
import { latticePixels, legend, scaleTop } from "../src/features/population/mapLayer";
import { PopulationPanel } from "../src/features/population/PopulationPanel";

afterEach(cleanup);

describe("population files", () => {
  it("tells the format from the name", () => {
    expect(formatOf("pop.TIF")).toBe("geotiff");
    expect(formatOf("zones.geojson")).toBe("geojson");
    expect(formatOf("census.csv")).toBe("csv");
    expect(formatOf("readme.pdf")).toBeNull();
  });

  it("reads CSV columns with any delimiter, and GeoJSON fields", () => {
    expect(csvColumns('﻿"lon";"lat";"people"\n1;2;3')).toEqual(["lon", "lat", "people"]);
    expect(csvColumns("x\ty\tpop\n")).toEqual(["x", "y", "pop"]);
    const gj = JSON.stringify({
      type: "FeatureCollection",
      features: [{ properties: { id: 1, inhabitants: 5 } }, { properties: { id: 2, name: "b" } }],
    });
    expect(geojsonFields(gj)).toEqual(["id", "inhabitants", "name"]);
    expect(geojsonFields("not json")).toEqual([]);
    expect(guessField(["id", "inhabitants"], /pop|inhab|people/i)).toBe("inhabitants");
  });
});

describe("population map layer", () => {
  it("scales to the 98th percentile and leaves empty cells clear", () => {
    expect(scaleTop([])).toBe(1);
    expect(scaleTop([0, 10, -20])).toBe(20);
    const view = {
      grid: { x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 1, values: [0, 4] },
      cellM: 100,
      bbox: [0, 0, 2, 1] as [number, number, number, number],
    };
    const { pixels, top } = latticePixels(view, false);
    expect(top).toBe(4);
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(200);
  });

  it("colours a difference blue for more and red for fewer", () => {
    const view = {
      grid: { x0: 0, y0: 0, dx: 1, dy: 1, nx: 2, ny: 1, values: [-5, 5] },
      cellM: 100,
      bbox: [0, 0, 2, 1] as [number, number, number, number],
    };
    const { pixels } = latticePixels(view, true);
    expect(pixels[0]).toBeGreaterThan(pixels[2]!); // red
    expect(pixels[6]).toBeGreaterThan(pixels[4]!); // blue
    const l = legend(true, 10);
    expect(l.map((e) => e.value)).toEqual([-10, -5, 0, 5, 10]);
  });
});

function layer(over: Partial<PopulationLayer>): PopulationLayer {
  return {
    id: "a",
    name: "Census 2022",
    source: "upload",
    kind: "zones",
    status: "ready",
    error: null,
    progress: null,
    licence: "CC BY 4.0",
    sourceUrl: "",
    citation: "",
    confidence: "high",
    referenceYear: 2022,
    resolutionM: null,
    coverage: [0, 0, 1, 1],
    peopleTotal: 1234,
    featureCount: 3,
    isPrimary: false,
    options: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function fakeApi(layers: PopulationLayer[]): PopulationApi & { setPrimary: ReturnType<typeof vi.fn> } {
  const overview: PopulationOverview = {
    area: { bbox: [0, 0, 1, 1], drawnBbox: [0.1, 0.1, 0.9, 0.9], bufferKm: 2 },
    bufferKm: 2,
    areaKm2: 12345,
    layers,
    choices: {
      worldpopYears: { first: 2015, last: 2030 },
      ghslEpochs: [2020, 2025, 2030],
      ghslResolutions: ["3ss", "30ss"],
      maxUploadMb: 200,
      maxAreaKm2: 10000,
      maxFeatures: 2000000,
    },
  };
  const setPrimary = vi.fn(async (id: string | null) =>
    layers.map((l) => ({ ...l, isPrimary: l.id === id })),
  );
  return {
    overview: vi.fn(async () => overview),
    setBuffer: vi.fn(async () => overview),
    startImport: vi.fn(),
    upload: vi.fn(),
    layer: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setPrimary,
    lattice: vi.fn(),
    grid: vi.fn(),
    catchments: vi.fn(),
  } as unknown as PopulationApi & { setPrimary: ReturnType<typeof vi.fn> };
}

const noMap = {
  getLayer: () => undefined,
  getSource: () => undefined,
  addSource: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
} as unknown as MapLibreMap;

describe("Population view", () => {
  it("lists the layers and changes the one the project uses", async () => {
    const api = fakeApi([layer({})]);
    const onPrimaryChange = vi.fn();
    render(<PopulationPanel map={noMap} api={api} editable onPrimaryChange={onPrimaryChange} />);
    const select = await screen.findByRole("combobox", { name: "Population used by the project" });
    expect(screen.getAllByText(/Census 2022/).length).toBeGreaterThan(0);
    fireEvent.change(select, { target: { value: "a" } });
    await waitFor(() => expect(api.setPrimary).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(onPrimaryChange).toHaveBeenCalled());
  });

  it("warns when the project area is too large to import", async () => {
    render(<PopulationPanel map={noMap} api={fakeApi([])} editable onPrimaryChange={() => undefined} />);
    expect(await screen.findByText(/Imports cover at most/)).toBeTruthy();
  });
});

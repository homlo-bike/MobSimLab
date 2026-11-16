import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("maplibre-gl", () => ({
  Marker: class {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    on() {
      return this;
    }
    getLngLat() {
      return { lng: 0, lat: 0 };
    }
    remove() {}
  },
}));
vi.mock("../src/features/journey-planner/mapLayers", () => ({
  ensureLayers: vi.fn(),
  removeLayers: vi.fn(),
  drawNetwork: vi.fn(),
  drawJourney: vi.fn(),
  drawZones: vi.fn(),
}));

import * as wasm from "../src/wasm/mode-kits/mode_kits_wasm.js";
import { drawZones } from "../src/features/journey-planner/mapLayers";
import { JourneyPlanner } from "../src/features/journey-planner/JourneyPlanner";
import type { PlannerLoader } from "../src/features/journey-planner/types";
import { loadKits, zoneSystem } from "../src/kits/engine";
import type { LonLat } from "../src/kits/types";
import { type DemandZone, type ZoneDoc, ZoneEditor } from "../src/kits/ZoneEditor";
import { centralValues, findMode, pluginTools } from "../src/plugins/registry";

beforeAll(async () => {
  // Built by tools/wasm/build-mode-kits.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/mode-kits/mode_kits_wasm_bg.wasm");
  await wasm.default({ module_or_path: readFileSync(file) });
});

beforeEach(() => localStorage.clear());

/** A square zone of `side` metres near 50° N, west-south corner at 10° E. */
function square(side: number): LonLat[] {
  const dLon = side / (111_320 * Math.cos((50 * Math.PI) / 180));
  const dLat = side / 111_320;
  return [
    [10, 50],
    [10 + dLon, 50],
    [10 + dLon, 50 + dLat],
    [10, 50 + dLat],
  ];
}

const tool = pluginTools().find((t) => t.id === "on-demand-bus")!;

describe("on-demand bus plugin", () => {
  it("adds the service zone tool with the drt values", () => {
    expect(tool.kit).toBe("service-zone");
    const mode = findMode("on_demand_bus")!.mode;
    expect([mode.operation, mode.gtfsRouteType, mode.parameterPrefix]).toEqual(["on_demand", 715, "drt"]);
    const sys = zoneSystem(centralValues("on_demand_bus", "*"));
    expect(sys).toMatchObject({
      speed_kmh: 25,
      stop_dwell_s: 32,
      pooling_detour_share: 0.2,
      max_wait_s: 600,
    });
  });

  it("estimates a zone in WebAssembly", async () => {
    const kits = await loadKits();
    const v = kits.estimateZone({
      ring: square(4000),
      requests_per_hour: 60,
      fleet: 8,
      start_s: 6 * 3600,
      end_s: 22 * 3600,
      system: zoneSystem(centralValues("on_demand_bus", "*")),
    });
    expect(v.area_km2).toBeCloseTo(16, 1);
    expect(v.vehicles_needed).toBeGreaterThan(3);
    expect(v.wait_s).toBeGreaterThan(60);
    expect(v.requests_per_day).toBe(960);
    const short = kits.estimateZone({
      ring: square(4000),
      requests_per_hour: 400,
      fleet: 2,
      start_s: 0,
      end_s: 3600,
      system: zoneSystem({}),
    });
    expect(short.wait_s).toBeNull();
    expect(short.issues.map((i) => i.code)).toContain("zone.fleet_short");
  });

  it("zone editor shows the estimate and hands the zone to the journey planner", async () => {
    const doc: ZoneDoc = {
      name: "Hillside",
      mode: "on_demand_bus",
      ring: square(3000),
      requestsPerHour: 40,
      fleet: 6,
      from: "06:00",
      to: "22:00",
    };
    localStorage.setItem("k-zone", JSON.stringify(doc));
    const onZone = vi.fn();
    render(<ZoneEditor map={null} tool={tool} storageKey="k-zone" onZoneChange={onZone} />);
    await screen.findByText("Vehicles needed");
    expect(screen.getByText("Outline points: 4")).toBeTruthy();
    expect(screen.getByText("Zone area").nextSibling?.textContent).toBe("9.0 km²");
    await waitFor(() =>
      expect(onZone).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Hillside" })),
    );
    // Too few vehicles: the estimate says so.
    fireEvent.change(screen.getByLabelText("Vehicles"), { target: { value: "1" } });
    expect((await screen.findAllByText("fleet too small")).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear the outline" }));
    await waitFor(() => expect(onZone).toHaveBeenLastCalledWith(null));
  });
});

describe("on-demand zones in the journey planner", () => {
  it("shows the zone and an on-demand trip when A and B are inside", async () => {
    const kits = await loadKits();
    const ring = square(3000);
    const view = kits.estimateZone({
      ring,
      requests_per_hour: 40,
      fleet: 6,
      start_s: 0,
      end_s: 3600,
      system: zoneSystem(centralValues("on_demand_bus", "*")),
    });
    const zone: DemandZone = { id: "on-demand-bus", name: "Hillside", color: "#9333ea", ring, view };
    const handlers: ((e: { lngLat: { lng: number; lat: number } }) => void)[] = [];
    const map = {
      on: (_: string, f: (typeof handlers)[number]) => handlers.push(f),
      off: () => {},
      getCanvas: () => null,
    } as unknown as MapLibreMap;
    const click = ([lng, lat]: LonLat) => handlers.forEach((f) => f({ lngLat: { lng, lat } }));
    const loader: PlannerLoader = vi.fn();
    render(<JourneyPlanner map={map} loadPlanner={loader} demandZones={[zone]} />);
    expect(vi.mocked(drawZones)).toHaveBeenLastCalledWith(map, [zone]);
    const use = screen.getByRole("checkbox", { name: /^On-demand bus “Hillside” \(wait about/ });
    fireEvent.click(screen.getByRole("button", { name: /^A: / }));
    act(() => click([10.005, 50.005]));
    act(() => click([10.03, 50.02]));
    const trip = screen.getByTestId("on-demand").textContent!;
    expect(trip).toMatch(/^On-demand bus “Hillside” from A to B: about .+ door to door/);
    fireEvent.click(use);
    expect(screen.queryByTestId("on-demand")).toBeNull();
    expect(vi.mocked(drawZones)).toHaveBeenLastCalledWith(map, []);
  });
});

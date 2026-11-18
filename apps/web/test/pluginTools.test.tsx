import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
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

import * as wasm from "../src/wasm/mode-kits/mode_kits_wasm.js";
import { pluginLineTimetable, type PluginLineInput } from "../src/features/journey-planner/network";
import { loadKits, spanSystem, vesselType } from "../src/kits/engine";
import { SpanLineEditor, removeStation, type SpanDoc, type TerrainLoader } from "../src/kits/SpanLineEditor";
import { sectionGround, type TerrainProfiles } from "../src/terrain/terrain";
import { WaterRouteEditor, removePier, sharedPier, type WaterDoc } from "../src/kits/WaterRouteEditor";
import { newToolLineKey, toolLineKeys, type SavedPluginLine } from "../src/kits/saved";
import {
  centralValues,
  contextLabel,
  findMode,
  PLUGINS,
  pluginCalculation,
  pluginTools,
} from "../src/plugins/registry";

beforeAll(async () => {
  // Built by tools/wasm/build-mode-kits.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/mode-kits/mode_kits_wasm_bg.wasm");
  await wasm.default({ module_or_path: readFileSync(file) });
});

beforeEach(() => localStorage.clear());

/** Purpose: `[lon, lat]` `x` metres east of a point near Koblenz. */
const east = (x: number): [number, number] => [
  7.6 + x / (111_320 * Math.cos((50.36 * Math.PI) / 180)),
  50.36,
];

describe("plugin registry", () => {
  it("lists the bundled cable car and ferry plugins with their tools and modes", () => {
    const ids = PLUGINS.map((p) => p.id);
    expect(ids).toContain("org.mobsimlab.aerial-lift");
    expect(ids).toContain("org.mobsimlab.ferry");
    expect(pluginTools().map((t) => [t.id, t.kit])).toEqual(
      expect.arrayContaining([
        ["cable-car", "straight-spans"],
        ["ferry", "water-route"],
      ]),
    );
    expect(findMode("ferry")?.mode.gtfsRouteType).toBe(4);
    expect(findMode("cable_car")?.mode.gtfsRouteType).toBe(6);
    expect(contextLabel("cable_car", "3s")).toBe("Tricable gondola (3S)");
    expect(pluginCalculation("no_such_calculation")).toBeNull();
  });

  it("resolves parameter values per system", () => {
    const mgd = centralValues("cable_car", "mgd");
    expect(mgd["ropeway.line_speed_ms"]).toBe(6);
    expect(mgd["ropeway.cabin_capacity"]).toBe(10);
    // Keys without a system entry fall back to the global value.
    expect(mgd["ropeway.min_clearance_m"]).toBe(5);
    expect(centralValues("ferry", "hydrofoil")["ferry.passenger_capacity"]).toBe(30);
  });
});

describe("kits", () => {
  it("builds the research example: 10-place MGD cabins every 12 s carry 3,000 p/h/dir", async () => {
    const kits = await loadKits();
    const system = spanSystem("mgd", "continuous", centralValues("cable_car", "mgd"));
    const v = kits.buildSpanLine({
      stations: [
        { name: "A", lonlat: east(0), kind: "terminal", boarding: false, elevation_m: 0 },
        { name: "B", lonlat: east(1800), kind: "terminal", boarding: false, elevation_m: 0 },
      ],
      system,
      towers: [],
    });
    expect(Math.round(v.capacity_pphpd)).toBe(3000);
    expect(v.stops).toHaveLength(2);
    expect(v.sections[0]!.spans_m.every((s) => s <= system.max_span_m + 1e-6)).toBe(true);
    expect(v.issues.some((i) => i.level === "error")).toBe(false);
  });

  it("finds a berth conflict on the segment engine", async () => {
    const kits = await loadKits();
    const v = kits.buildWaterLine({
      piers: [
        { name: "North", lonlat: east(0), berths: 1, gangways: 1 },
        { name: "South", lonlat: east(600), berths: 1, gangways: 1 },
      ],
      calls: [
        { pier: 0, via: [] },
        { pier: 1, via: [] },
      ],
      vessel: vesselType("monohull", centralValues("ferry", "monohull")),
      headway_s: 300,
      layover_s: 400,
      pax_per_call: 60,
      speed_zones: [],
    });
    expect(v.holds).toBeGreaterThan(0);
    expect(v.issues.map((i) => i.code)).toContain("berth.conflict");
  });
});

describe("editors", () => {
  const cableTool = pluginTools().find((t) => t.id === "cable-car")!;
  const ferryTool = pluginTools().find((t) => t.id === "ferry")!;

  it("cable car editor shows the summary and hands the line to the journey planner", async () => {
    const doc: SpanDoc = {
      name: "Rhine",
      mode: "cable_car",
      system: "mgd",
      stations: [
        { name: "Old Town", lonlat: east(0), kind: "terminal", boarding: false, elevation_m: 0 },
        { name: "Middle", lonlat: east(900), kind: "intermediate", boarding: false, elevation_m: 0 },
        { name: "Fortress", lonlat: east(1800), kind: "terminal", boarding: false, elevation_m: 110 },
      ],
      towers: [null, null],
      lineSpeed: null,
      interval: null,
    };
    localStorage.setItem("k-cable", JSON.stringify(doc));
    const onLine = vi.fn();
    const noTerrain: TerrainLoader = () => Promise.reject(new Error("offline"));
    render(
      <SpanLineEditor
        map={null}
        tool={cableTool}
        storageKey="k-cable"
        onLineChange={onLine}
        loadTerrain={noTerrain}
      />,
    );
    await screen.findByText("Capacity per direction");
    expect(screen.getByText("3,000 p/h")).toBeTruthy();
    await waitFor(() => expect(onLine).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Rhine" })));
    const line = onLine.mock.lastCall![0] as PluginLineInput;
    expect(line.stops.map((s) => s.name)).toEqual(["Old Town", "Middle", "Fortress"]);
    expect(line.directions[1]!.map((s) => s.stop)).toEqual([2, 1, 0]);
    expect(line.headwayS).toBe(60);
    // Making the middle station an angle station without boarding drops it from the stops.
    fireEvent.change(screen.getByLabelText("Station 2 kind"), { target: { value: "angle" } });
    await waitFor(() => expect((onLine.mock.lastCall![0] as PluginLineInput).stops).toHaveLength(2));
  });

  it("people mover editor counts trains from the round trip and names piers and headway", async () => {
    const apmTool = pluginTools().find((t) => t.id === "people-mover")!;
    expect(apmTool.kit).toBe("straight-spans");
    const doc: SpanDoc = {
      name: "Airport link",
      mode: "people_mover",
      system: "pinched_loop",
      stations: [
        { name: "Station", lonlat: east(0), kind: "terminal", boarding: false, elevation_m: 0 },
        { name: "Garage", lonlat: east(2500), kind: "intermediate", boarding: false, elevation_m: 0 },
        { name: "Terminal", lonlat: east(5000), kind: "terminal", boarding: false, elevation_m: 0 },
      ],
      towers: [null, null],
      lineSpeed: null,
      interval: null,
      terrain: false,
    };
    localStorage.setItem("k-apm", JSON.stringify(doc));
    const onLine = vi.fn();
    render(<SpanLineEditor map={null} tool={apmTool} storageKey="k-apm" onLineChange={onLine} />);
    await screen.findByText("Capacity per direction");
    // 113 passengers every 240 s; 2 × (500 s + 40 s stop + 40 s turn) / 240 s = 4.8, so 5 trains.
    expect(screen.getByText("1,695 p/h")).toBeTruthy();
    expect(screen.getByText("Trains")).toBeTruthy();
    expect(screen.getByText("Piers")).toBeTruthy();
    expect(screen.getByText("Train every")).toBeTruthy();
    expect((screen.getByLabelText("Headway (s)") as HTMLInputElement).value).toBe("240");
    expect(screen.getAllByText(/piers: \d+ \(automatic\)/)).toHaveLength(2);
    await waitFor(() =>
      expect(onLine).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "people_mover" })),
    );
    expect((onLine.mock.lastCall![0] as PluginLineInput).headwayS).toBe(240);
  });

  it("people mover shuttle runs two trains back and forth", async () => {
    const kits = await loadKits();
    const v = centralValues("people_mover_shuttle", "shuttle");
    expect(v["people_mover.line_speed_ms"]).toBe(10.5);
    const system = spanSystem("shuttle", "reversible", v, {}, "people_mover", "train");
    const view = kits.buildSpanLine({
      stations: [
        { name: "A", lonlat: east(0), kind: "terminal", boarding: false, elevation_m: 0 },
        { name: "B", lonlat: east(650), kind: "terminal", boarding: false, elevation_m: 0 },
      ],
      system,
      towers: [],
    });
    expect(view.cabins).toBe(2);
    // 650 m at 10.5 m/s = 62 s, + 20 s acceleration loss, + 40 s dwell: a departure every 122 s.
    expect(Math.round(view.headway_s)).toBe(122);
    expect(view.sections[0]!.spans_m.every((s) => s <= 40 + 1e-6)).toBe(true);
    expect(view.issues.some((i) => i.level === "error")).toBe(false);
  });

  it("cable car editor stands stations on the terrain and checks clearance over buildings", async () => {
    const doc: SpanDoc = {
      name: "Valley",
      mode: "cable_car",
      system: "mgd",
      stations: [
        { name: "West", lonlat: east(0), kind: "terminal", boarding: false, elevation_m: 0 },
        { name: "East", lonlat: east(400), kind: "terminal", boarding: false, elevation_m: 0 },
      ],
      towers: [[]],
      lineSpeed: null,
      interval: null,
    };
    localStorage.setItem("k-terrain", JSON.stringify(doc));
    // A valley 40 m deep between stations at 120 m and 125 m, with a 45 m building at its middle.
    const samples = Array.from({ length: 17 }, (_, i) => ({
      distM: i * 25,
      lon: 0,
      lat: 0,
      elevationM: i === 0 ? 120 : i === 16 ? 125 : 80,
    }));
    const terrain: TerrainProfiles = {
      spacingM: 25,
      lines: [
        {
          lengthM: 400,
          samples,
          buildings: [{ fromM: 190, toM: 210, heightM: 45, estimated: true, osmId: 1 }],
        },
      ],
      source: {
        id: "copernicus_glo30",
        name: "Copernicus DEM GLO-30",
        kind: "DSM",
        note: "",
        resolutionM: 30,
        verticalAccuracyM: 4,
        verticalAccuracyNote: "",
        url: "",
        licence: "",
      },
      buildingSource: { name: "OSM", note: "", licence: "© OpenStreetMap contributors", url: "" },
    };
    const loadTerrain = vi.fn<TerrainLoader>(async () => terrain);
    render(<SpanLineEditor map={null} tool={cableTool} storageKey="k-terrain" loadTerrain={loadTerrain} />);
    await screen.findByText(/Copernicus DEM GLO-30/);
    expect(loadTerrain).toHaveBeenCalledWith([[east(0), east(400)]]);
    expect((screen.getByLabelText("Station 1 ground height") as HTMLInputElement).value).toBe("120");
    expect((screen.getByLabelText("Station 2 ground height") as HTMLInputElement).value).toBe("125");
    expect(screen.getAllByText("from terrain")).toHaveLength(2);
    expect(screen.getByText(/1 without a height in OSM/)).toBeTruthy();
    expect(screen.getByText(/within .* of the ground; at least/)).toBeTruthy();
    // A typed height overrides the terrain until the planner goes back to it.
    fireEvent.change(screen.getByLabelText("Station 1 ground height"), { target: { value: "200" } });
    await waitFor(() => expect(screen.getAllByText("from terrain")).toHaveLength(1));
    fireEvent.click(screen.getByText("Use terrain"));
    await waitFor(() => expect(screen.getAllByText("from terrain")).toHaveLength(2));
  });

  it("puts buildings on the terrain beside them", () => {
    const g = sectionGround(
      {
        lengthM: 200,
        samples: [0, 50, 100, 150, 200].map((d) => ({
          distM: d,
          lon: 0,
          lat: 0,
          elevationM: d === 100 ? 130 : 100,
        })),
        buildings: [{ fromM: 90, toM: 110, heightM: 30, estimated: false, osmId: 7 }],
      },
      210,
    );
    // The DEM sample on the roof is gone; the building stands on the lowest terrain near it.
    expect(g.some((s) => s.z_m === 130)).toBe(false);
    const roof = g.filter((s) => s.obstacle_m === 30);
    expect(roof.length).toBeGreaterThanOrEqual(3);
    expect(roof.every((s) => s.z_m === 100)).toBe(true);
    // Chainages scale to the kit's section length.
    expect(roof[0]!.at_m).toBeCloseTo(94.5, 6);
  });

  it("ferry editor shows vessels and the berth check", async () => {
    const doc: WaterDoc = {
      name: "Harbour",
      mode: "ferry",
      vessel: "monohull",
      piers: [
        { name: "Landing A", lonlat: east(0), berths: 1, gangways: 1 },
        { name: "Landing B", lonlat: east(2000), berths: 1, gangways: 1 },
      ],
      calls: [
        { pier: 0, via: [] },
        { pier: 1, via: [] },
      ],
      zones: [],
      headwayMin: 15,
      layoverS: null,
      paxPerCall: null,
      speedKn: null,
    };
    localStorage.setItem("k-ferry", JSON.stringify(doc));
    const onLine = vi.fn();
    render(<WaterRouteEditor map={null} tool={ferryTool} storageKey="k-ferry" onLineChange={onLine} />);
    await screen.findByText("Vessels");
    expect(screen.getByText("Berth waits (3 h)")).toBeTruthy();
    await waitFor(() => expect(onLine).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "ferry" })));
    const line = onLine.mock.lastCall![0] as PluginLineInput;
    expect(line.headwayS).toBe(900);
    const tt = pluginLineTimetable(line)!;
    expect(tt.routes[0]!.mode).toBe("ferry");
    expect(tt.frequency_patterns).toHaveLength(2);
    expect(tt.stops[0]!.stop_id).toBe("plugin:ferry:0");
  });

  it("editors save the drawing, the line and the noise shape with the project", async () => {
    const cable: SpanDoc = {
      name: "Rhine",
      mode: "cable_car",
      system: "mgd",
      stations: [
        { name: "Old Town", lonlat: east(0), kind: "terminal", boarding: false, elevation_m: 0 },
        { name: "Fortress", lonlat: east(1800), kind: "terminal", boarding: false, elevation_m: 110 },
      ],
      towers: [null],
      lineSpeed: null,
      interval: null,
    };
    // A drawing kept on this device before is not read when the project has one.
    localStorage.setItem("k-old", JSON.stringify({ ...cable, name: "Old copy" }));
    const onSave = vi.fn();
    const noTerrain: TerrainLoader = () => Promise.reject(new Error("offline"));
    render(
      <SpanLineEditor
        map={null}
        tool={cableTool}
        storageKey="k-old"
        initial={cable}
        onSave={onSave}
        loadTerrain={noTerrain}
      />,
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const span = onSave.mock.lastCall![0] as SavedPluginLine;
    expect(span.kit).toBe("straight-spans");
    expect((span.doc as SpanDoc).name).toBe("Rhine");
    expect(span.line?.stops).toHaveLength(2);
    expect(span.noise).toMatchObject({ kit: "straight-spans", mode: "cable_car", system: "mgd" });
    if (span.noise?.kit !== "straight-spans") throw new Error("span shape");
    expect(span.noise.stations).toHaveLength(2);
    expect(span.noise.towers.length).toBeGreaterThan(0);
    // With the project saving it, the device's copy is left alone.
    expect(JSON.parse(localStorage.getItem("k-old")!).name).toBe("Old copy");
    cleanup();

    const water: WaterDoc = {
      name: "Harbour",
      mode: "ferry",
      vessel: "monohull",
      piers: [
        { name: "Landing A", lonlat: east(0), berths: 1, gangways: 1 },
        { name: "Landing B", lonlat: east(2000), berths: 1, gangways: 1 },
      ],
      calls: [
        { pier: 0, via: [] },
        { pier: 1, via: [] },
      ],
      zones: [],
      headwayMin: 15,
      layoverS: null,
      paxPerCall: null,
      speedKn: null,
    };
    const onWater = vi.fn();
    render(
      <WaterRouteEditor map={null} tool={ferryTool} storageKey="k-w" initial={water} onSave={onWater} />,
    );
    await waitFor(() => expect(onWater).toHaveBeenCalled());
    const ferry = onWater.mock.lastCall![0] as SavedPluginLine;
    if (ferry.noise?.kit !== "water-route") throw new Error("water shape");
    expect(ferry.noise.headway_s).toBe(900);
    expect(ferry.noise.legs).toHaveLength(1);
    // Each pier is an end: the dwell there one way and the layover after it.
    expect(ferry.noise.berths.every((b) => b.docked_s > 0)).toBe(true);
    expect(localStorage.getItem("k-w")).toBeNull();
  });

  it("removing a station or pier keeps the drawing consistent", () => {
    const s: SpanDoc = {
      name: "x",
      mode: "cable_car",
      system: "mgd",
      stations: [0, 1, 2].map((i) => ({
        name: `${i}`,
        lonlat: east(i * 500),
        kind: "intermediate",
        boarding: false,
        elevation_m: 0,
      })),
      towers: [[{ at_m: 100 }], [{ at_m: 200 }]],
      lineSpeed: null,
      interval: null,
    };
    const r = removeStation(s, 1);
    expect(r.stations.map((x) => x.name)).toEqual(["0", "2"]);
    expect(r.towers).toEqual([null]);
    const w: WaterDoc = {
      name: "y",
      mode: "ferry",
      vessel: "monohull",
      piers: [0, 1, 2].map((i) => ({ name: `${i}`, lonlat: east(i * 500), berths: 1, gangways: 1 })),
      calls: [0, 1, 2, 1].map((pier) => ({ pier, via: [] })),
      zones: [],
      headwayMin: 10,
      layoverS: null,
      paxPerCall: null,
      speedKn: null,
    };
    expect(removePier(w, 1).calls.map((c) => c.pier)).toEqual([0, 1]);
  });

  it("keeps several ferry lines apart and shares a pier placed on another line's pier", async () => {
    const tools = { ferry: 1, "ferry-3": 1, "ferry-2": 1, "cable-car": 1, "ferry-x": 1 };
    expect(toolLineKeys(tools, "ferry")).toEqual(["ferry", "ferry-2", "ferry-3"]);
    expect(newToolLineKey(tools, "ferry")).toBe("ferry-4");
    expect(newToolLineKey({ "cable-car": 1 }, "ferry")).toBe("ferry");
    const pier = { name: "Jounieh port", lonlat: east(0), berths: 1, gangways: 1 };
    expect(sharedPier(east(40), [pier])?.name).toBe("Jounieh port");
    expect(sharedPier(east(100), [pier])).toBeNull();
    // The line the journey planner rides carries the line's own id, not the tool's.
    const water: WaterDoc = {
      name: "F2",
      mode: "ferry",
      vessel: "monohull",
      piers: [
        { name: "A", lonlat: east(0), berths: 1, gangways: 1 },
        { name: "B", lonlat: east(2000), berths: 1, gangways: 1 },
      ],
      calls: [
        { pier: 0, via: [] },
        { pier: 1, via: [] },
      ],
      zones: [],
      headwayMin: 15,
      layoverS: null,
      paxPerCall: null,
      speedKn: null,
    };
    const onSave = vi.fn();
    const onPick = vi.fn();
    render(
      <WaterRouteEditor
        map={null}
        tool={ferryTool}
        storageKey="k-f2"
        initial={water}
        onSave={onSave}
        lineId="ferry-2"
        lines={[
          { id: "ferry", name: "F1" },
          { id: "ferry-2", name: "F2" },
        ]}
        onPickLine={onPick}
        onNewLine={() => {}}
        onDeleteLine={() => {}}
      />,
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.lastCall![0] as SavedPluginLine).line?.id).toBe("ferry-2");
    fireEvent.change(screen.getByLabelText("Ferry lines in the project (2)"), { target: { value: "ferry" } });
    expect(onPick).toHaveBeenCalledWith("ferry");
  });
  it("lists the cable car lines and saves each under its own id", async () => {
    const onLine = vi.fn();
    const onNew = vi.fn();
    render(
      <SpanLineEditor
        map={null}
        tool={cableTool}
        storageKey="k-cable-2"
        onLineChange={onLine}
        lineId="cable-car-2"
        lines={[
          { id: "cable-car", name: "C1" },
          { id: "cable-car-2", name: "C2" },
        ]}
        onPickLine={() => {}}
        onNewLine={onNew}
        onDeleteLine={() => {}}
      />,
    );
    expect(await screen.findByLabelText("Lines in the project (2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New line" }));
    expect(onNew).toHaveBeenCalled();
  });
});

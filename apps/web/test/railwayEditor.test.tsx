import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
vi.mock("../src/features/railways/mapLayers", async (orig) => ({
  ...(await orig<typeof import("../src/features/railways/mapLayers")>()),
  ensureRailLayers: vi.fn(),
  removeRailLayers: vi.fn(),
  drawRail: vi.fn(),
  showConnections: vi.fn(),
}));

import * as wasm from "../src/wasm/rail-design/rail_design_wasm.js";
import {
  addStation,
  addSwitch,
  autoLeads,
  deleteElement,
  resetSignals,
  emptyNetwork,
  kindOf,
  newTrack,
  nextId,
  updateSignal,
} from "../src/features/railways/doc";
import { loadRailEngine } from "../src/features/railways/engine";
import { metres } from "../src/features/railways/mapLayers";
import { clearPlaces, publishPlaces } from "../src/features/naming/registry";
import { fmtM, fmtTime, shiftLevel } from "../src/features/railways/modes";
import { RailwayEditor } from "../src/features/railways/RailwayEditor";
import {
  addLine,
  engineLines,
  hhmm,
  insertStop,
  lineProblem,
  linesTrainLength,
  moveStop,
  parseHhmm,
  removeLine,
  suggestTrain,
  trainById,
  updateLine,
} from "../src/features/railways/serviceLines";
import type { Network, RailEngine, RailMode } from "../src/features/railways/types";

beforeAll(async () => {
  // The engine module is built by tools/wasm/build-rail-design.sh; load its bytes from disk.
  const file = resolve(__dirname, "../src/wasm/rail-design/rail_design_wasm_bg.wasm");
  await wasm.default({ module_or_path: readFileSync(file) });
});

const ORIGIN: [number, number] = [7, 50.9];

/** The engine's sample drawing of a mode at the origin. */
function sample(mode: RailMode): Network {
  return JSON.parse(wasm.RailDesigner.sample(mode, ORIGIN[0], ORIGIN[1])) as Network;
}

/** One OSM street tile: a north–south street through the origin's longitude. */
function streetTile(lat0: number, lat1: number, tags: Record<string, string> = {}): string {
  const t = { highway: "secondary", name: "Station Road", bus: "designated", ...tags };
  return `<osm version="0.6">
  <node id="1" lon="${ORIGIN[0]}" lat="${lat0}"/>
  <node id="2" lon="${ORIGIN[0]}" lat="${lat1}"/>
  <way id="100"><nd ref="1"/><nd ref="2"/>${Object.entries(t)
    .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
    .join("")}</way>
</osm>`;
}

/** An OSM railway tile: a tram line from the origin 700 m east along the x axis. */
function railTile(tags: Record<string, string> = {}): string {
  const t = { railway: "tram", name: "Harbour Tram", gauge: "1435", electrified: "contact_line", ...tags };
  return `<osm version="0.6">
  <node id="11" lon="${ORIGIN[0]}" lat="${ORIGIN[1]}"/>
  <node id="12" lon="${ORIGIN[0] + 0.01}" lat="${ORIGIN[1]}"/>
  <way id="200"><nd ref="11"/><nd ref="12"/>${Object.entries(t)
    .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
    .join("")}</way>
</osm>`;
}

/** A single storage track along the x axis through the origin, 800 m long. */
function lineAcross(mode: RailMode): Network {
  const net = emptyNetwork(mode, ORIGIN);
  const t = newTrack(
    net,
    { type: "free", x: -400, y: 0 },
    { tracks: 1, level: "street", power: "auto", use: "storage" },
  );
  return { ...net, tracks: [{ ...t, end: { type: "free", x: 400, y: 0 } }] };
}

describe("railway document edits", () => {
  it("gives ids unique across element types and names stations", () => {
    let d = emptyNetwork("metro", ORIGIN);
    expect(nextId(d)).toBe(1);
    const opts = { level: "street" as const, sides: 0, islands: 1, platformLength: 120 };
    const [d1, a] = addStation(d, [0, 0], opts);
    const [d2, b] = addStation(d1, [500, 0], opts);
    d = d2;
    expect([a, b]).toEqual([1, 2]);
    expect(d.stations.map((s) => s.name)).toEqual(["Riverside", "Northgate"]);
    const t = newTrack(
      d,
      { type: "station", station: 1, end: 1, tracks: [0, 1] },
      {
        tracks: 2,
        level: "street",
        power: "auto",
        use: "running",
      },
    );
    expect(t.id).toBe(3);
    d = { ...d, tracks: [{ ...t, end: { type: "station", station: 2, end: 0, tracks: [0, 1] } }] };
    expect(kindOf(d, 3)).toBe("track");
    expect(kindOf(d, 9)).toBeNull();
  });

  it("keeps a track's shape when the station it ends at is deleted", () => {
    let d = emptyNetwork("metro", ORIGIN);
    [d] = addStation(d, [0, 0], { level: "street", sides: 0, islands: 1, platformLength: 120 });
    const t = newTrack(
      d,
      { type: "free", x: -300, y: 0 },
      { tracks: 1, level: "underground", power: "auto", use: "running" },
    );
    d = { ...d, tracks: [{ ...t, end: { type: "station", station: 1, end: 0, tracks: [0] } }] };
    const out = deleteElement(d, 1, () => [-65, 1.8]);
    expect(out.stations).toHaveLength(0);
    expect(out.tracks[0]!.end).toEqual({ type: "free", x: -65, y: 1.8, level: "underground" });
    expect(out.tracks[0]!.start).toEqual({ type: "free", x: -300, y: 0, level: "underground" });
  });

  it("deletes the switches on a deleted track", () => {
    let d = emptyNetwork("tram", ORIGIN);
    const t = newTrack(
      d,
      { type: "free", x: 0, y: 0 },
      { tracks: 1, level: "street", power: "auto", use: "running" },
    );
    d = { ...d, tracks: [{ ...t, end: { type: "free", x: 400, y: 0 } }] };
    [d] = addSwitch(d, { kind: "turnout", track: t.id, s: 100, element: "x", side: -1 });
    expect(d.switches[0]!.side).toBe(-1);
    expect(deleteElement(d, t.id, () => null).switches).toHaveLength(0);
  });

  it("sets the straight out of a connection to a share of the distance to the next point", () => {
    const t = newTrack(
      emptyNetwork("metro", ORIGIN),
      { type: "station", station: 1, end: 1, tracks: [0] },
      {
        tracks: 1,
        level: "street",
        power: "auto",
        use: "running",
      },
    );
    const start = { p: [0, 0] as [number, number], dir: [1, 0] as [number, number] };
    expect(autoLeads(t, start, null, [400, 100], 20).lead_start_m).toBeCloseTo(120);
    expect(autoLeads(t, start, null, [30, 100], 20).lead_start_m).toBe(20);
  });
});

describe("railway helpers", () => {
  it("draws widths to scale", () => {
    const e = metres(1.435, 0) as unknown as (string | number | string[])[];
    // At zoom 20 on the equator one pixel is 78,271.5 / 2^20 = 0.0746 m.
    const at20 = e[e.indexOf(20) + 1] as number;
    expect(at20).toBeCloseTo(1.435 / (78271.517 / 2 ** 20), 3);
  });

  it("formats lengths, times and levels", () => {
    expect(fmtM(85.4)).toBe("85 m");
    expect(fmtM(1250)).toBe("1.25 km");
    expect(fmtTime(125)).toBe("2:05 min");
    expect(shiftLevel("street", 1)).toBe("elevated");
    expect(shiftLevel("underground2", -1)).toBe("underground2");
  });
});

describe("railway engine (WebAssembly)", () => {
  const modes: RailMode[] = ["tram", "metro", "regional_rail", "high_speed_rail"];
  it.each(modes)("builds the %s example without errors", async (mode) => {
    const e = await loadRailEngine();
    const doc = e.sample(mode, ORIGIN);
    const v = e.build(doc, null);
    expect(v.counts.errors).toBe(0);
    expect(v.switches.length).toBeGreaterThan(0);
    expect(v.layers.tracks.features.length).toBeGreaterThan(0);
    expect(v.connections.length).toBeGreaterThan(0);
    e.dispose();
  });

  it("crosses a tram line and a regional railway on one shared diamond", async () => {
    const e = await loadRailEngine();
    const v = e.build(e.sample("regional_rail", ORIGIN), null);
    const diamond = v.crossings.find((c) => c.kind === "diamond");
    expect(diamond?.modes).toEqual(["regional_rail", "tram"]);
    expect(diamond?.id).toMatch(/^x\d+-\d+-0$/);
    expect(v.issues.some((i) => /Only one train at a time/.test(i.text))).toBe(true);
    expect(v.counts.errors).toBe(0);
    expect(Object.keys(v.modes).sort()).toEqual(["regional_rail", "tram"]);
    // Sleepers of both systems share one layer per level, under all rails of that level.
    const modes = new Set(v.layers.tracks.features.map((f) => f.properties.mode));
    expect(modes).toEqual(new Set(["regional_rail", "tram"]));
    e.dispose();
  });

  it("exports the track topology of the last build for operations", async () => {
    const e = await loadRailEngine();
    e.build(e.sample("metro", ORIGIN), null);
    const t = e.topology() as {
      schema: string;
      valid: boolean;
      sections: { id: string }[];
      switches: { id: number; legs: string[] }[];
      platform_edges: unknown[];
    };
    expect(t.schema).toBe("mobsimlab.rail-topology/1");
    expect(t.valid).toBe(true);
    expect(t.sections.map((s) => s.id)).toContain("s1.0");
    expect(t.switches.map((s) => s.id)).toEqual([4, 5]);
    expect(t.platform_edges).toHaveLength(4);
    e.dispose();
  });

  it("finds level crossings with streets and exports them for operations", async () => {
    const e = await loadRailEngine();
    expect(e.addStreetTile(streetTile(50.899, 50.901))).toBe(1);
    const v = e.build(lineAcross("regional_rail"), null);
    expect(v.level_crossings).toHaveLength(1);
    const x = v.level_crossings[0]!;
    expect(x).toMatchObject({ street: "Station Road", protection: "barriers", standard: true, bus: true });
    expect(x.angle_deg).toBeCloseTo(90, 0);
    expect(v.issues.some((i) => /Level crossing with Station Road/.test(i.text))).toBe(true);
    const kinds = v.layers.level_crossings.features.map((f) => f.properties?.kind);
    expect(kinds).toEqual(expect.arrayContaining(["deck", "stop_line", "barrier"]));
    const t = e.topology() as {
      level_crossings: { id: string; sections: string[]; street: { way: number } }[];
    };
    expect(t.level_crossings[0]).toMatchObject({
      id: "lc1-100-0",
      sections: ["t1.0.0"],
      street: { way: 100 },
    });
    // A metro line may not cross a street on the level; a street on a bridge is no crossing.
    const m = e.build(lineAcross("metro"), null);
    expect(m.level_crossings[0]).toMatchObject({ standard: false, special_measures: ["mode", "third_rail"] });
    expect(m.issues.some((i) => i.severity === "error")).toBe(false);
    expect(
      m.issues.some((i) => i.severity === "warning" && /normally have no level crossings/.test(i.text)),
    ).toBe(true);
    e.clearStreets();
    e.addStreetTile(streetTile(50.899, 50.901, { bridge: "yes" }));
    expect(e.build(lineAcross("regional_rail"), null).level_crossings).toHaveLength(0);
    e.dispose();
  });

  it("finds a tram running along a street, keeps it to the street's speed limit and exports it", async () => {
    const e = await loadRailEngine();
    e.addStreetTile(streetTile(50.898, 50.902, { highway: "primary", name: "High Street", lanes: "4" }));
    const net = emptyNetwork("tram", ORIGIN);
    const t = newTrack(
      net,
      { type: "free", x: 0, y: -400 },
      { tracks: 2, level: "street", power: "auto", use: "running" },
    );
    const v = e.build({ ...net, tracks: [{ ...t, end: { type: "free", x: 0, y: 400 } }] }, null);
    expect(v.street_running).toHaveLength(1);
    expect(v.street_running[0]).toMatchObject({
      street: "High Street",
      running: "reserved",
      speed_limit_kmh: 50,
    });
    expect(v.level_crossings).toHaveLength(0);
    expect(v.layers.street_running.features.length).toBe(2);
    const topo = e.topology() as { street_running: { id: string; running: string }[] };
    expect(topo.street_running[0]).toMatchObject({ id: "sr1-100-0", running: "reserved" });
    // Two lanes are too narrow for a tram lane and a road lane each way: the tram runs in traffic.
    e.clearStreets();
    e.addStreetTile(streetTile(50.898, 50.902, { highway: "primary", name: "High Street", lanes: "2" }));
    const m = e.build({ ...net, tracks: [{ ...t, end: { type: "free", x: 0, y: 400 } }] }, null);
    expect(m.street_running[0]!.running).toBe("mixed");
    expect(m.issues.some((i) => i.severity === "warning" && /held up in traffic jams/.test(i.text))).toBe(
      true,
    );
    // Set up in the GIS tab with its own lane, separated: the warning is resolved.
    e.setStreetSetups([{ way: 100, tram: "own_lane", separated: true, bike_lane: true }]);
    const s = e.build({ ...net, tracks: [{ ...t, end: { type: "free", x: 0, y: 400 } }] }, null);
    expect(s.street_running[0]).toMatchObject({
      running: "reserved",
      separated: true,
      source: "setup",
      traffic_delay_share: 0,
    });
    expect(s.issues.some((i) => i.severity === "warning" && /traffic jams|Cyclists/.test(i.text))).toBe(
      false,
    );
    e.dispose();
  });

  it("joins new track to an existing railway, checks the join and exports it", async () => {
    const e = await loadRailEngine();
    expect(e.addRailTile(railTile())).toBe(1);
    const net = emptyNetwork("tram", ORIGIN);
    const t = newTrack(
      net,
      { type: "free", x: -400, y: 0 },
      { tracks: 1, level: "street", power: "auto", use: "running" },
    );
    const doc = { ...net, tracks: [{ ...t, end: { type: "free" as const, x: 0, y: 0 } }] };
    const v = e.build(doc, null);
    expect(v.existing_count).toBe(1);
    expect(v.existing_joins).toHaveLength(1);
    expect(v.existing_joins[0]).toMatchObject({ track: t.id, end: 1, name: "Harbour Tram", continues: true });
    expect(v.issues.some((i) => /Open track end/.test(i.text))).toBe(false);
    expect(v.layers.existing.features.map((f) => f.properties.kind)).toEqual(["tram", "join"]);
    const topo = e.topology() as { existing_joins: { way: number; nodes: string[] }[] };
    expect(topo.existing_joins[0]).toMatchObject({ way: 200 });
    expect(topo.existing_joins[0]!.nodes).toHaveLength(1);
    // A click near the existing line snaps onto it.
    const snap = e.existingSnap([ORIGIN[0] + 0.005, ORIGIN[1] + 0.00002], 10);
    expect(snap).toMatchObject({ way: 200, railway: "tram" });
    expect(snap!.lonlat[1]).toBeCloseTo(ORIGIN[1], 6);
    // Metre gauge cannot take standard gauge trams.
    e.clearRails();
    e.addRailTile(railTile({ gauge: "1000" }));
    const m = e.build(doc, null);
    expect(m.issues.some((i) => i.severity === "error" && /gauge \(1435 mm\) differs/.test(i.text))).toBe(
      true,
    );
    e.dispose();
  });

  it("builds a double slip into a 1:9 diamond and exports its turning routes", async () => {
    const e = await loadRailEngine();
    const net = emptyNetwork("regional_rail", ORIGIN);
    const n = 9;
    const [c, s] = [n / Math.hypot(1, n), 1 / Math.hypot(1, n)];
    const opts = {
      tracks: 1 as const,
      level: "street" as const,
      power: "auto" as const,
      use: "storage" as const,
    };
    const t1 = newTrack(net, { type: "free", x: -300, y: 0 }, opts);
    const n1 = { ...net, tracks: [{ ...t1, end: { type: "free" as const, x: 300, y: 0 } }] };
    const t2 = newTrack(n1, { type: "free", x: -300 * c, y: -300 * s }, opts);
    const doc = {
      ...n1,
      tracks: [...n1.tracks, { ...t2, end: { type: "free" as const, x: 300 * c, y: 300 * s } }],
    };
    const v = e.build(doc, null);
    const x = v.crossings[0]!;
    expect(x.ratio_n).toBeCloseTo(9, 1);
    expect(x.single_tracks).toBe(true);
    expect(v.slip_elements.map((el) => el.element)).toEqual(
      expect.arrayContaining(["single_slip", "double_slip"]),
    );
    const dkw = v.slip_elements.find((el) => el.element === "double_slip")!;
    const w = e.build({ ...doc, slips: [{ crossing: x.id, element: dkw.id }] }, null);
    expect(w.slips[0]).toMatchObject({ kind: "double_slip", routes: 2, ok: true });
    expect(w.layers.tracks.features.filter((f) => f.properties.kind === "slip")).toHaveLength(2);
    const topo = e.topology() as { crossings: { slip: { routes: unknown[] } | null }[] };
    expect(topo.crossings[0]!.slip!.routes).toHaveLength(2);
    e.dispose();
  });

  it("generates signals from the design and keeps the planner's changes on top", async () => {
    const e = await loadRailEngine();
    const doc = e.sample("regional_rail", ORIGIN);
    const v = e.build(doc, null);
    expect(v.signals.length).toBeGreaterThan(5);
    expect(v.signals.every((s) => s.auto)).toBe(true);
    expect(v.signals_edited).toBe(false);
    expect(Math.min(...v.signals.map((s) => s.id))).toBe(nextId(doc));
    expect(v.layers.signals.features.filter((f) => f.properties.kind === "signal")).toHaveLength(
      v.signals.length,
    );
    expect((e.topology() as { signals_generated: boolean }).signals_generated).toBe(true);
    // Deleting a generated signal keeps it out, and says what is then unprotected.
    const first = v.signals.find((s) => s.kind === "main")!;
    expect(kindOf(doc, first.id, v.signals)).toBe("signal");
    const fewer = deleteElement(doc, first.id, () => null, v.signals);
    expect(fewer.signals_removed).toHaveLength(1);
    const v2 = e.build(fewer, null);
    expect(v2.signals).toHaveLength(v.signals.length - 1);
    expect(v2.signals_edited).toBe(true);
    expect(v2.issues.some((i) => /^No (signal in front of|starter signal)/.test(i.text))).toBe(true);
    // Editing a generated signal makes it the planner's, with the same id.
    const named = updateSignal(doc, first.id, (x) => ({ ...x, name: "A1" }), v.signals);
    expect(named.signals).toEqual([expect.objectContaining({ id: first.id, name: "A1" })]);
    const v3 = e.build(named, null);
    expect(v3.signals).toHaveLength(v.signals.length);
    expect(v3.signals.find((s) => s.id === first.id)).toMatchObject({ auto: false, name: "A1" });
    const t = e.topology() as { signals_generated: boolean; signals: { id: string }[] };
    expect(t.signals_generated).toBe(false);
    expect(t.signals.map((s) => s.id)).toContain(`sg${first.id}`);
    expect(resetSignals(named)).not.toHaveProperty("signals");
    // A click beside a track finds where a signal would stand.
    expect(e.signalAnchor(v.signals[0]!.lonlat, 10)).not.toBeNull();
    expect(e.signalAnchor([ORIGIN[0] + 1, ORIGIN[1]], 10)).toBeNull();
    e.dispose();
  });

  it("generates distant and speed signals on lineside lines", async () => {
    const e = await loadRailEngine();
    const v = e.build(e.sample("light_rail", ORIGIN), null);
    const speed = v.signals.filter((s) => s.kind === "speed");
    expect(speed.length).toBeGreaterThan(0);
    expect(speed.every((s) => (s.speed_kmh ?? 0) > 0)).toBe(true);
    expect(v.signals.some((s) => s.kind === "speed_warning")).toBe(true);
    const t = e.topology() as { signals: { kind: string; speed_kmh: number | null }[] };
    expect(t.signals.filter((s) => s.kind === "speed").every((s) => s.speed_kmh !== null)).toBe(true);
    const c = e.build(e.sample("commuter_rail", ORIGIN), null);
    expect(c.signals.some((s) => s.kind === "distant")).toBe(true);
    e.dispose();
  });

  it("reports a curve tighter than the minimum radius", async () => {
    const e = await loadRailEngine();
    const doc: Network = {
      ...emptyNetwork("metro", ORIGIN),
      tracks: [
        {
          ...newTrack(
            emptyNetwork("metro", ORIGIN),
            { type: "free", x: 0, y: 0 },
            {
              tracks: 1,
              level: "street",
              power: "auto",
              use: "running",
            },
          ),
          points: [{ x: 60, y: 0 }],
          end: { type: "free", x: 60, y: 60 },
        },
      ],
    };
    const v = e.build(doc, null);
    expect(v.issues.some((i) => i.severity === "error" && /below the 100 m minimum/.test(i.text))).toBe(true);
    e.dispose();
  });

  it("finds the track under a point and maps it to local metres", async () => {
    const e = await loadRailEngine();
    const doc = e.sample("metro", ORIGIN);
    const v = e.build(doc, null);
    const mid = v.tracks.find((t) => t.id === 3)!.centre;
    const at = mid[Math.floor(mid.length / 2)]!;
    const hit = e.nearestTrack(at, 5);
    expect(hit?.track).toBe(3);
    expect(hit!.distance).toBeLessThan(0.5);
    const [x, y] = e.toLocal(ORIGIN, [ORIGIN[0] + 0.001, ORIGIN[1]]);
    expect(x).toBeCloseTo(70.4, 0);
    expect(Math.abs(y)).toBeLessThan(0.01);
    e.dispose();
  });
});

/** A map with only what the editor touches. */
function fakeMap() {
  const handlers = new Map<string, (ev: unknown) => void>();
  const map = {
    on: (t: string, f: (ev: unknown) => void) => handlers.set(t, f),
    off: (t: string) => handlers.delete(t),
    getZoom: () => 16,
    getCenter: () => ({ lng: ORIGIN[0], lat: ORIGIN[1] }),
    getBounds: () => ({
      getWest: () => ORIGIN[0] - 0.01,
      getEast: () => ORIGIN[0] + 0.01,
      getSouth: () => ORIGIN[1] - 0.01,
      getNorth: () => ORIGIN[1] + 0.01,
    }),
    getSource: () => undefined,
    getLayer: () => undefined,
    queryRenderedFeatures: () => [],
    getCanvas: () => ({ style: {} as CSSStyleDeclaration }),
    doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
    dragPan: { disable: vi.fn(), enable: vi.fn() },
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    // About a pixel a metre around the origin.
    project: ([lng, lat]: [number, number]) => ({
      x: (lng - ORIGIN[0]) * 70_000,
      y: -(lat - ORIGIN[1]) * 111_000,
    }),
  };
  return { map: map as unknown as MapLibreMap, handlers };
}

describe("Railway editor", () => {
  /** Open the editor, on the engine's sample drawing of `mode` when one is given. */
  async function opened({
    mode,
    fetchTile = () => Promise.reject(new Error("offline")),
    fetchRails = () => Promise.reject(new Error("offline")),
    existingRailways = false,
    onPublish,
  }: {
    mode?: RailMode;
    fetchTile?: (x: number, y: number) => Promise<string>;
    fetchRails?: (x: number, y: number) => Promise<string>;
    existingRailways?: boolean;
    onPublish?: (tt: unknown) => void;
  } = {}) {
    let engine: RailEngine | null = null;
    const { map, handlers } = fakeMap();
    render(
      <RailwayEditor
        map={map}
        fetchTile={fetchTile}
        fetchRails={fetchRails}
        existingRailways={existingRailways}
        initial={mode ? sample(mode) : null}
        onPublish={onPublish}
        loadEngine={async () => (engine = await loadRailEngine())}
      />,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    if (mode) await screen.findByText(/0 errors/);
    return { map, handlers, engine: () => engine! };
  }

  it("opens the drawing saved with the project and reports each change for saving", async () => {
    const [saved] = addStation(lineAcross("tram"), [0, 0], {
      level: "street",
      sides: 2,
      islands: 0,
      platformLength: 40,
      name: "Old Town",
    });
    const onDocChange = vi.fn();
    const { map } = fakeMap();
    render(
      <RailwayEditor
        map={map}
        fetchTile={() => Promise.reject(new Error("offline"))}
        loadEngine={loadRailEngine}
        initial={saved}
        onDocChange={onDocChange}
      />,
    );
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/Old Town/).length).toBeGreaterThan(0);
    expect(onDocChange).toHaveBeenLastCalledWith(saved);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onDocChange).toHaveBeenLastCalledWith(expect.objectContaining({ stations: [], tracks: [] }));
  });

  it("saves a new drawing only once something is drawn", async () => {
    const onDocChange = vi.fn();
    const { map, handlers } = fakeMap();
    render(
      <RailwayEditor
        map={map}
        fetchTile={() => Promise.reject(new Error("offline"))}
        loadEngine={loadRailEngine}
        onDocChange={onDocChange}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /Station/ })).toBeTruthy());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onDocChange).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
    act(() => handlers.get("click")!({ lngLat: { lng: ORIGIN[0], lat: ORIGIN[1] }, point: { x: 0, y: 0 } }));
    await waitFor(() =>
      expect(onDocChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ stations: [expect.anything()] }),
      ),
    );
  });

  it("places a station where the planner clicks", async () => {
    const { handlers } = await opened();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: /Station/ }).getAttribute("aria-pressed")).toBe("true");
    act(() => handlers.get("click")!({ lngLat: { lng: ORIGIN[0], lat: ORIGIN[1] }, point: { x: 0, y: 0 } }));
    expect(await screen.findByDisplayValue("Riverside")).toBeTruthy();
    expect(screen.getByText(/2 tracks · 2 platform edges/)).toBeTruthy();
  });

  it("names a station placed beside a bus stop after it, and a far one uniquely", async () => {
    publishPlaces("street", [
      { id: "street:1", name: "Harbour", lonlat: [ORIGIN[0] + 0.001, ORIGIN[1]] },
      { id: "street:2", name: "Riverside", lonlat: [ORIGIN[0] + 0.05, ORIGIN[1]] },
    ]);
    const { handlers } = await opened();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    act(() => handlers.get("click")!({ lngLat: { lng: ORIGIN[0], lat: ORIGIN[1] }, point: { x: 0, y: 0 } }));
    expect(await screen.findByDisplayValue("Harbour")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/one station with the station next to it/);
    // Far from everything and nothing on the map: a fictional name no other stop uses.
    fireEvent.click(screen.getByRole("button", { name: /Station/ }));
    act(() =>
      handlers.get("click")!({ lngLat: { lng: ORIGIN[0], lat: ORIGIN[1] + 0.03 }, point: { x: 0, y: 0 } }),
    );
    expect(await screen.findByDisplayValue("Northgate")).toBeTruthy();
    clearPlaces();
  });

  it("opens a drawing, lists its checks and inspects a track", async () => {
    const { map } = await opened({ mode: "tram" });
    expect(await screen.findByText(/Diamond crossing at/)).toBeTruthy();
    expect(screen.getByText(/0 errors/)).toBeTruthy();
    expect(map.fitBounds).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Diamond crossing at/));
    expect(await screen.findByRole("button", { name: /Delete track/ })).toBeTruthy();
  });

  it("loads the streets on screen and lists the level crossings with them", async () => {
    const fetchTile = vi.fn(async () => streetTile(50.88, 50.92));
    await opened({ mode: "regional_rail", fetchTile });
    expect(fetchTile).toHaveBeenCalled();
    expect(await screen.findByText(/Level crossings · [1-9]/)).toBeTruthy();
    expect(screen.getAllByText(/Station Road · \d+° · barriers · buses/).length).toBeGreaterThan(0);
  });

  it("leaves existing railways alone unless the app setting turns them on", async () => {
    const fetchRails = vi.fn(async () => railTile());
    await opened({ mode: "tram", fetchRails });
    expect(fetchRails).not.toHaveBeenCalled();
    expect(screen.queryByText(/Existing railways ·/)).toBeNull();
  });

  it("loads the existing railways on screen alongside the streets", async () => {
    const fetchRails = vi.fn(async () => railTile());
    await opened({ mode: "tram", fetchRails, existingRailways: true });
    expect(fetchRails).toHaveBeenCalled();
    expect(await screen.findByText(/\(1 loaded\)/)).toBeTruthy();
    expect(screen.getByText(/Existing railways · \d+ joins?/)).toBeTruthy();
  });

  it("offers slips for a diamond of two single tracks", async () => {
    const { engine } = await opened({ mode: "tram" });
    // The tram sample's diamond is between double tracks: no slip on offer.
    expect(await screen.findByText(/Diamond crossings · 1/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /Trackwork at crossing/ })).toBeNull();
    expect(engine()).not.toBeNull();
  });

  it("shows generated signals, places one of the planner's, turns it with F and resets", async () => {
    const { handlers, engine } = await opened({ mode: "regional_rail" });
    expect(screen.getByText(/Signals · [1-9]/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reset to generated/ })).toBeNull();
    fireEvent.keyDown(window, { key: "g" });
    expect(screen.getByRole("button", { name: /Signal/ }).getAttribute("aria-pressed")).toBe("true");
    // A point on the first track of the example.
    const v = engine().build(engine().sample("regional_rail", ORIGIN), null);
    const [lng, lat] = v.signals[0]!.lonlat;
    act(() => handlers.get("click")!({ lngLat: { lng, lat }, point: { x: 0, y: 0 } }));
    expect(await screen.findByRole("button", { name: /Turn round/ })).toBeTruthy();
    expect(screen.getByText(/ · yours/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reset to generated/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: "f" });
    fireEvent.click(screen.getByRole("button", { name: /Reset to generated/ }));
    expect(screen.getByRole("status").textContent).toMatch(/reset/);
    expect(screen.queryByRole("button", { name: /Reset to generated/ })).toBeNull();
  });

  it("keeps what is drawn in its own railway system when the mode for new elements changes", async () => {
    let built: Network | null = null;
    const { map } = fakeMap();
    render(
      <RailwayEditor
        map={map}
        fetchTile={() => Promise.reject(new Error("offline"))}
        fetchRails={() => Promise.reject(new Error("offline"))}
        initial={sample("metro")}
        loadEngine={async () => {
          const e = await loadRailEngine();
          const build = e.build;
          e.build = (doc, draft) => {
            built = doc;
            return build(doc, draft);
          };
          return e;
        }}
      />,
    );
    await screen.findByText(/0 errors/);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "tram" } });
    await waitFor(() => expect((built as Network | null)?.mode).toBe("tram"));
    const doc = built! as Network;
    expect(doc.mode).toBe("tram");
    expect(doc.stations.every((st) => st.mode === "metro")).toBe(true);
    expect(doc.tracks.every((t) => t.mode === "metro")).toBe(true);
    expect(screen.getByText(/0 errors/)).toBeTruthy();
  });

  it("switches tools from the keyboard and cancels a draft with Escape", async () => {
    const { handlers } = await opened();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.keyDown(window, { key: "t" });
    expect(screen.getByRole("button", { name: /Track/ }).getAttribute("aria-pressed")).toBe("true");
    act(() => handlers.get("click")!({ lngLat: { lng: ORIGIN[0], lat: ORIGIN[1] }, point: { x: 0, y: 0 } }));
    expect(await screen.findByText("Drawing track")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Drawing track")).toBeNull());
  });

  it("creates a service line by clicking its stations in order, publishes it for the journey planner", async () => {
    const onPublish = vi.fn();
    // The metro sample, and a station of its own that no track joins to the others.
    const [lone] = addStation(sample("metro"), [3000, 3000], {
      level: "street",
      sides: 2,
      islands: 0,
      platformLength: 120,
      name: "Faraway",
    });
    let engine: RailEngine | null = null;
    const { map, handlers } = fakeMap();
    render(
      <RailwayEditor
        map={map}
        fetchTile={() => Promise.reject(new Error("offline"))}
        initial={lone}
        onPublish={onPublish}
        loadEngine={async () => (engine = await loadRailEngine())}
      />,
    );
    await waitFor(() => expect(engine).not.toBeNull());
    await screen.findByText(/Service lines · 0/);
    const view = engine!.build(lone, null);
    const at = (name: string) => {
      const id = lone.stations.find((x) => x.name === name)!.id;
      return view.stations.find((x) => x.id === id)!.lonlat;
    };
    const click = ([lng, lat]: [number, number]) =>
      act(() => handlers.get("click")!({ lngLat: { lng, lat }, point: map.project([lng, lat]) }));

    // The tool is at the bottom of the palette; it starts an empty line and asks for the first station.
    fireEvent.click(screen.getByRole("button", { name: /Create service line/ }));
    expect(await screen.findByText("Service lines · 1")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Click the first station/);
    click(at("Riverside"));
    await waitFor(() => expect(screen.getByRole("list", { name: "Stops" }).children).toHaveLength(1));
    // A station no track leads to is refused, with the reason.
    click(at("Faraway"));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /No track leads from Riverside to Faraway/,
    );
    expect(screen.getByRole("list", { name: "Stops" }).children).toHaveLength(1);
    click(at("Northgate"));
    await waitFor(() => expect(screen.getByRole("list", { name: "Stops" }).children).toHaveLength(2));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("button", { name: /Select/ }).getAttribute("aria-pressed")).toBe("true");

    const stops = screen.getByRole("list", { name: "Stops" });
    expect(stops.textContent).toMatch(/Riverside.*Northgate/);
    expect((screen.getByLabelText("Line name") as HTMLInputElement).value).toBe("M1");
    // A catalogue metro train is chosen; its length follows from the units coupled.
    const train = screen.getByLabelText("Train") as HTMLSelectElement;
    expect(train.value).not.toBe("");
    const len = trainById(train.value)!.length_m;
    expect(screen.getByTestId("train-length").textContent).toContain(fmtM(len));
    fireEvent.change(screen.getByLabelText("Units coupled"), { target: { value: "2" } });
    expect(screen.getByTestId("train-length").textContent).toContain(fmtM(len * 2));
    fireEvent.change(screen.getByLabelText("Units coupled"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Peak headway"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Off-peak headway"), { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: "Publish timetable" }));
    const done = await screen.findByTestId("lines-published");
    expect(done.textContent).toMatch(/Published 1 line · \d+ trips/);
    expect(screen.getByTestId("line-report").textContent).toMatch(
      /\d+ trips · \d+ trains? · Riverside → Northgate/,
    );
    expect(onPublish).toHaveBeenCalledTimes(1);
    const tt = onPublish.mock.calls[0]![0] as { routes: { route_short_name: string }[]; trips: unknown[] };
    expect(tt.routes.map((r) => r.route_short_name)).toEqual(["M1"]);
    expect(tt.trips.length).toBeGreaterThan(50);

    // Editing the line marks the publication out of date.
    fireEvent.change(screen.getByLabelText("Line name"), { target: { value: "U5" } });
    expect(screen.getByTestId("lines-published").textContent).toMatch(/changed since publishing/);
  });

  it("drops a new line again when no station was picked", async () => {
    await opened({ mode: "metro" });
    fireEvent.click(screen.getByRole("button", { name: /Create service line/ }));
    expect(await screen.findByText("Service lines · 1")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByText("Service lines · 0")).toBeTruthy();
  });
});

describe("service lines", () => {
  const doc = (): Network => ({
    ...emptyNetwork("metro", ORIGIN),
    stations: [
      {
        id: 1,
        name: "West",
        x: -1000,
        y: 0,
        rotation_deg: 0,
        level: "street",
        side_platforms: 0,
        island_platforms: 1,
        platform_length_m: 120,
      },
      {
        id: 2,
        name: "Middle",
        x: 0,
        y: 50,
        rotation_deg: 0,
        level: "street",
        side_platforms: 0,
        island_platforms: 1,
        platform_length_m: 120,
      },
      {
        id: 3,
        name: "East",
        x: 1000,
        y: 0,
        rotation_deg: 0,
        level: "street",
        side_platforms: 0,
        island_platforms: 1,
        platform_length_m: 120,
      },
      {
        id: 4,
        name: "Far East",
        x: 2000,
        y: 0,
        rotation_deg: 0,
        level: "street",
        side_platforms: 0,
        island_platforms: 1,
        platform_length_m: 120,
      },
    ],
  });

  it("starts an empty line for the line tool, and sizes platforms to the longest train", () => {
    const [d, id] = addLine(doc(), 100, { empty: true });
    const line = d.lines!.find((l) => l.id === id)!;
    expect(line.stations).toEqual([]);
    expect(linesTrainLength(emptyNetwork("metro", ORIGIN))).toBeNull();
    const len = trainById(line.vehicle)!.length_m;
    expect(linesTrainLength(d)).toBeCloseTo(len, 1);
    const coupled = updateLine(d, id, (l) => ({ ...l, units: 3 }));
    expect(linesTrainLength(coupled)).toBeCloseTo(len * 3, 1);
  });

  it("starts a line at the two stations farthest apart, west to east, with a train that fits", () => {
    const [d, id] = addLine(doc(), 115);
    const l = d.lines!.find((x) => x.id === id)!;
    expect(l.stations).toEqual([1, 4]);
    expect(l.name).toBe("M1");
    const t = trainById(l.vehicle)!;
    expect(t.mode).toBe("metro");
    expect(t.length_m).toBeLessThanOrEqual(115);
    expect(suggestTrain("metro", 115)!.id).toBe(t.id);
    const [d2] = addLine(d, 115);
    expect(d2.lines!.map((x) => x.name)).toEqual(["M1", "M2"]);
    expect(removeLine(removeLine(d2, "line1"), "line2").lines).toBeNull();
  });

  it("puts a new stop where it fits along the line, and moves stops", () => {
    const [d] = addLine(doc(), 115);
    let l = { ...d.lines![0]!, stations: [1, 3] };
    l = insertStop(d, l, 2);
    expect(l.stations).toEqual([1, 2, 3]);
    l = insertStop(d, l, 4);
    expect(l.stations).toEqual([1, 2, 3, 4]);
    expect(insertStop(d, l, 4)).toBe(l);
    expect(moveStop(l, 0, 1).stations).toEqual([2, 1, 3, 4]);
    expect(moveStop(l, 0, -1)).toBe(l);
  });

  it("hands the engine stations by topology id, the train's values and times in seconds", () => {
    const [d] = addLine(doc(), 115);
    const [e] = engineLines(d);
    expect(e!.stations).toEqual(["st1", "st4"]);
    expect(e!.mode).toBe("metro");
    expect(e!.first_s).toBe(5 * 3600);
    expect(e!.last_s).toBe(24 * 3600);
    expect(e!.peak_headway_s).toBe(240);
    expect(e!.vehicle).not.toHaveProperty("mode");
    const broken = updateLine(d, "line1", (l) => ({ ...l, stations: [1] }));
    expect(lineProblem(broken, broken.lines![0]!)).toBe("Needs at least two stops.");
    expect(engineLines(broken)).toEqual([]);
    expect(hhmm(24 * 60 + 30)).toBe("24:30");
    expect(parseHhmm("5:15")).toBe(315);
    expect(parseHhmm("28:00")).toBeNull();
  });
});

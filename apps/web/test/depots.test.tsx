import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepotEditor } from "../src/features/depots/DepotEditor";
import {
  depotFit,
  depotGates,
  depotRules,
  moveLane,
  resizeLane,
  snapToRing,
  toXY,
} from "../src/features/depots/model";
import type { DepotEngine, DepotsDoc, Lane, Report, SavedDepot } from "../src/features/depots/types";
import type { SavedStreetLine } from "../src/features/street-lines/saved";

afterEach(cleanup);

vi.mock("../src/features/depots/mapLayers", () => ({
  DEPOT_LAYERS: { slots: "depots-slots" },
  depotsGeoJson: vi.fn(() => ({})),
  draftGeoJson: vi.fn(() => ({})),
  sweptGeoJson: vi.fn(() => ({})),
  ensureDepotLayers: vi.fn(),
  removeDepotLayers: vi.fn(),
  setDepotData: vi.fn(),
}));

const RING: [number, number][] = [
  [7.41, 43.73],
  [7.4115, 43.73],
  [7.4115, 43.731],
  [7.41, 43.731],
];

/** A lane of three 12 m slots heading east. */
function lane(): Lane {
  const o: [number, number] = [7.4105, 43.7305];
  const east = (m: number): [number, number] => [
    o[0] + m / (111_195 * Math.cos((o[1] * Math.PI) / 180)),
    o[1],
  ];
  return {
    id: "ln1",
    zone: "z1",
    kind: "parking",
    entry: east(0),
    exit: east(39),
    width_m: 3.5,
    aisle_in: "a1",
    aisle_out: "a2",
    slots: [32.5, 19.5, 6.5].map((m, k) => ({
      id: `ln1-s${k + 1}`,
      center: east(m),
      heading_deg: 90,
      length_m: 12,
      width_m: 3.5,
      charger: false,
    })),
  };
}

function depot(over: Partial<SavedDepot> = {}): SavedDepot {
  return {
    id: "dp1",
    name: "North",
    modes: ["bus", "trolleybus"],
    boundary: RING,
    gates: [
      { id: "g1", kind: "entrance", lonlat: [7.4105, 43.73] },
      { id: "g2", kind: "exit", lonlat: [7.4115, 43.7305] },
      { id: "g3", kind: "both", lonlat: [7.41, 43.7305] },
    ],
    zones: [],
    layout: { lanes: [lane()], aisles: [] },
    ...over,
  };
}

const line = (mode: "bus" | "brt", length_m: number) =>
  ({ profile: { mode, length_m }, vehicle: null }) as unknown as SavedStreetLine;

describe("Depot model", () => {
  it("gives exits for pull-out and entrances for pull-in", () => {
    expect(depotGates(depot())).toEqual({
      exits: [
        [7.4115, 43.7305],
        [7.41, 43.7305],
      ],
      entrances: [
        [7.4105, 43.73],
        [7.41, 43.7305],
      ],
    });
  });

  it("lets a line use a depot that takes its mode and has a slot its vehicle fits", () => {
    expect(depotFit(depot(), line("bus", 12))).toBeNull();
    expect(depotFit(depot(), line("brt", 12))).toBe("depot.fit.mode");
    expect(depotFit(depot(), line("bus", 18))).toBe("depot.fit.size");
    // Before the first layout any line of its modes may use it.
    expect(depotFit(depot({ layout: null }), line("bus", 18))).toBeNull();
  });

  it("takes the project's depot values over the library's", () => {
    const r = depotRules({ "depot.vehicles_per_lane": 2 });
    expect(r.vehicles_per_lane).toBe(2);
    expect(r.turning_circle_m).toBeGreaterThan(20);
    expect(r.swept_clearance_m).toBeGreaterThan(0);
  });

  it("resizes a lane at its entry end and moves it whole", () => {
    const l = lane();
    const shorter = resizeLane(l, 2);
    expect(shorter.slots).toHaveLength(2);
    expect(shorter.exit).toEqual(l.exit);
    expect(toXY(shorter.exit, shorter.entry)[0]).toBeCloseTo(-26, 0);
    const longer = resizeLane(l, 4);
    expect(longer.slots.map((s) => s.id)).toEqual(["ln1-s1", "ln1-s2", "ln1-s3", "ln1-s4"]);
    expect(toXY(longer.exit, longer.entry)[0]).toBeCloseTo(-52, 0);
    const to: [number, number] = [7.4106, 43.7306];
    const moved = moveLane(l, to, "ln2");
    expect(moved.entry).toEqual(to);
    expect(moved.slots[0]!.id).toBe("ln2-s1");
    expect(moved.aisle_in).toBeNull();
    const [dx, dy] = toXY(moved.entry, moved.exit);
    expect(dx).toBeCloseTo(39, 0);
    expect(dy).toBeCloseTo(0, 1);
  });

  it("snaps a gate onto the outline", () => {
    const p = snapToRing(RING, [7.4108, 43.7299]);
    expect(p[1]).toBeCloseTo(43.73, 6);
    expect(p[0]).toBeCloseTo(7.4108, 6);
  });
});

function fakeEngine(): DepotEngine {
  const report: Report = {
    lanes: [{ lane: "ln1", vehicle: "mode:bus:12", entry_ok: true, exit_ok: true, message: null }],
    network: { nodes: [], edges: [] },
    reach: [{ lane: "ln1", from_entrance: true, to_exit: true, in_m: 40, out_m: 30 }],
    capacity: {
      slots: { parking: 3, charging: 0, maintenance: 0, reserve: 0 },
      chargers: 0,
      charger_power_kw: 150,
      rows: [],
      fleet: 0,
      assignments: [],
      issues: [],
    },
    issues: [{ severity: "warning", subject: null, message: "No line uses the depot yet." }],
  };
  return {
    generate: vi.fn(() => ({ layout: { lanes: [lane()], aisles: [] }, issues: [] })),
    analyse: vi.fn(() => report),
    size: vi.fn(() => ({
      vehicle: "mode:bus:12",
      area_m2: 2400,
      fleet: 20,
      footprints: [
        { angle_deg: 90, area_m2: 2400, width_m: 60, depth_m: 40, bands: 2, lanes_per_band: 10, aisle_m: 12 },
      ],
      holds: [{ angle_deg: 90, vehicles: 30 }],
    })),
    envelope: vi.fn(() => []),
  };
}

function fakeMap() {
  const handlers = new Map<string, (ev: unknown) => void>();
  const map = {
    on: (t: string, f: (ev: unknown) => void) => handlers.set(t, f),
    off: (t: string) => handlers.delete(t),
    getLayer: () => undefined,
    queryRenderedFeatures: () => [],
    project: () => ({ x: 9999, y: 9999 }),
    fitBounds: vi.fn(),
    getCanvas: () => ({ style: {} as CSSStyleDeclaration }),
  };
  return { map: map as unknown as MapLibreMap, handlers };
}

function Harness({ engine, map, docs }: { engine: DepotEngine; map: MapLibreMap; docs: DepotsDoc[] }) {
  const [doc, setDoc] = useState<DepotsDoc | null>(null);
  return (
    <DepotEditor
      map={map}
      doc={doc}
      onDoc={(d) => {
        docs.push(d);
        setDoc(d);
      }}
      loadEngine={async () => engine}
    />
  );
}

describe("Depot tool", () => {
  it("draws a depot, puts gates on its outline, fills a zone and checks it", async () => {
    const engine = fakeEngine();
    const { map, handlers } = fakeMap();
    const docs: DepotsDoc[] = [];
    render(<Harness engine={engine} map={map} docs={docs} />);
    fireEvent.click(screen.getByRole("button", { name: "New depot" }));
    const click = (lng: number, lat: number) =>
      act(() => handlers.get("click")!({ lngLat: { lng, lat }, point: { x: 0, y: 0 } }));
    for (const [lng, lat] of RING) click(lng, lat);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(docs.at(-1)!.depots[0]!.boundary).toEqual(RING);

    fireEvent.click(screen.getByRole("button", { name: "Add: Entrance and exit" }));
    click(7.4108, 43.7299);
    const gate = docs.at(-1)!.depots[0]!.gates[0]!;
    expect(gate.kind).toBe("both");
    expect(gate.lonlat[1]).toBeCloseTo(43.73, 6);

    fireEvent.click(screen.getByRole("button", { name: "Zone over the whole outline" }));
    expect(docs.at(-1)!.depots[0]!.zones[0]).toMatchObject({ kind: "parking", ring: RING, angle_deg: 90 });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Auto layout" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Auto layout" }));
    await waitFor(() => expect(docs.at(-1)!.depots[0]!.layout?.lanes).toHaveLength(1));
    expect(engine.generate).toHaveBeenCalledWith(expect.objectContaining({ boundary: RING, layout: null }));
    await waitFor(() => expect(screen.getByText(/Parking 3, charging 0/)).toBeTruthy());
    expect(screen.getByText("No line uses the depot yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Size the depot" }));
    await waitFor(() => expect(screen.getByText("60 × 40 m")).toBeTruthy());
  });
});

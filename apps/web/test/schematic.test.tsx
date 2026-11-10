import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileName } from "../src/features/schematic/export";
import { defaultOrigin, edgesOf, layout, snapToNeighbours } from "../src/features/schematic/layout";
import { layerOf, linesAt, schematicNetwork } from "../src/features/schematic/lines";
import { bundles, octiRoute, offsetPolyline, pathD, placeLabels } from "../src/features/schematic/paths";
import { Schematic, type SchematicDoc } from "../src/features/schematic/Schematic";
import { RAILWAY, STREET_LINES } from "./fixtures/schematic";

afterEach(cleanup);

/** Whether a vector runs at a multiple of 45°, within `tol` (radians). */
const octi = (dx: number, dy: number, tol = 1e-3) => {
  const a = Math.atan2(dy, dx) / (Math.PI / 4);
  return Math.abs(a - Math.round(a)) < tol;
};

describe("schematic network", () => {
  const net = schematicNetwork(RAILWAY, STREET_LINES);

  it("takes the railway's service lines and the street lines, and merges stops into stations", () => {
    expect(net.lines.map((l) => [l.name, l.layer])).toEqual([
      ["M1", "metro"],
      ["M2", "metro"],
      ["R5", "regional"],
      ["Bus 22", "bus"],
    ]);
    // The regional Westpark platform is the metro's Westpark; the bus stops at Museumplein, De Pijp and
    // Oosterdok are the metro stations; Vondelpark is a new station.
    expect(net.stations).toHaveLength(11);
    const westpark = net.stations.findIndex((s) => s.name === "Westpark");
    expect(linesAt(net, westpark).map((l) => l.name)).toEqual(["M1", "R5"]);
    const pijp = net.stations.findIndex((s) => s.name === "De Pijp");
    expect(linesAt(net, pijp).map((l) => l.name)).toEqual(["M2", "Bus 22"]);
  });

  it("puts each mode in its layer", () => {
    expect(["bus", "trolleybus", "intercity_bus"].map(layerOf)).toEqual(["bus", "bus", "bus"]);
    expect(layerOf("light_rail")).toBe("tram");
    expect(layerOf("commuter_rail")).toBe("regional");
    expect(layerOf("high_speed_rail")).toBe("long_distance");
    expect(layerOf("cable_car")).toBe("other");
  });

  it("includes the plugin lines in their calling order", () => {
    const n = schematicNetwork(null, null, [
      {
        id: "cable-car",
        name: "Cable car",
        mode: "cable_car",
        color: "#7c3aed",
        stops: [
          { name: "Valley", lonlat: [4.9, 52.37] },
          { name: "Summit", lonlat: [4.92, 52.38] },
        ],
        directions: [
          [
            { stop: 1, run_s: 0, dwell_s: 0 },
            { stop: 0, run_s: 300, dwell_s: 30 },
          ],
        ],
        headwayS: 60,
      },
    ]);
    expect(n.lines[0]!.stops.map((s) => n.stations[s]!.name)).toEqual(["Summit", "Valley"]);
    expect(n.lines[0]!.layer).toBe("other");
  });

  it("lays out every section at 45° steps and keeps the planner's stations where they put them", () => {
    const origin = defaultOrigin(net);
    const { pos, unit } = layout(net, origin);
    for (const [a, b] of edgesOf(net)) {
      const [dx, dy] = [pos[b]![0] - pos[a]![0], pos[b]![1] - pos[a]![1]];
      // The layout straightens what it can; the drawing routes the rest at 45° steps.
      for (let k = 1; k < 4; k++) {
        const r = octiRoute(pos[a]!, pos[b]!);
        if (!r[k]) break;
        expect(octi(r[k]![0] - r[k - 1]![0], r[k]![1] - r[k - 1]![1])).toBe(true);
      }
      expect(Math.hypot(dx, dy)).toBeGreaterThan(unit * 0.3);
    }
    // Most sections come out straight.
    const straight = edgesOf(net).filter(([a, b]) =>
      octi(pos[b]![0] - pos[a]![0], pos[b]![1] - pos[a]![1], 0.01),
    );
    expect(straight.length / edgesOf(net).length).toBeGreaterThan(0.8);

    const key = net.stations[0]!.key;
    const pinned = layout(net, origin, { [key]: [1234, 567] });
    expect(pinned.pos[0]).toEqual([1234, 567]);
    // Same input, same output.
    expect(layout(net, origin)).toEqual({ pos, unit });
  });

  it("snaps a dragged station onto a 45° ray from a neighbour", () => {
    expect(snapToNeighbours([100, 7], [[0, 0]], 20)).toEqual([100, 0]);
    const d = snapToNeighbours([50, 46], [[0, 0]], 20);
    expect(d[0]).toBeCloseTo(48);
    expect(d[1]).toBeCloseTo(48);
    expect(snapToNeighbours([50, 20], [[0, 0]], 5)).toEqual([50, 20]);
  });

  it("draws lines on a shared section side by side, at 45° steps, through their stations", () => {
    const lines = net.lines.filter((l) => l.name === "M1" || l.name === "Bus 22");
    const pos = net.stations.map((_, i) => [i * 100, (i % 3) * 70] as [number, number]);
    const b = bundles(lines);
    const m1 = offsetPolyline(lines[0]!, pos, b, 8);
    expect(m1.station.filter(Boolean)).toHaveLength(lines[0]!.stops.length);
    for (let k = 1; k < m1.pts.length; k++)
      expect(octi(m1.pts[k]![0] - m1.pts[k - 1]![0], m1.pts[k]![1] - m1.pts[k - 1]![1], 0.05)).toBe(true);
    expect(
      pathD(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        4,
      ),
    ).toBe("M0 0L6 0Q10 0 10 4L10 10");
    expect(
      pathD(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        0,
      ),
    ).toBe("M0 0L10 0L10 10");
  });

  it("places a name where it does not cover another name or a line", () => {
    const at = placeLabels(
      [
        { i: 0, at: [0, 0], name: "Alpha", r: 5, neighbours: [] },
        { i: 1, at: [30, 0], name: "Beta", r: 5, neighbours: [] },
      ],
      [
        [
          [-100, 0],
          [100, 0],
        ],
      ],
      new Map(),
      13,
    );
    // East of Alpha is Beta's dot and the line: Alpha takes another place.
    expect(at.get(0)).not.toBe(0);
    expect(
      placeLabels([{ i: 0, at: [0, 0], name: "A", r: 5, neighbours: [] }], [], new Map([[0, 3]]), 13).get(0),
    ).toBe(3);
  });

  it("names export files after the project", () => {
    expect(fileName("Lakeside 2030 / Netz", "svg")).toBe("lakeside-2030-netz.svg");
    expect(fileName("", "png")).toBe("schematic.png");
  });
});

describe("Schematic tab", () => {
  it("draws the network with a legend, hides layers, and saves a name place", () => {
    const onDoc = vi.fn();
    render(
      <Schematic
        railway={RAILWAY}
        streetLines={STREET_LINES}
        doc={null}
        onDoc={onDoc}
        projectName="Amstelstad"
      />,
    );
    const map = screen.getByRole("img", { name: "Schematic network map" });
    expect(within(map).getByText("M1 · Metro")).toBeTruthy();
    expect(within(map).getByText("Bus 22 · Bus")).toBeTruthy();
    expect(map.querySelectorAll("path")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Bus" }));
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: ["bus"] }));

    fireEvent.click(within(map).getByText("Centraal", { selector: "text" }));
    const station = screen.getByRole("region", { name: "Station" });
    expect(within(station).getByText("Lines here: M1, M2")).toBeTruthy();
    fireEvent.change(within(station).getByRole("combobox"), { target: { value: "6" } });
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ labels: { centraal: 6 } }));
  });

  it("leaves hidden layers out of the drawing", () => {
    const doc: SchematicDoc = { pins: {}, labels: {}, hidden: ["bus", "regional"] };
    render(<Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={doc} projectName="Amstelstad" />);
    const map = screen.getByRole("img", { name: "Schematic network map" });
    expect(map.querySelectorAll("path")).toHaveLength(2);
    expect(within(map).queryByText("Vondelpark")).toBeNull();
    // View only: no editing.
    expect(screen.getByText(/Only editors can move stations/)).toBeTruthy();
  });

  it("shows a line's strip map with the lines to change to", () => {
    render(<Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={null} projectName="Amstelstad" />);
    fireEvent.click(screen.getByRole("tab", { name: "Strip map" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rail:M2" } });
    const strip = screen.getByRole("img", { name: "Strip map of line M2" });
    const names = [...strip.querySelectorAll("text")].map((t) => t.textContent);
    expect(names).toEqual(
      expect.arrayContaining(["Noorderhaven", "Centraal", "Zuidas", "M1", "R5", "Bus 22"]),
    );
  });

  it("says how to get lines when there are none", () => {
    const onCreate = vi.fn();
    render(
      <Schematic railway={null} streetLines={null} doc={null} projectName="Empty" onCreate={onCreate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to Create" }));
    expect(onCreate).toHaveBeenCalled();
  });
});

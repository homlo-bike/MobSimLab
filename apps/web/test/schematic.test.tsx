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
    expect(map.querySelectorAll(`path[stroke-width="6"]`)).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Bus" }));
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: ["bus"] }));

    fireEvent.click(within(map).getByText("Centraal", { selector: "text" }));
    const station = screen.getByRole("dialog", { name: "Centraal" });
    fireEvent.change(within(station).getByRole("combobox", { name: "Name position" }), {
      target: { value: "6" },
    });
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ labels: { centraal: 6 } }));
  });

  it("opens a station pop-up with its stops, platforms, lines, features and status", () => {
    const onDoc = vi.fn();
    render(
      <Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={null} onDoc={onDoc} projectName="A" />,
    );
    const map = screen.getByRole("img", { name: "Schematic network map" });
    fireEvent.click(within(map).getByText("Centraal", { selector: "text" }));
    const pop = screen.getByRole("dialog", { name: "Centraal" });
    // One railway station with one island platform; M1 and M2 call there.
    expect(within(pop).getByText("Stops").nextSibling?.textContent).toBe("1");
    expect(within(pop).getByText("Platforms").nextSibling?.textContent).toBe("1");
    expect(within(pop).getByText("2 lines call here")).toBeTruthy();
    expect(within(pop).getByText("Lift")).toBeTruthy();
    expect(within(pop).getByText("Escalator")).toBeTruthy();
    // The features from Create are drawn as symbols on the map too.
    expect(map.querySelector("title")).toBeTruthy();
    expect([...map.querySelectorAll("title")].map((x) => x.textContent)).toEqual(
      expect.arrayContaining(["Lift", "Escalator"]),
    );

    fireEvent.click(within(pop).getByRole("button", { name: "Central station" }));
    expect(onDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ statuses: { centraal: ["central_station"] } }),
    );
    fireEvent.change(within(pop).getByRole("combobox", { name: "Name rotation" }), {
      target: { value: "-45" },
    });
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ rotate: { centraal: -45 } }));

    // Esc closes it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    // A line in the pop-up opens its strip map.
    fireEvent.click(within(map).getByText("Centraal", { selector: "text" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "M2" }));
    expect(screen.getByRole("img", { name: "Strip map of line M2" })).toBeTruthy();
  });

  it("draws statuses, rotated names and areas from the saved edits, and hides them on request", () => {
    const doc: SchematicDoc = {
      pins: {},
      labels: {},
      origin: [4.9, 52.37],
      statuses: { centraal: ["airport"] },
      rotate: { "amstel oost": 90 },
      areas: [
        {
          id: "a1",
          name: "Old town",
          kind: "landmark",
          color: "#dc2626",
          points: [
            [-500, -500],
            [500, -500],
            [0, 500],
          ],
        },
      ],
    };
    const { rerender } = render(
      <Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={doc} projectName="A" />,
    );
    const map = () => screen.getByRole("img", { name: "Schematic network map" });
    const titles = () => [...map().querySelectorAll("title")].map((x) => x.textContent);
    expect(titles()).toContain("Airport");
    expect(within(map()).getAllByText("Old town")).toHaveLength(1);
    expect(within(map()).getByText("Old town · Landmark")).toBeTruthy();
    const amstel = within(map()).getByText("Amstel Oost", { selector: "text" });
    expect(amstel.getAttribute("transform")).toMatch(/^rotate\(-90 /);

    rerender(
      <Schematic
        railway={RAILWAY}
        streetLines={STREET_LINES}
        doc={{ ...doc, symbols: false, features: false, showAreas: false }}
        projectName="A"
      />,
    );
    expect(titles()).not.toContain("Airport");
    expect(titles()).not.toContain("Lift");
    expect(within(map()).queryByText("Old town")).toBeNull();
  });

  it("edits, draws and removes tariff zones and landmarks in the panel", () => {
    const onDoc = vi.fn();
    const doc: SchematicDoc = {
      pins: {},
      labels: {},
      areas: [
        {
          id: "a1",
          name: "Zone A",
          kind: "zone",
          color: "#dc2626",
          points: [
            [0, 0],
            [100, 0],
            [0, 100],
          ],
        },
      ],
    };
    render(
      <Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={doc} onDoc={onDoc} projectName="A" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zone A" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Zone B" } });
    expect(onDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ areas: [expect.objectContaining({ id: "a1", name: "Zone B" })] }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "landmark" } });
    expect(onDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({ areas: [expect.objectContaining({ kind: "landmark" })] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove area" }));
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ areas: [] }));

    fireEvent.click(screen.getByRole("button", { name: "Draw an area" }));
    expect(screen.getByText(/Click the map to add corners/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
  });

  it("opens a line's strip map when the line is clicked on the network map", () => {
    render(<Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={null} projectName="A" />);
    const map = screen.getByRole("img", { name: "Schematic network map" });
    fireEvent.click(map.querySelector('[data-line="street:0"]')!);
    expect(screen.getByRole("img", { name: "Strip map of line Bus 22" })).toBeTruthy();
  });

  it("shows service, driving times, levels and ground heights under the strip map", async () => {
    const fetchHeights = vi.fn(async (pts: [number, number][]) => pts.map((_, i) => 2 + i));
    render(
      <Schematic
        railway={RAILWAY}
        streetLines={STREET_LINES}
        doc={null}
        projectName="A"
        fetchHeights={fetchHeights}
        waterLoader={async () => ({ areas: [], rivers: [], sea: [] })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Strip map" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "street:0" } });
    const strip = screen.getByRole("img", { name: "Strip map of line Bus 22" });
    const texts = () => [...strip.querySelectorAll("text")].map((t) => t.textContent);
    // Bus 22: one bus at a 10 minute headway (5 in the peak), driving 2, 2.5 and 1.5 minutes between stops.
    expect(texts()).toEqual(
      expect.arrayContaining([
        "Vehicles in service",
        "1",
        "Headway, peak hours",
        "5 min",
        "10 min",
        "2 min",
        "2.5 min",
        "1.5 min",
        "Street level",
      ]),
    );
    expect(
      await within(strip).findByText(
        "Side view of the ground along the line, length and height to the same scale, sampled every 50 m",
      ),
    ).toBeTruthy();
    // The ground is sampled every 50 m along the routed street, and each section gets its gradient.
    const sampled = fetchHeights.mock.calls.at(-1)![0];
    expect(sampled.length).toBeGreaterThan(20);
    expect(texts()).toEqual(
      expect.arrayContaining(["Gradient between stations: average, and the steepest 50 m"]),
    );
    expect(texts().filter((x) => /^[+−-]?[\d.]+%$/.test(x ?? "")).length).toBe(3);
    // A side view without scales: no metres or km written on it.
    expect(texts().filter((x) => /^-?[\d.]+ (m|km)$/.test(x ?? ""))).toEqual(["4.5 km"]);
    // Distances along the street (none given in the legs here, so in a straight line), average speed and the
    // walk to change at an interchange.
    expect(texts()).toEqual(expect.arrayContaining(["Average speed", "Step-free stations", "0 of 4"]));
    expect(texts()).toEqual(expect.arrayContaining(["M1", "M2"]));
    expect(texts().join(" ")).toContain(
      "No station on this line is recorded as step-free yet (step-free access, lift or ramp in Create).",
    );

    // The metro runs underground between its stations.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rail:M1" } });
    const m1 = screen.getByRole("img", { name: "Strip map of line M1" });
    expect(within(m1).getByText("Underground", { selector: "text" })).toBeTruthy();
    expect(within(m1).getByText("05:00–00:00")).toBeTruthy();
    // Without a timetable yet, every section still has a rough driving time, marked "~", and no distances.
    const m1Texts = [...m1.querySelectorAll("text")].map((t) => t.textContent ?? "");
    expect(m1Texts.filter((x) => /^~\d+(\.5)? min$/.test(x)).length).toBe(4);
    expect(m1Texts.filter((x) => /\d km$/.test(x))).toHaveLength(1); // the length, no section distances
    expect(m1Texts.join(" ")).toContain("~ before the minutes");
  });

  it("draws sea, lakes and rivers under the lines, and leaves them out when switched off", async () => {
    const waterLoader = vi.fn(async () => ({
      areas: [
        [
          [4.88, 52.36],
          [4.89, 52.36],
          [4.89, 52.37],
          [4.88, 52.36],
        ] as [number, number][],
      ],
      rivers: [
        {
          line: [
            [4.85, 52.35],
            [4.95, 52.38],
          ] as [number, number][],
          kind: "river" as const,
        },
      ],
      sea: [],
    }));
    const onDoc = vi.fn();
    render(
      <Schematic
        railway={RAILWAY}
        streetLines={STREET_LINES}
        doc={null}
        onDoc={onDoc}
        projectName="A"
        waterLoader={waterLoader}
        fetchHeights={async (p) => p.map(() => null)}
      />,
    );
    const map = screen.getByRole("img", { name: "Schematic network map" });
    const water = await within(map).findByLabelText("Water");
    expect(water.querySelectorAll("path")).toHaveLength(2);
    const [box] = waterLoader.mock.calls[0]! as unknown as [[number, number, number, number]];
    expect(box[0]).toBeLessThan(4.86);
    expect(box[3]).toBeGreaterThan(52.39);
    fireEvent.click(screen.getByRole("checkbox", { name: "Sea, lakes and rivers" }));
    expect(onDoc).toHaveBeenLastCalledWith(expect.objectContaining({ water: false }));
  });

  it("leaves hidden layers out of the drawing", () => {
    const doc: SchematicDoc = { pins: {}, labels: {}, hidden: ["bus", "regional"] };
    render(<Schematic railway={RAILWAY} streetLines={STREET_LINES} doc={doc} projectName="Amstelstad" />);
    const map = screen.getByRole("img", { name: "Schematic network map" });
    expect(map.querySelectorAll(`path[stroke-width="6"]`)).toHaveLength(2);
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
    expect(names).toEqual(expect.arrayContaining(["Noorderhaven", "Centraal", "Zuidas"]));
    // The lines to change to, one group per mode with its sign and the shortest walk to that mode.
    expect(names).toEqual(expect.arrayContaining(["M1", "R5", "Bus 22", "1 min"]));
    const signs = [...strip.querySelectorAll("g > title")].map((t) => t.textContent);
    expect(signs).toEqual(expect.arrayContaining(["Metro", "Regional rail", "Bus"]));
  });

  it("groups many lines to change to by mode, wrapping long groups", async () => {
    const { connectionRows } = await import("../src/features/schematic/StripMap");
    const mk = (id: string, mode: string) =>
      ({ ...schematicNetwork(RAILWAY, STREET_LINES).lines[0]!, id, name: id, mode }) as const;
    const hub = [
      ...["RE1", "RE2", "RE5", "RE7"].map((x) => mk(x, "regional_rail")),
      mk("U2", "metro"),
      mk("U4", "metro"),
      ...Array.from({ length: 10 }, (_, i) => mk(String(10 + i), "bus")),
    ];
    const rows = connectionRows(
      hub,
      () => 2,
      (n) => `${n} min`,
      142,
    );
    // Regional, metro, then the ten buses over several rows: far fewer rows than lines.
    expect(rows[0]![0]).toMatchObject({ kind: "mode", layer: "regional" });
    expect(rows.find((r) => r[0]?.kind === "mode" && r[0].layer === "metro")).toBeTruthy();
    expect(rows.length).toBeLessThan(8);
    for (const r of rows) for (const it of r) expect(it.x + it.w).toBeLessThanOrEqual(142);
    expect(rows.flat().filter((it) => it.kind === "walk")).toHaveLength(3);
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

describe("schematic details", () => {
  it("adds the rail engine's trains, round trip, running times and track levels", async () => {
    const { withRailDetails, sectionLevels } = await import("../src/features/schematic/details");
    const { offset } = await import("../src/features/journey-planner/network");
    const net = schematicNetwork(RAILWAY, STREET_LINES);
    const at = (x: number, y: number) => offset(RAILWAY.origin, x, y);
    // M1's first section, Westpark to Museumplein: half underground, then up a ramp to street level.
    const track = {
      length_m: 1600,
      centre: [at(-3000, 0), at(-1500, 200)],
      levels: [
        { from_m: 0, to_m: 800, level: "underground" as const },
        { from_m: 800, to_m: 1000, level: "ramp" as const },
        { from_m: 1000, to_m: 1600, level: "street" as const },
      ],
    };
    const lv = sectionLevels(at(-3000, 0), at(-1500, 200), [track as never])!;
    expect(lv.map((x) => x.level)).toEqual(["underground", "ramp", "street"]);
    expect(lv.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9);
    expect(sectionLevels(at(5000, 5000), at(6000, 5000), [track as never])).toBeNull();

    const timetable = {
      stops: [
        { stop_id: "p1", stop_name: "Westpark", stop_lat: 0, stop_lon: 0 },
        { stop_id: "p2", stop_name: "Museumplein", stop_lat: 0, stop_lon: 0 },
      ],
      routes: [],
      transfers: [],
      frequency_patterns: [],
      trips: [
        {
          trip_id: "t1",
          route_id: "M1",
          stop_times: [
            { stop_id: "p1", stop_sequence: 1, arrival_time: 18000, departure_time: 18020 },
            { stop_id: "p2", stop_sequence: 2, arrival_time: 18110, departure_time: 18130 },
          ],
        },
      ],
    };
    const build = {
      view: { tracks: [track] },
      reports: { M1: { id: "M1", trips: 10, outbound_s: 900, return_s: 960, trains: 7, issues: [] } },
      timetable,
      terrain: "none" as const,
    };
    const out = withRailDetails(net, RAILWAY, build as never);
    const m1 = out.lines.find((l) => l.id === "rail:M1")!;
    expect(m1.service.vehicles).toBe(7);
    expect(m1.service.roundTripMin).toBe(31);
    expect(m1.runS[0]).toBe(90);
    expect(m1.runS[1]).toBeNull();
    expect(m1.levels[0]!.map((x) => x.level)).toEqual(["underground", "ramp", "street"]);
    // Without a build nothing changes.
    expect(withRailDetails(net, RAILWAY, null)).toBe(net);
  });

  it("gives street and plugin lines their driving times between stops", () => {
    const bus = schematicNetwork(null, STREET_LINES).lines[0]!;
    expect(bus.runS).toEqual([120, 150, 90]);
    expect(bus.service.vehicles).toBe(1);
    const cable = schematicNetwork(null, null, [
      {
        id: "c",
        name: "C",
        mode: "cable_car",
        color: "#000000",
        stops: [
          { name: "A", lonlat: [4.9, 52.37] },
          { name: "B", lonlat: [4.91, 52.37] },
          { name: "C", lonlat: [4.92, 52.37] },
        ],
        directions: [
          [
            { stop: 0, run_s: 0, dwell_s: 0 },
            { stop: 1, run_s: 200, dwell_s: 30 },
            { stop: 2, run_s: 100, dwell_s: 0 },
          ],
        ],
        headwayS: 60,
      },
    ]).lines[0]!;
    expect(cable.runS).toEqual([200, 100]);
    expect(cable.levels[0]).toEqual([{ level: "aerial", share: 1 }]);
  });

  it("fetches water for the network's box and bends it along with the stations", async () => {
    const { waterBox, warp } = await import("../src/features/schematic/water");
    expect(waterBox([])).toBeNull();
    const b = waterBox([
      [4.8, 52.3],
      [5.0, 52.4],
    ])!;
    expect(b[0]).toBeCloseTo(4.76, 6);
    expect(b[3]).toBeCloseTo(52.42, 6);
    // Never more than 1° a side.
    const wide = waterBox([
      [4, 52],
      [7, 52.1],
    ])!;
    expect(wide[2] - wide[0]).toBeLessThanOrEqual(1);
    // A station moved 100 m east takes the water at its place with it; far away water moves less.
    const f = warp(
      [4.9, 52.37],
      [
        [4.9, 52.37],
        [4.95, 52.37],
      ],
      [
        [100, 0],
        [3400, 0],
      ],
    );
    expect(f([4.9, 52.37])[0]).toBeCloseTo(100, 6);
  });
});

describe("station features", () => {
  it("keeps known features in a fixed order and switches them with the picker", async () => {
    const { cleanFeatures, SymbolPicker, STATION_FEATURES } =
      await import("../src/features/stations/features");
    expect(cleanFeatures(["escalator", "lift?", "ramp", "ramp"])).toEqual(["ramp", "escalator"]);
    expect(cleanFeatures("ramp")).toEqual([]);
    const onChange = vi.fn();
    render(
      <SymbolPicker
        options={STATION_FEATURES}
        value={["escalator"]}
        label="Features"
        onChange={onChange}
        t={(k) => k}
      />,
    );
    const group = screen.getByRole("group", { name: "Features" });
    fireEvent.click(within(group).getByRole("button", { name: "station.symbol.elevator" }));
    expect(onChange).toHaveBeenLastCalledWith(["elevator", "escalator"]);
    fireEvent.click(within(group).getByRole("button", { name: "station.symbol.escalator" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("strip map extras", () => {
  it("samples the ground every 50 m and works out gradients and one scale for length and height", async () => {
    const { profilePoints } = await import("../src/features/schematic/details");
    const { profileChart } = await import("../src/features/schematic/StripMap");
    // Two sections due north, 1000 m and 230 m long.
    const north = (m: number): [number, number] => [5, 52 + m / 111_320];
    const p = profilePoints([
      [north(0), north(1000)],
      [north(1000), north(1230)],
    ]);
    expect(p.stationD.map(Math.round)).toEqual([0, 1000, 1230]);
    expect(p.d.length).toBe(1 + 20 + 5);
    expect(p.d.slice(0, 3).map(Math.round)).toEqual([0, 50, 100]);
    // Climbing 1 m every 50 m on the first section, flat on the second.
    const h = p.d.map((m) => Math.min(m, 1000) / 50);
    const chart = profileChart({ ...p, h }, 440)!;
    expect(chart.gradients[0]!.average).toBeCloseTo(2, 5);
    expect(chart.gradients[0]!.steepest).toBeCloseTo(2, 5);
    expect(chart.gradients[1]!.average).toBeCloseTo(0, 5);
    // Length and height to the same scale: 20 m of climb over 1230 m in 440 px.
    expect(chart.reliefPx).toBeCloseTo((20 * 440) / 1230, 5);
    expect(chart.stationH).toEqual([0, 20, 20]);
  });

  it("estimates driving times from the mode", async () => {
    const { estimateRunS } = await import("../src/features/schematic/lines");
    // A metro (80 km/h, 1.1 m/s²) over 1500 m in a straight line: 1725 m of track, top speed reached.
    expect(estimateRunS("metro", 1500)).toBeCloseTo(1725 / (80 / 3.6) + 80 / 3.6 / 1.1, 5);
    // A short tram hop never reaches top speed.
    expect(estimateRunS("tram", 200)).toBeCloseTo(2 * Math.sqrt(230 / 1.2), 5);
  });
  it("measures sections, walks to change and step-free stations", async () => {
    const { isStepFree, transferS } = await import("../src/features/schematic/lines");
    const net = schematicNetwork(RAILWAY, STREET_LINES);
    const m1 = net.lines.find((l) => l.id === "rail:M1")!;
    // Westpark to Museumplein: 1500 m east and 200 m north.
    expect(m1.distM[0]).toBeCloseTo(Math.hypot(1500, 200), -1);
    const pijp = net.stations.find((s) => s.name === "De Pijp")!;
    const [rail, bus] = [
      pijp.parts.find((p) => p.source === "rail")!,
      pijp.parts.find((p) => p.source === "street")!,
    ];
    // About 14 m apart, one level up from the underground platform: the minimum change plus a minute.
    expect(transferS(rail, bus)).toBe(120);
    expect(isStepFree(pijp)).toBe(false);
    expect(
      isStepFree({ ...pijp, parts: pijp.parts.map((p) => ({ ...p, features: ["elevator" as const] })) }),
    ).toBe(true);
  });
});

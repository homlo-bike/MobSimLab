import { describe, expect, it } from "vitest";
import { serviceLinePaths, serviceLineStops } from "../src/features/railways/linePaths";
import type { Network, RailView, SectionTrains } from "../src/features/railways/types";

const doc = {
  lines: [{ id: "L1", name: "T5", color: "#c2410c", stations: [2, 1] }],
} as unknown as Network;

const view = {
  stations: [
    { id: 1, lonlat: [7, 50] },
    { id: 2, lonlat: [7.01, 50] },
  ],
  tracks: [
    {
      id: 9,
      length_m: 1000,
      centre: [
        [7, 50],
        [7.01, 50],
      ],
    },
  ],
} as unknown as RailView;

describe("service lines on the map", () => {
  it("numbers each line's stops in calling order at its stations", () => {
    const stops = serviceLineStops(doc, view).features;
    expect(stops.map((f) => [f.properties.n, (f.geometry as { coordinates: number[] }).coordinates])).toEqual(
      [
        [1, [7.01, 50]],
        [2, [7, 50]],
      ],
    );
    expect(stops[0]!.properties.color).toBe("#c2410c");
  });

  it("draws the stretch of track the line's trains use, in the line's colour", () => {
    const hours = Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 22 ? 6 : 0));
    const sectionTrains: SectionTrains[] = [{ section: "s1", line: "L1", hours }];
    const topology = {
      sections: [{ id: "s1", source: { kind: "track", ref: 9, index: 0, chainage_m: [200, 800] } }],
    };
    const paths = serviceLinePaths(doc, view, sectionTrains, topology).features;
    expect(paths).toHaveLength(1);
    expect(paths[0]!.properties).toMatchObject({ line: "L1", color: "#c2410c", name: "T5" });
    const coords = (paths[0]!.geometry as { coordinates: [number, number][] }).coordinates;
    expect(coords[0]![0]).toBeCloseTo(7.002, 4);
    expect(coords[coords.length - 1]![0]).toBeCloseTo(7.008, 4);
  });

  it("has no path for a line that was not published", () => {
    expect(serviceLinePaths(doc, view, [], null).features).toEqual([]);
  });
});

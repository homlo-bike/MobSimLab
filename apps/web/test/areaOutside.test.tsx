import { describe, expect, it } from "vitest";
import { outsideDrawings, railLonLat } from "../src/features/area/outside";

const square = (lon: number, lat: number, d: number) => ({
  ring: [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
    [lon - d, lat - d],
  ] as [number, number][],
});
const area = [square(36.3, 33.5, 0.2)];

describe("railLonLat", () => {
  it("puts the origin at itself and 100 km east within 1 km of the true point", () => {
    expect(railLonLat([36.3, 33.5], 0, 0)).toEqual([36.3, 33.5]);
    const [lon, lat] = railLonLat([36.3, 33.5], 100_000, 0);
    const kmPerDeg = (6378.137 * Math.PI) / 180;
    expect(Math.abs(lon - 36.3) * kmPerDeg * Math.cos((33.5 * Math.PI) / 180)).toBeCloseTo(100, 0);
    expect(lat).toBeLessThan(33.5);
    const [, north] = railLonLat([36.3, 33.5], 0, 111_319.5);
    expect(north).toBeCloseTo(34.5, 2);
  });
});

describe("outsideDrawings", () => {
  it("is empty without an area", () => {
    expect(outsideDrawings({ cargoBike: { start: [0, 0], destination: [1, 1] } }, [])).toEqual([]);
  });

  it("names each drawing with a point outside the polygons and leaves the ones inside", () => {
    const docs = {
      streetLines: {
        lines: [
          { name: "Inside", points: [{ lonlat: [36.3, 33.5] as [number, number] }] },
          {
            name: "M5",
            points: [{ lonlat: [36.3, 33.5] as [number, number] }],
            view: { legs: [{ coords: [[36.7, 34.7] as [number, number]] }] },
          },
        ],
      },
      railway: {
        origin: [36.3, 33.5] as [number, number],
        stations: [{ x: 0, y: 0 }],
        tracks: [{ points: [{ x: 0, y: 150_000 }] }],
      },
      depots: { depots: [{ name: "Qaboun", boundary: [[36.31, 33.51] as [number, number]] }] },
      cargoBike: { start: [36.3, 33.5] as [number, number], destination: null },
      pluginLines: {
        tools: {
          ferry: { doc: { piers: [{ lonlat: [35.5, 33.9] }] }, line: { name: "Beirut ferry" } },
          "cable-car": { doc: { stations: [{ lonlat: [36.29, 33.52] }] }, line: null },
          "ferry-2": {
            doc: { piers: [], calls: [{ via: [[36.3, 33.5]] }], zones: [{ ring: [[34, 33]] }] },
            line: null,
          },
        },
      },
    };
    expect(outsideDrawings(docs, area)).toEqual([
      { kind: "streetLine", name: "M5" },
      { kind: "pluginLine", name: "Beirut ferry" },
      { kind: "pluginLine", name: "ferry-2" },
      { kind: "railway", name: "" },
    ]);
  });

  it("counts a point in any of several polygons as inside", () => {
    const two = [...area, square(37.1, 36.2, 0.2)];
    const docs = {
      streetLines: {
        lines: [
          {
            name: "Damascus–Aleppo",
            points: [
              { lonlat: [36.3, 33.5] as [number, number] },
              { lonlat: [37.1, 36.2] as [number, number] },
            ],
          },
        ],
      },
    };
    expect(outsideDrawings(docs, two)).toEqual([]);
    expect(outsideDrawings(docs, area)).toEqual([{ kind: "streetLine", name: "Damascus–Aleppo" }]);
  });
});

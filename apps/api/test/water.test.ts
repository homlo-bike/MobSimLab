import { describe, expect, it } from "vitest";
import { parseBbox } from "../src/street-network/street-network.controller";
import {
  clipLine,
  joinChains,
  ringArea,
  seaRings,
  simplify,
  waterQuery,
  waterShapes,
  type Bbox,
  type Pt,
} from "../src/street-network/water";

const BOX: Bbox = [0, 0, 1, 1];

describe("water for the schematic", () => {
  it("asks Overpass for water areas, rivers, canals and the coastline", () => {
    const q = waterQuery([4.8, 52.3, 5, 52.4]);
    expect(q).toContain("(52.300000,4.800000,52.400000,5.000000)");
    for (const tag of ["natural", "water", "riverbank", "reservoir", "coastline", "river|canal"])
      expect(q).toContain(tag);
    expect(q).toContain("out tags geom");
  });

  it("keeps the sea on the right of the coastline, closed along the box edge", () => {
    // Coastline running east: land to the north (left), sea to the south (right).
    const rings = seaRings(
      [
        [
          [-0.1, 0.5],
          [1.1, 0.5],
        ],
      ],
      BOX,
    );
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(Math.abs(ringArea(ring))).toBeCloseTo(0.5, 6);
    expect(ring.every(([, y]) => y <= 0.5 + 1e-9)).toBe(true);
    // Running west instead puts the sea in the north.
    const north = seaRings(
      [
        [
          [1.1, 0.5],
          [-0.1, 0.5],
        ],
      ],
      BOX,
    )[0]!;
    expect(north.every(([, y]) => y >= 0.5 - 1e-9)).toBe(true);
  });

  it("makes the whole box sea around an island and skips unfinished coastlines", () => {
    const island: Pt[] = [
      [0.4, 0.4],
      [0.4, 0.6],
      [0.6, 0.6],
      [0.6, 0.4],
      [0.4, 0.4],
    ];
    const rings = seaRings([island], BOX);
    expect(rings).toHaveLength(2);
    expect(Math.abs(ringArea(rings[0]!))).toBeCloseTo(1, 6);
    expect(
      seaRings(
        [
          [
            [0.2, 0.5],
            [0.8, 0.5],
          ],
        ],
        BOX,
      ),
    ).toEqual([]);
  });

  it("joins coastline pieces, cuts lines at the box and simplifies", () => {
    expect(
      joinChains([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [2, 0],
        ],
      ]),
    ).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    ]);
    expect(
      clipLine(
        [
          [-1, 0.5],
          [2, 0.5],
        ],
        BOX,
      ),
    ).toEqual([
      [
        [0, 0.5],
        [1, 0.5],
      ],
    ]);
    expect(
      simplify(
        [
          [0, 0],
          [0.5, 0.0001],
          [1, 0],
        ],
        0.01,
      ),
    ).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("turns an Overpass answer into areas, rivers and sea", () => {
    const geom = (pts: Pt[]) => pts.map(([lon, lat]) => ({ lon, lat }));
    const json = JSON.stringify({
      elements: [
        {
          type: "way",
          tags: { natural: "water" },
          geometry: geom([
            [0.2, 0.2],
            [0.2, 0.4],
            [0.4, 0.4],
            [0.4, 0.2],
            [0.2, 0.2],
          ]),
        },
        // Too small to see on a diagram of the box.
        {
          type: "way",
          tags: { natural: "water" },
          geometry: geom([
            [0.5, 0.5],
            [0.5, 0.501],
            [0.501, 0.501],
            [0.5, 0.5],
          ]),
        },
        {
          type: "way",
          tags: { waterway: "river" },
          geometry: geom([
            [0, 0.8],
            [0.5, 0.8],
            [1, 0.8],
          ]),
        },
        {
          type: "way",
          tags: { natural: "coastline" },
          geometry: geom([
            [-0.1, 0.1],
            [1.1, 0.1],
          ]),
        },
      ],
    });
    const w = waterShapes(json, BOX);
    expect(w.areas).toHaveLength(1);
    expect(w.rivers).toEqual([
      {
        line: [
          [0, 0.8],
          [1, 0.8],
        ],
        kind: "river",
      },
    ]);
    expect(w.sea).toHaveLength(1);
    expect(Math.abs(ringArea(w.sea[0]!))).toBeCloseTo(0.1, 6);
  });

  it("reads the box from the query, rounded outward, and refuses large or broken ones", () => {
    expect(parseBbox("4.861,52.331,4.979,52.412")).toEqual([4.86, 52.33, 4.98, 52.42]);
    expect(() => parseBbox("4,52,6,53")).toThrow();
    expect(() => parseBbox("5,52,4,53")).toThrow();
    expect(() => parseBbox("a,b,c,d")).toThrow();
    expect(() => parseBbox(undefined)).toThrow();
  });
});

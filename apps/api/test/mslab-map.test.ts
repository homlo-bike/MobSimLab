import { describe, expect, it } from "vitest";
import { chunks, tilesOf } from "../src/mslab/map-data";

/** The map data of a `.mslab` file (format 1.1): which tiles and population chunks cover the project area. */
describe("mslab map data", () => {
  it("lists the zoom-14 tiles that cover a box", () => {
    // A box inside one tile near Greenwich.
    expect(tilesOf([0.001, 51.47, 0.002, 51.471])).toEqual([[8192, 5450]]);
    // A box across two tiles east to west and two north to south.
    const t = tilesOf([-0.001, 51.47, 0.001, 51.49]);
    expect(t).toEqual([
      [8191, 5449],
      [8192, 5449],
      [8191, 5450],
      [8192, 5450],
    ]);
  });

  it("cuts a box into chunks on the population cells", () => {
    const cell = 1 / 1200;
    const parts = chunks([10, 50, 10.7, 50.2], 0.3, cell);
    expect(parts.length).toBe(3);
    for (const [w, s, e, n] of parts) {
      expect(e - w).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(n - s).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(Math.abs(w / cell - Math.round(w / cell))).toBeLessThan(1e-6);
    }
    expect(parts[0]![0]).toBeCloseTo(10, 6);
    expect(parts.at(-1)![2]).toBeCloseTo(10.7, 2);
  });
});

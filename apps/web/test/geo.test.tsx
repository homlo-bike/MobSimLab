import { describe, expect, it } from "vitest";
import { distanceKm, distanceM } from "../src/map/geo";

describe("distanceM", () => {
  it("is zero for the same point and symmetric", () => {
    expect(distanceM([8.54, 47.37], [8.54, 47.37])).toBe(0);
    expect(distanceM([8.54, 47.37], [8.55, 47.38])).toBeCloseTo(distanceM([8.55, 47.38], [8.54, 47.37]), 9);
  });

  it("measures one degree of latitude as about 111.2 km", () => {
    expect(distanceM([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
  });

  it("shrinks east-west distances with latitude", () => {
    expect(distanceM([0, 60], [1, 60])).toBeCloseTo(55_597, -1);
  });

  it("gives Berlin to Paris as about 878 km", () => {
    expect(distanceKm([13.405, 52.52], [2.3522, 48.8566])).toBeCloseTo(877.5, 0);
  });
});

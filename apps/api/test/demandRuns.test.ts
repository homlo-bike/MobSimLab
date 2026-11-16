import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { tileOf } from "../src/simulation/road";
import { demandTiles, MAX_DEMAND_TILES } from "../src/simulation/runs.service";

const bundle = (centroids: unknown[]) =>
  JSON.stringify({ version: 1, zones: centroids.map((c, i) => ({ id: `z${i}`, centroid: c })) });

describe("demand run street tiles", () => {
  it("takes the tile of every zone centre and the tiles around it, once each", () => {
    const tiles = demandTiles(
      bundle([
        [8.54, 47.37],
        [8.5401, 47.3701],
      ]),
    );
    expect(tiles).toHaveLength(9);
    const [x, y] = tileOf(8.54, 47.37);
    expect(tiles).toContainEqual([x, y]);
    expect(tiles).toContainEqual([x - 1, y - 1]);
    expect(tiles).toContainEqual([x + 1, y + 1]);
  });

  it("grows with zones further apart and skips zones without a usable centre", () => {
    const near = demandTiles(bundle([[8.54, 47.37]]));
    const far = demandTiles(bundle([[8.54, 47.37], [8.7, 47.37], null, ["x", 1], [1, 89]]));
    expect(near).toHaveLength(9);
    expect(far).toHaveLength(18);
  });

  it("has nothing for a bundle without zones and refuses text that is not JSON", () => {
    expect(demandTiles(JSON.stringify({ version: 1 }))).toEqual([]);
    expect(() => demandTiles("not json")).toThrow(BadRequestException);
  });

  it("stops counting well past the limit", () => {
    const many = Array.from({ length: 2000 }, (_, i) => [8 + i * 0.05, 47]);
    const tiles = demandTiles(bundle(many));
    expect(tiles.length).toBeGreaterThan(MAX_DEMAND_TILES);
    expect(tiles.length).toBeLessThanOrEqual(4 * MAX_DEMAND_TILES + 9);
  });
});

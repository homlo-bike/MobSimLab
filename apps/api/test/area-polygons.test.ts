import { describe, expect, it } from "vitest";
import {
  type AreaPolygon,
  areaPolygon,
  areaPolygons,
  areaTiles,
  BYTES_PER_TILE,
  closeRing,
  estimateArea,
  pointInRing,
  ringAreaKm2,
  ringMeetsBox,
  storedPolygons,
  tileBox,
  tileOf,
} from "../src/projects/area-polygons";

const square = (x: number, y: number, d: number): [number, number][] => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
  [x, y],
];
const e = (p: AreaPolygon) => areaTiles([p]).length;
const poly = (id: string, ring: [number, number][], detail: "full" | "main" = "full"): AreaPolygon => ({
  id,
  name: id,
  detail,
  ring,
});

describe("project area polygons (large-area projects, step 1)", () => {
  it("closes rings and works out their area on the sphere", () => {
    expect(
      closeRing([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    expect(closeRing(square(0, 0, 1))).toHaveLength(5);
    // 0.1° × 0.1° at Damascus (33.5° N): 11.13 km × 9.28 km ≈ 103 km².
    expect(ringAreaKm2(square(36.25, 33.45, 0.1))).toBeCloseTo(103.3, 0);
    // The direction of the ring does not matter.
    expect(ringAreaKm2([...square(36.25, 33.45, 0.1)].reverse())).toBeCloseTo(103.3, 0);
  });

  it("accepts polygons as the area window sends them and refuses broken ones", () => {
    const ok = areaPolygon.parse({
      id: "a1",
      name: " Homs ",
      detail: "full",
      ring: square(36.7, 34.7, 0.1).slice(0, 4),
    });
    expect(ok.name).toBe("Homs");
    expect(ok.ring).toHaveLength(5);
    expect(
      areaPolygon.safeParse({ id: "a1", name: "x", detail: "some", ring: square(0, 0, 1) }).success,
    ).toBe(false);
    expect(
      areaPolygon.safeParse({ id: "x1", name: "x", detail: "full", ring: square(0, 0, 1) }).success,
    ).toBe(false);
    // Three points on a line enclose nothing.
    expect(
      areaPolygon.safeParse({
        id: "a1",
        name: "x",
        detail: "full",
        ring: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      }).success,
    ).toBe(false);
    expect(areaPolygons.safeParse([poly("a1", square(0, 0, 1)), poly("a1", square(2, 2, 1))]).success).toBe(
      false,
    );
    expect(storedPolygons([poly("a1", square(0, 0, 1)), { id: "a2" }, null])).toHaveLength(1);
  });

  it("finds the tiles a polygon touches, not the box round it", () => {
    // A thin diagonal corridor touches far fewer tiles than its box holds.
    const corridor: [number, number][] = [
      [36.29, 33.5],
      [37.16, 36.19],
      [37.18, 36.2],
      [36.31, 33.51],
      [36.29, 33.5],
    ];
    const tiles = areaTiles([poly("a1", corridor, "main")]);
    const [x0, y1] = tileOf([36.29, 33.5], 14);
    const [x1, y0] = tileOf([37.18, 36.2], 14);
    const boxTiles = (x1 - x0 + 1) * (y1 - y0 + 1);
    expect(tiles.length).toBeGreaterThan(100);
    expect(tiles.length).toBeLessThan(boxTiles / 20);
    expect(tiles.every((t) => t.detail === "main")).toBe(true);
  });

  it("holds a tile at the highest detail of the polygons touching it", () => {
    const city = poly("a1", square(36.25, 33.45, 0.05), "full");
    const corridor = poly("a2", square(36.27, 33.47, 0.2), "main");
    const tiles = areaTiles([corridor, city]);
    const full = new Set(areaTiles([city]).map((t) => `${t.x}/${t.y}`));
    for (const t of tiles) expect(t.detail).toBe(full.has(`${t.x}/${t.y}`) ? "full" : "main");
  });

  it("tests rings against boxes and points against rings", () => {
    const ring = square(0, 0, 1);
    expect(pointInRing([0.5, 0.5], ring)).toBe(true);
    expect(pointInRing([1.5, 0.5], ring)).toBe(false);
    expect(ringMeetsBox(ring, [0.2, 0.2, 0.3, 0.3])).toBe(true); // box inside the ring
    expect(ringMeetsBox(ring, [-1, -1, 2, 2])).toBe(true); // ring inside the box
    expect(ringMeetsBox(ring, [0.5, -1, 0.6, 2])).toBe(true); // edges cross
    expect(ringMeetsBox(ring, [2, 2, 3, 3])).toBe(false);
    const [w, s, e, n] = tileBox(9867, 6451, 14);
    expect(e - w).toBeCloseTo(360 / 2 ** 14, 9);
    expect(n).toBeGreaterThan(s);
    expect(tileOf([(w + e) / 2, (s + n) / 2], 14)).toEqual([9867, 6451]);
  });

  it("estimates the map data and checks it against the limit", () => {
    const city = poly("a1", square(36.25, 33.45, 0.1));
    const e = estimateArea([city], 1000);
    expect(e.tiles.main).toBe(0);
    expect(e.bytes).toBe(e.tiles.full * BYTES_PER_TILE.full);
    expect(e.areaKm2).toBeCloseTo(103.3, 0);
    expect(e.polygons).toEqual([{ id: "a1", areaKm2: e.areaKm2, bytes: e.bytes }]);
    expect(e.overLimit).toBe(false);
    expect(estimateArea([city], 1).overLimit).toBe(true);
    // The same land as a main-roads corridor holds a fraction of the data.
    expect(estimateArea([{ ...city, detail: "main" }]).bytes).toBeLessThan(e.bytes / 10);
  });

  it("says what an edited area adds to the saved one", () => {
    const city = poly("a1", square(36.25, 33.45, 0.1));
    const tartus = poly("a2", square(35.85, 34.85, 0.05));
    expect(estimateArea([city], 1000, [city]).added).toEqual({ tiles: 0, bytes: 0 });
    const more = estimateArea([city, tartus], 1000, [city]);
    expect(more.added!.bytes).toBe(estimateArea([tartus]).bytes);
    // Raising a main-roads polygon to full detail adds its tiles again; removing parts adds nothing.
    expect(estimateArea([city], 1000, [{ ...city, detail: "main" }]).added!.tiles).toBe(e(city));
    expect(estimateArea([city], 1000, [city, tartus]).added!.bytes).toBe(0);
    expect(estimateArea([city]).added).toBeUndefined();
  });
});
